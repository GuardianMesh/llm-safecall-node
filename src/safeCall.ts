import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Provider, ProviderResponse, CallReport, SafeResult } from './types';
import {
  CircuitOpenError,
  BudgetExceededError,
  PolicyViolationError,
  RateLimitExceededError,
} from './types';
import { checkInput, checkOutput } from './moderation';
import { redactEmailPhone } from './redact';
import { PolicyEngine } from './policy';
import { Cache } from './cache';
import { Budget } from './budget';
import { TokenBucket } from './rateLimit';
import { logJson } from './logger';
import { newCallId } from './ids';
import { checkValue, verifyValue } from './values';

export type SafeCallParams = {
  llm: Provider;
  outputSchema?: z.ZodTypeAny;
  policy?: PolicyEngine;
  moderation?: boolean;
  timeoutMs?: number;
  retries?: number;
  redact?: string[];
  cache?: Cache;
  budget?: Budget;
  rateLimit?: TokenBucket;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  failSafe?: boolean;
  failSafeReturn?: string;
};

export class SafeCall<T = unknown> {
  private llm: Provider;
  private outputSchema?: z.ZodTypeAny;
  private schemaInstruction = '';
  private policy: PolicyEngine;
  private moderation: boolean;
  private timeoutMs: number;
  private retries: number;
  private redact: string[];
  private cache: Cache;
  private cacheNamespace = randomUUID();
  private budget?: Budget;
  private rateLimit?: TokenBucket;
  private failures = 0;
  private threshold = 5;
  private params: Record<string, unknown>;
  private failSafe: boolean;
  private failSafeReturn: string;

