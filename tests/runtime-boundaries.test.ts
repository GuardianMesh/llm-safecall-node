import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { SafeCall } from '../src/safeCall';
import { MockProvider } from '../src/providers/mock';
import { TokenBucket } from '../src/rateLimit';
import { Budget } from '../src/budget';
import { PolicyEngine, type PolicyConfig } from '../src/policy';
import { ToolRunner } from '../src/tools';
import { fromEnv } from '../src/env';
import { RateLimitExceededError } from '../src/types';

const directories: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});
function file() {
  const directory = mkdtempSync(join(tmpdir(), 'safecall-budget-'));
  directories.push(directory);
  return join(directory, 'budget.json');
}

it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid retries %s',
  (retries) => {
    expect(() => new SafeCall({ llm: new MockProvider(), retries })).toThrow(/retries/);
  },
);
it.each([0, -1, NaN, Infinity, 1.5])('rejects invalid timeouts %s', (timeoutMs) => {
  expect(() => new SafeCall({ llm: new MockProvider(), timeoutMs })).toThrow(/timeoutMs/);
});
it('does not schedule a delay after the final failed attempt', async () => {
  vi.useFakeTimers();
  const llm = new MockProvider();
  const failure = new Error('provider failed');
  const complete = vi.spyOn(llm, 'complete').mockRejectedValue(failure);
  const safe = new SafeCall({ llm, retries: 0, failSafe: false });
  await expect(safe.generate('Hello')).rejects.toBe(failure);
  expect(complete).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('honors the exact retry count and stops immediately after the last attempt', async () => {
  vi.useFakeTimers();
  const llm = new MockProvider();
  const complete = vi.spyOn(llm, 'complete').mockRejectedValue(new Error('provider failed'));
  const result = new SafeCall({ llm, retries: 2, failSafe: false }).generate('Hello');
  const rejected = expect(result).rejects.toThrow('provider failed');
  await vi.runAllTimersAsync();
  await rejected;
  expect(complete).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});
it('counts exhausted calls once and stops dispatching when the circuit opens', async () => {
  const llm = new MockProvider();
  const complete = vi.spyOn(llm, 'complete').mockRejectedValue(new Error('provider failed'));
  const safe = new SafeCall({ llm, retries: 0, failSafe: false });
  for (let call = 0; call < 5; call++)
    await expect(safe.generate('Hello')).rejects.toThrow('provider failed');
  await expect(safe.generate('Hello')).rejects.toThrow('Circuit open');
  expect(complete).toHaveBeenCalledTimes(5);
});
it('resets the circuit failure count after a successful initial call', async () => {
  const llm = new MockProvider();
  const complete = vi.spyOn(llm, 'complete').mockRejectedValue(new Error('provider failed'));
  const safe = new SafeCall({ llm, retries: 0, failSafe: false });
  for (let call = 0; call < 4; call++)
    await expect(safe.generate('failure')).rejects.toThrow('provider failed');
  complete.mockResolvedValueOnce({ text: 'Recovered' });
  expect((await safe.generate('success')).value).toBe('Recovered');
  await expect(safe.generate('failure')).rejects.toThrow('provider failed');
  expect(complete).toHaveBeenCalledTimes(6);
});
it('allows environment callers to select strict failure behavior and a policy', async () => {
  vi.stubEnv('LLM_PROVIDER', 'mock');
  const policy = new PolicyEngine({ maxInputChars: 1 });
  await expect(fromEnv({ policy, failSafe: false }).generate('Hello')).rejects.toThrow(
    'Prompt too long',
  );
  expect(
    (await fromEnv({ policy, failSafe: true, failSafeReturn: 'blocked' }).generate('Hello')).value,
  ).toBe('blocked');
});
it('preserves environment policy when an optional override is undefined', async () => {
  vi.stubEnv('LLM_PROVIDER', 'mock');
  vi.stubEnv('LLM_URL_ALLOWLIST', 'https://docs.example.test');
  const result = await fromEnv({ policy: undefined, failSafe: false }).generate(
    'https://outside.example.test',
  );
  expect(result.value).toBe('Mock response: [BLOCKED_URL]');
});
it.each([NaN, Infinity, -1])('rejects invalid rate limits and charges %s', (value) => {
  expect(() => new TokenBucket(value)).toThrow();
  expect(() => new TokenBucket(1, value)).toThrow();
  const bucket = new TokenBucket(1, 1);
  expect(() => bucket.take(value)).toThrow();
  bucket.take();
  expect(() => bucket.take()).toThrow('Rate limit exceeded');
});
it('refills using monotonic time even when the system clock moves', () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  const bucket = new TokenBucket(1, 1);
  bucket.take();
  vi.spyOn(Date, 'now').mockReturnValue(1e15);
  expect(() => bucket.take()).toThrow('Rate limit exceeded');
  clock.mockReturnValue(1000);
  bucket.take();
  expect(() => bucket.take()).toThrow('Rate limit exceeded');
});
it.each([NaN, Infinity, -1])(
  'rejects invalid budget amounts without resetting totals: %s',
  (amount) => {
    const path = file();
    const budget = new Budget(path, 2);
    budget.add('model', 1);
    const before = readFileSync(path, 'utf8');
    expect(() => budget.add('model', amount)).toThrow();
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(() => budget.add('model', 2)).toThrow('Daily budget exceeded');
  },
);
it('rejects malformed stored budget totals without overwriting them', () => {
  const path = file();
  const budget = new Budget(path, 2);
  const content = JSON.stringify({ [new Date().toISOString().slice(0, 10)]: -100 });
  writeFileSync(path, content);
  expect(() => budget.add('model', 1)).toThrow('Stored budget total');
  expect(readFileSync(path, 'utf8')).toBe(content);
});
it('validates direct policy configuration as strictly as YAML', () => {
  for (const config of [
    { maxInputChars: NaN },
    { maxOutputChars: 0 },
    { blockSecrets: 'false' },
    { typo: true },
  ]) {
    expect(() => new PolicyEngine(config as PolicyConfig)).toThrow();
  }
});
it('does not dispatch when redaction invalidates the tool argument schema', async () => {
  const fn = vi.fn();
  const runner = new ToolRunner(new PolicyEngine(), false);
  runner.register('use', fn, z.object({ credential: z.string().startsWith('Bearer ') }));
  await expect(runner.call('use', { credential: 'Bearer secret-token' })).rejects.toThrow();
  expect(fn).not.toHaveBeenCalled();
});
it('applies argument transforms once and accepts ordinary string result schemas', async () => {
  const fn = vi.fn(({ message }) => message);
  const runner = new ToolRunner(new PolicyEngine(), false);
  runner.register(
    'echo',
    fn,
    z.object({ message: z.string().transform((value) => value + '!') }),
    z.string(),
  );
  expect(await runner.call('echo', { message: 'Hello' })).toBe('Hello!');
  expect(fn).toHaveBeenCalledWith({ message: 'Hello!' });
});

it('does not send an output secret back to the provider in a repair prompt', async () => {
  const llm = new MockProvider();
  const complete = vi.spyOn(llm, 'complete').mockResolvedValue({ text: 'Bearer secret-token' });
  const safe = new SafeCall({
    llm,
    outputSchema: z.object({ title: z.string() }),
    policy: new PolicyEngine({ redactSecrets: false }),
    retries: 0,
    failSafe: false,
  });
  await expect(safe.generate('Hello')).rejects.toThrow('Secrets detected in output');
  expect(complete).toHaveBeenCalledTimes(1);
});
it('applies the input size limit to generated repair prompts', async () => {
  const llm = new MockProvider();
  const complete = vi.spyOn(llm, 'complete').mockResolvedValue({ text: 'x'.repeat(2000) });
  const safe = new SafeCall({
    llm,
    outputSchema: z.object({ title: z.string() }),
    policy: new PolicyEngine({ maxInputChars: 500 }),
    retries: 0,
    failSafe: false,
  });
  await expect(safe.generate('Hello')).rejects.toThrow('Prompt too long');
  expect(complete).toHaveBeenCalledTimes(1);
});
it('rejects malformed provider responses without turning them into repair prompts', async () => {
  const llm = new MockProvider();
  const complete = vi
    .spyOn(llm, 'complete')
    .mockResolvedValue({ text: undefined as unknown as string });
  const safe = new SafeCall({
    llm,
    outputSchema: z.object({ title: z.string() }),
    retries: 0,
    failSafe: false,
  });
  await expect(safe.generate('Hello')).rejects.toThrow('Provider response must contain text');
  expect(complete).toHaveBeenCalledTimes(1);
});

it('checks JSON-escaped secret strings after decoding without sending them in a repair', async () => {
  const llm = new MockProvider();
  const complete = vi
    .spyOn(llm, 'complete')
    .mockResolvedValue({ text: '{"items":[{"text":"Bearer \\u0073ecret-token"}]}' });
  const safe = new SafeCall({
    llm,
    outputSchema: z.object({ items: z.array(z.object({ text: z.string() })) }),
    policy: new PolicyEngine({ redactSecrets: false }),
    failSafe: false,
  });
  await expect(safe.generate('Hello')).rejects.toThrow('Secrets detected in output');
  expect(complete).toHaveBeenCalledTimes(1);
});
it('redacts decoded JSON strings before schema validation', async () => {
  const llm = new MockProvider();
  vi.spyOn(llm, 'complete').mockResolvedValue({ text: '{"text":"Bearer \\u0073ecret-token"}' });
  const safe = new SafeCall({ llm, outputSchema: z.object({ text: z.string() }), failSafe: false });
  expect((await safe.generate('Hello')).value).toEqual({ text: '[REDACTED_GENERIC_BEARER]' });
});
it('does not run a schema transform twice or let it introduce unchecked output', async () => {
  const llm = new MockProvider();
  const complete = vi.spyOn(llm, 'complete').mockResolvedValue({ text: '{"text":"safe"}' });
  const transform = vi.fn(() => 'Bearer secret-token');
  const safe = new SafeCall({
    llm,
    outputSchema: z.object({ text: z.string().transform(transform) }),
    failSafe: false,
  });
  await expect(safe.generate('Hello')).rejects.toThrow('Schema output violates policy');
  expect(transform).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalledTimes(1);
});
it('checks nested tool arguments and validator output before invoking the handler', async () => {
  const handler = vi.fn();
  const runner = new ToolRunner(new PolicyEngine({ redactSecrets: false }), false);
  runner.register('nested', handler);
  await expect(
    runner.call('nested', { nested: [{ text: 'Bearer secret-token' }] }),
  ).rejects.toThrow('Secrets detected in prompt');
  runner.register(
    'transform',
    handler,
    z.object({ text: z.string().transform(() => 'Bearer secret-token') }),
  );
  await expect(runner.call('transform', { text: 'safe' })).rejects.toThrow(
    'Secrets detected in prompt',
  );
  expect(handler).not.toHaveBeenCalled();
});
it('rejects tool cycles and accessors without invoking getters or handlers', async () => {
  const handler = vi.fn();
  const getter = vi.fn(() => 'safe');
  const runner = new ToolRunner(new PolicyEngine(), false);
  runner.register('read', handler);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  await expect(runner.call('read', cyclic)).rejects.toThrow('Cyclic');
  await expect(
    runner.call('read', Object.defineProperty({}, 'value', { get: getter, enumerable: true })),
  ).rejects.toThrow('accessors');
  expect(getter).not.toHaveBeenCalled();
  expect(handler).not.toHaveBeenCalled();
});
it('checks nested tool results and result-schema transforms', async () => {
  const runner = new ToolRunner(new PolicyEngine(), false);
  runner.register('read', () => ({ values: ['Bearer secret-token'] }));
  expect(await runner.call('read', {})).toEqual({ values: ['[REDACTED_GENERIC_BEARER]'] });
  runner.register(
    'transform',
    () => 'safe',
    undefined,
    z.string().transform(() => 'Bearer secret-token'),
  );
  await expect(runner.call('transform', {})).rejects.toThrow('Schema output violates policy');
});
it('matches custom injection markers case-insensitively', () => {
  const policy = new PolicyEngine({ forbidInjectionPhrases: ['FORBIDDEN ACTION'] });
  expect(() => policy.preCall('forbidden action')).toThrow('injection markers');
});
it('records over-limit provider charges and blocks the next call instead of retrying', async () => {
  const path = file();
  const budget = new Budget(path, 1);
  const llm = new MockProvider();
  const complete = vi.spyOn(llm, 'complete').mockResolvedValue({ text: 'done', cost: 2 });
  const safe = new SafeCall({ llm, budget, retries: 2, failSafe: false });
  await expect(safe.generate('Hello')).rejects.toThrow('Daily budget exceeded');
  expect(JSON.parse(readFileSync(path, 'utf8'))[new Date().toISOString().slice(0, 10)]).toBe(2);
  await expect(safe.generate('Again')).rejects.toThrow('Daily budget exceeded');
  expect(complete).toHaveBeenCalledTimes(1);
});
it('checks remaining budget before repairs and streams', async () => {
  const budget = new Budget(file(), 1);
  const llm = new MockProvider();
  const complete = vi.spyOn(llm, 'complete').mockResolvedValue({ text: 'not json', cost: 1 });
  const stream = vi.spyOn(llm, 'stream');
  const safe = new SafeCall({
    llm,
    budget,
    outputSchema: z.object({ ok: z.boolean() }),
    failSafe: false,
  });
  await expect(safe.generate('Hello')).rejects.toThrow('Daily budget exceeded');
  await expect(safe.streamGenerate('Hello').next()).rejects.toThrow('Daily budget exceeded');
  expect(complete).toHaveBeenCalledTimes(1);
  expect(stream).not.toHaveBeenCalled();
});
it('reports usage and latency across the initial and repair calls', async () => {
  vi.useFakeTimers();
  const llm = new MockProvider();
  let call = 0;
  vi.spyOn(llm, 'complete').mockImplementation(async () => {
    vi.advanceTimersByTime(50);
    return {
      text: ++call === 1 ? 'not json' : '{"ok":true}',
      inputTokens: 2,
      outputTokens: 3,
      cost: 0.25,
      model: 'reported-model',
    };
  });
  const safe = new SafeCall({ llm, outputSchema: z.object({ ok: z.boolean() }), failSafe: false });
  const result = await safe.generate('Hello');
  expect(result.report).toEqual({
    latencyMs: 100,
    inputTokens: 4,
    outputTokens: 6,
    costEstimate: 0.5,
    model: 'reported-model',
  });
});

it.each([400, 401, 403, 404])('does not retry permanent HTTP failure %s', async (status) => {
  vi.useFakeTimers();
  const llm = new MockProvider();
  const complete = vi
    .spyOn(llm, 'complete')
    .mockRejectedValue(Object.assign(new Error('permanent'), { status }));
  await expect(
    new SafeCall({ llm, retries: 2, failSafe: false }).generate('Hello'),
  ).rejects.toThrow('permanent');
  expect(complete).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('checks rate admission for every retry and repair', async () => {
  vi.useFakeTimers();
  const llm = new MockProvider();
  const complete = vi.spyOn(llm, 'complete').mockRejectedValue(new Error('temporary'));
  const safe = new SafeCall({
    llm,
    rateLimit: new TokenBucket(0.001, 1),
    retries: 2,
    failSafe: false,
  });
  const rejected = expect(safe.generate('Hello')).rejects.toThrow('Rate limit exceeded');
  await vi.runAllTimersAsync();
  await rejected;
  expect(complete).toHaveBeenCalledTimes(1);
  complete.mockResolvedValue({ text: 'not json' });
  const structured = new SafeCall({
    llm,
    rateLimit: new TokenBucket(0.001, 1),
    outputSchema: z.object({ ok: z.boolean() }),
    failSafe: false,
  });
  await expect(structured.generate('Hello')).rejects.toThrow('Rate limit exceeded');
  expect(complete).toHaveBeenCalledTimes(2);
});
it('provides the actual JSON schema on initial and repair requests and repairs only once', async () => {
  const llm = new MockProvider();
  const complete = vi.spyOn(llm, 'complete').mockResolvedValue({ text: 'not json' });
  const safe = new SafeCall({
    llm,
    outputSchema: z.object({ title: z.string(), count: z.number().int() }),
    failSafe: false,
  });
  await expect(safe.generate('Summarize')).rejects.toBeInstanceOf(SyntaxError);
  expect(complete).toHaveBeenCalledTimes(2);
  for (const [prompt] of complete.mock.calls) {
    const schema = JSON.parse(prompt.split('Return only JSON matching this schema:\n')[1]);
    expect(schema.properties.title.type).toBe('string');
    expect(schema.properties.count.type).toBe('integer');
  }
});
it('does not repair JSON whose decoded text fails moderation', async () => {
  const llm = new MockProvider();
  const complete = vi.spyOn(llm, 'complete').mockResolvedValue({ text: '{"text":"b\\u006fmb"}' });
  const safe = new SafeCall({ llm, outputSchema: z.object({ text: z.string() }), failSafe: false });
  await expect(safe.generate('Hello')).rejects.toThrow('Output moderation failed');
  expect(complete).toHaveBeenCalledTimes(1);
});
it('limits the cumulative model stream and closes it on rejection', async () => {
  let closed = false;
  const llm = {
    complete: async () => ({ text: '' }),
    async *stream() {
      try {
        yield 'abc';
        yield 'def';
      } finally {
        closed = true;
      }
    },
  };
  const safe = new SafeCall({
    llm,
    policy: new PolicyEngine({ maxOutputChars: 5 }),
    failSafe: false,
  });
  const chunks: string[] = [];
  await expect(
    (async () => {
      for await (const chunk of safe.streamGenerate('Hello')) chunks.push(chunk);
    })(),
  ).rejects.toThrow('Stream exceeds output limit');
  expect(chunks).toEqual(['abc']);
  expect(closed).toBe(true);
});
it.each(['Bearer secret-token', 'bomb'])(
  'surfaces a blocked stream chunk in strict mode: %s',
  async (chunk) => {
    const llm = {
      complete: async () => ({ text: '' }),
      async *stream() {
        yield chunk;
      },
    };
    const safe = new SafeCall({
      llm,
      policy: new PolicyEngine({ redactSecrets: false }),
      failSafe: false,
    });
    await expect(safe.streamGenerate('Hello').next()).rejects.toThrow();
  },
);

it('rejects oversized output without returning a secret prefix', async () => {
  const secret =
    '-----BEGIN RSA PRIVATE KEY-----\n' + 'x'.repeat(150) + '\n-----END RSA PRIVATE KEY-----';
  const llm = new MockProvider();
  const complete = vi.spyOn(llm, 'complete').mockResolvedValue({ text: secret });
  const policy = new PolicyEngine({ maxOutputChars: 100, redactSecrets: false });
  expect(() => policy.postCall(secret, false)).toThrow('Output too long');
  const safe = new SafeCall({ llm, policy, failSafe: false });
  await expect(safe.generate('Hello')).rejects.toThrow('Output too long');
  expect(complete).toHaveBeenCalledTimes(1);
  const fallback = await new SafeCall({ llm, policy }).generate('Hello');
  expect(fallback.value).toBe('');
});

it('checks result-schema defaults even after a tool fails', async () => {
  const runner = new ToolRunner(new PolicyEngine({ redactSecrets: false }));
  runner.register(
    'failure',
    () => {
      throw new Error('failed');
    },
    undefined,
    z.object({ text: z.string().default('Bearer synthetic-token') }),
  );
  await expect(runner.call('failure', {})).rejects.toThrow('Secrets detected in output');
});
it('does not count denied rate admission toward the circuit breaker', async () => {
  const rateLimit = new TokenBucket(1, 1);
  const take = vi.spyOn(rateLimit, 'take');
  take.mockImplementation(() => {
    throw new RateLimitExceededError('Rate limit exceeded');
  });
  const llm = new MockProvider();
  const complete = vi.spyOn(llm, 'complete');
  const safe = new SafeCall({ llm, rateLimit, failSafe: false });
  for (let n = 0; n < 5; n++)
    await expect(safe.generate('Hello')).rejects.toThrow('Rate limit exceeded');
  take.mockRestore();
  expect((await safe.generate('Hello')).value).toBeTruthy();
  expect(complete).toHaveBeenCalledTimes(1);
});
it('keeps sanitized output within its configured limit', () => {
  expect(() => new PolicyEngine({ maxOutputChars: 10 }).postCall('Bearer abc', false)).toThrow(
    'Output too long',
  );
});

it('enforces aggregate limits after schema transforms and before tool dispatch', async () => {
  const llm = new MockProvider();
  vi.spyOn(llm, 'complete').mockResolvedValue({ text: '{"text":"safe"}' });
  const safe = new SafeCall({
    llm,
    failSafe: false,
    policy: new PolicyEngine({ maxOutputChars: 100 }),
    outputSchema: z.object({
      text: z.string().transform(() => Array.from({ length: 100 }, () => 'x'.repeat(99))),
    }),
  });
  await expect(safe.generate('Hello')).rejects.toThrow('text limit');
  const runner = new ToolRunner(
    new PolicyEngine({ maxInputChars: 100, maxOutputChars: 100 }),
    false,
  );
  const handler = vi.fn(() => 'ok');
  runner.register('read', handler);
  await expect(
    runner.call('read', { values: Array.from({ length: 100 }, () => 'x'.repeat(99)) }),
  ).rejects.toThrow('text limit');
  expect(handler).not.toHaveBeenCalled();
  runner.register('many', () => Array.from({ length: 100 }, () => 'x'.repeat(99)));
  await expect(runner.call('many', {})).rejects.toThrow('text limit');
});
