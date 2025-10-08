import { z } from 'zod';
import type { Provider, ProviderResponse, CallReport, SafeResult } from './types';
import { CircuitOpenError } from './types';
import { checkInput, checkOutput } from './moderation';
import { redactEmailPhone } from './redact';
import { PolicyEngine } from './policy';
import { Cache } from './cache';
import { Budget } from './budget';
import { TokenBucket } from './rateLimit';
import { logJson } from './logger';
import { newCallId } from './ids';

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
  private policy: PolicyEngine;
  private moderation: boolean;
  private timeoutMs: number;
  private retries: number;
  private redact: string[];
  private cache: Cache;
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
    this.policy = opts.policy ?? new PolicyEngine({});
    this.moderation = opts.moderation ?? true;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.retries = opts.retries ?? 2;
    this.redact = opts.redact ?? [];
    this.cache = opts.cache ?? new Cache();
    this.budget = opts.budget;
    this.rateLimit = opts.rateLimit;
    this.params = { temperature: opts.temperature ?? 0.2, maxTokens: opts.maxTokens ?? 512, model: opts.model };
    this.failSafe = opts.failSafe ?? true;
    this.failSafeReturn = opts.failSafeReturn ?? '';
  }

  private circuitOpen() { return this.failures >= this.threshold; }
  private success() { this.failures = 0; }
  private failure() { this.failures++; }

  private async callWithRetry(prompt: string): Promise<ProviderResponse> {
    let attempt = 0, lastErr: unknown;
    while (attempt <= this.retries) {
      try { return await this.llm.complete(prompt, this.params); }
      catch (e) { lastErr = e; attempt++; await new Promise(r => setTimeout(r, Math.min(4000, 500 * 2 ** attempt))); }
    }
    throw lastErr;
  }

  private attachReport<TVal>(value: TVal, report: CallReport): SafeResult<TVal> { return { value, report }; }

  private async core(prompt: string): Promise<SafeResult<any>> {
    const callId = newCallId();
    if (this.circuitOpen()) throw new CircuitOpenError('Circuit open due to recent failures');
    if (this.rateLimit) this.rateLimit.take(1);

    let cleaned = redactEmailPhone(prompt, this.redact);
    if (this.moderation) checkInput(cleaned);
    cleaned = this.policy.preCall(cleaned);

    const key = this.cache.key(cleaned, this.params, this.outputSchema?.description ?? this.outputSchema?.toString());
    const cached = this.cache.get<SafeResult<any>>(key);
    if (cached) { logJson('cache_hit', { callId }); return cached; }

    const t0 = Date.now();
    let text = '';
    try {
      logJson('llm_call_start', { callId, model: (this.params.model as string) ?? undefined });
      const resp = await this.callWithRetry(cleaned);
      this.success();
      text = resp.text;
    } catch (e) {
      this.failure();
      logJson('llm_call_error', { callId, error: (e as Error)?.name ?? 'Error' });
      throw e;
    }
    const dt = Date.now() - t0;

    try { text = this.policy.postCall(text, !!this.outputSchema); }
    catch (e) {
      if (this.outputSchema) {
        const repair = `Sanitize and return ONLY valid JSON for the requested schema. Remove secrets, shell commands, and anything non-JSON.\nPrevious output:\n${text}`;
        const rep = await this.callWithRetry(repair);
        text = this.policy.postCall(rep.text, true);
      } else { throw e; }
    }

    if (this.moderation) checkOutput(text);

    let value: any = text;
    if (this.outputSchema) {
      try { value = this.outputSchema.parse(JSON.parse(text)); }
      catch {
        const repair = `Repair to valid JSON ONLY for the expected schema. Respond only JSON:\n${text}`;
        const rep = await this.callWithRetry(repair);
        const fixed = this.policy.postCall(rep.text, true);
        value = this.outputSchema.parse(JSON.parse(fixed));
      }
    }

    const report: CallReport = { latencyMs: dt, model: (this.params.model as string) ?? undefined };
    const out = this.attachReport(value, report);
    this.cache.set(key, out);
    logJson('llm_call_end', { callId, latencyMs: dt });
    if (this.budget) this.budget.add(report.model, 0);
    return out;
  }

  async generate(prompt: string): Promise<SafeResult<any>> {
    if (!this.failSafe) return this.core(prompt);
    try { return await this.core(prompt); }
    catch { return this.attachReport(this.outputSchema ? {} : this.failSafeReturn, { latencyMs: 0, model: (this.params.model as string) ?? undefined }); }
  }

  async *streamGenerate(prompt: string): AsyncGenerator<string> {
    if (this.circuitOpen()) { if (this.failSafe) { yield this.failSafeReturn; return; } throw new CircuitOpenError('Circuit open due to recent failures'); }
    if (this.rateLimit) this.rateLimit.take(1);

    let cleaned = redactEmailPhone(prompt, this.redact);
    if (this.moderation) checkInput(cleaned);
    cleaned = this.policy.preCall(cleaned);

    try {
      for await (const chunk of this.llm.stream(cleaned, this.params)) {
        let safe = ''; try { safe = this.policy.postCall(chunk, false); } catch { safe = ''; }
        yield safe;
      }
    } catch (e) { if (this.failSafe) { yield this.failSafeReturn; return; } throw e; }
  }
}