  constructor(opts: SafeCallParams) {
    this.llm = opts.llm;
    this.outputSchema = opts.outputSchema;
    if (this.outputSchema) {
      this.schemaInstruction =
        '\nReturn only JSON matching this schema:\n' +
        JSON.stringify(z.toJSONSchema(this.outputSchema, { io: 'input' }));
    }
    this.policy = opts.policy ?? new PolicyEngine({});
    this.moderation = opts.moderation ?? true;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.retries = opts.retries ?? 2;
    if (!Number.isSafeInteger(this.retries) || this.retries < 0) {
      throw new RangeError('retries must be a nonnegative safe integer');
    }
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new RangeError('timeoutMs must be a positive safe integer');
    }
    this.redact = opts.redact ?? [];
    this.cache = opts.cache ?? new Cache();
    this.budget = opts.budget;
    this.rateLimit = opts.rateLimit;
    this.params = {
      timeoutMs: this.timeoutMs,
      temperature: opts.temperature ?? 0.2,
      maxTokens: opts.maxTokens ?? 512,
      model: opts.llm.model ?? opts.model,
    };
    this.failSafe = opts.failSafe ?? true;
    this.failSafeReturn = opts.failSafeReturn ?? '';
  }

  private circuitOpen() {
    return this.failures >= this.threshold;
  }
  private success() {
    this.failures = 0;
  }
  private failure() {
    this.failures++;
  }

  private preparePrompt(prompt: string): string {
    prompt += this.schemaInstruction;
    const cleaned = redactEmailPhone(prompt, this.redact);
    if (this.moderation) checkInput(cleaned);
    return this.policy.preCall(cleaned);
  }

  private async callWithRetry(
    prompt: string,
    responses: ProviderResponse[],
  ): Promise<ProviderResponse> {
    for (let attempt = 0; ; attempt++) {
      this.budget?.assertAvailable();
      this.rateLimit?.take(1);
      let response: ProviderResponse;
      try {
        response = await this.llm.complete(prompt, this.params);
      } catch (e) {
        const status = (e as { status?: number })?.status;
        const code =
          (e as { code?: string; cause?: { code?: string } })?.code ??
          (e as { cause?: { code?: string } })?.cause?.code;
        const permanent =
          e instanceof TypeError ||
          e instanceof RangeError ||
          (e as Error)?.name === 'AbortError' ||
          code === 'ERR_MODULE_NOT_FOUND' ||
          code === 'MODULE_NOT_FOUND' ||
          (typeof status === 'number' &&
            status >= 400 &&
            status < 500 &&
            ![408, 409, 425, 429].includes(status));
        if (permanent || attempt >= this.retries) throw e;
        await new Promise((r) => setTimeout(r, Math.min(4000, 1000 * 2 ** attempt)));
        continue;
      }
      if (!response || typeof response.text !== 'string') {
        throw new TypeError('Provider response must contain text');
      }
      for (const field of ['cost', 'inputTokens', 'outputTokens'] as const) {
        const value = response[field];
        if (
          value !== undefined &&
          (typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value < 0 ||
            (field !== 'cost' && !Number.isSafeInteger(value)))
        ) {
          throw new TypeError(
            `Provider ${field} must be a nonnegative ${field === 'cost' ? 'finite number' : 'safe integer'}`,
          );
        }
      }
      responses.push(response);
      this.budget?.add(
        response.model ?? (this.params.model as string | undefined),
        response.cost ?? 0,
      );
      return response;
    }
  }

  private attachReport<TVal>(value: TVal, report: CallReport): SafeResult<TVal> {
    return { value, report };
  }

  private parseOutput(text: string): unknown {
    const check = (value: string) => {
      const checked = this.policy.postCall(value, false);
      if (this.moderation) checkOutput(checked);
      return checked;
    };
    const decoded = checkValue(JSON.parse(text), check, this.policy.maxOutputChars);
    const result = this.outputSchema!.parse(decoded);
    verifyValue(result, check, this.policy.maxOutputChars);
    return result;
  }

  private async core(prompt: string): Promise<SafeResult<any>> {
    const callId = newCallId();
    if (this.circuitOpen()) throw new CircuitOpenError('Circuit open due to recent failures');
    const cleaned = this.preparePrompt(prompt);

    const key = this.cache.key(
      cleaned,
      { namespace: this.cacheNamespace, params: this.params },
      this.outputSchema?.description ?? this.outputSchema?.toString(),
    );
    const cached = this.cache.get<{ text: string; report: CallReport }>(key);
    if (cached && typeof cached.text === 'string' && cached.report) {
      // Treat persisted cache entries as untrusted model output.
      try {
        const text = this.policy.postCall(cached.text, false);
        if (this.moderation) checkOutput(text);
        const value = this.outputSchema ? this.parseOutput(text) : text;
        logJson('cache_hit', { callId });
        return this.attachReport(value, { ...cached.report });
      } catch {
        // Fetch a fresh response when the cached entry no longer passes validation.
      }
    }

    const t0 = Date.now();
    const responses: ProviderResponse[] = [];
    let text = '';
    try {
      logJson('llm_call_start', { callId, model: (this.params.model as string) ?? undefined });
      const resp = await this.callWithRetry(cleaned, responses);
      this.success();
      text = resp.text;
    } catch (e) {
      if (!(e instanceof BudgetExceededError) && !(e instanceof RateLimitExceededError))
        this.failure();
      logJson('llm_call_error', { callId, error: (e as Error)?.name ?? 'Error' });
      throw e;
    }

    let value: unknown;
    for (let repairs = 0; ; repairs++) {
      try {
        text = this.policy.postCall(text, false);
        if (this.moderation) checkOutput(text);
        value = this.outputSchema ? this.parseOutput(text) : text;
        break;
      } catch (error) {
        if (
          !this.outputSchema ||
          repairs >= 1 ||
          !(error instanceof SyntaxError || error instanceof z.ZodError)
        )
          throw error;
        const repair = `Repair this to valid JSON ONLY for the expected schema. Respond only JSON:\n${text}`;
        const rep = await this.callWithRetry(this.preparePrompt(repair), responses);
        text = rep.text;
      }
    }

    const sum = (field: 'cost' | 'inputTokens' | 'outputTokens') =>
      responses.every((response) => response[field] !== undefined)
        ? responses.reduce((total, response) => total + response[field]!, 0)
        : undefined;
    const dt = Date.now() - t0;
    const report: CallReport = {
      latencyMs: dt,
      model: responses.at(-1)?.model ?? (this.params.model as string | undefined),
      inputTokens: sum('inputTokens'),
      outputTokens: sum('outputTokens'),
      costEstimate: sum('cost'),
    };
    const out = this.attachReport(value, report);
    this.cache.set(key, { text, report: { ...report } });
    logJson('llm_call_end', { callId, latencyMs: dt });
    return out;
  }

  async generate(prompt: string): Promise<SafeResult<T | string | Record<string, never>>> {
    if (!this.failSafe) return this.core(prompt);
    try {
      return await this.core(prompt);
    } catch {
      return this.attachReport(this.outputSchema ? {} : this.failSafeReturn, {
        latencyMs: 0,
        model: (this.params.model as string) ?? undefined,
      });
    }
  }

  async *streamGenerate(prompt: string): AsyncGenerator<string> {
    try {
      if (this.circuitOpen()) {
        if (this.failSafe) {
          yield this.failSafeReturn;
          return;
        }
        throw new CircuitOpenError('Circuit open due to recent failures');
      }
      const cleaned = this.preparePrompt(prompt);
      this.budget?.assertAvailable();
      this.rateLimit?.take(1);
      let received = 0;
      let emitted = 0;
      for await (const chunk of this.llm.stream(cleaned, this.params)) {
        if (typeof chunk !== 'string') throw new TypeError('Provider stream must yield text');
        received += chunk.length;
        if (received > this.policy.maxOutputChars)
          throw new PolicyViolationError('Stream exceeds output limit');
        const safe = this.policy.postCall(chunk, false);
        if (this.moderation) checkOutput(safe);
        emitted += safe.length;
        if (emitted > this.policy.maxOutputChars)
          throw new PolicyViolationError('Stream exceeds output limit');
        yield safe;
      }
    } catch (e) {
      if (this.failSafe) {
        yield this.failSafeReturn;
        return;
      }
      throw e;
    }
  }
}
