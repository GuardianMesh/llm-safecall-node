import { afterEach, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import { SafeCall, type SafeCallParams } from '../src/safeCall';
import { MockProvider } from '../src/providers/mock';
import { PolicyEngine } from '../src/policy';
import { TokenBucket } from '../src/rateLimit';
import { ToolRunner } from '../src/tools';
import { fromEnv } from '../src/env';
import {
  BudgetExceededError,
  CircuitOpenError,
  PolicyViolationError,
  RateLimitExceededError,
} from '../src/types';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('throws by default and returns the configured string only when fallback is enabled', async () => {
  const llm = new MockProvider();
  const error = new Error('provider failed');
  vi.spyOn(llm, 'complete').mockRejectedValue(error);
  await expect(new SafeCall({ llm, retries: 0 }).generate('Hello')).rejects.toBe(error);
  const safe = new SafeCall({
    llm,
    retries: 0,
    outputSchema: z.object({ count: z.number() }),
    failSafe: true,
    failSafeReturn: 'Unavailable',
  });
  const result = await safe.generate('Hello');
  expect(result.value).toBe('Unavailable');
  expectTypeOf(result.value).toEqualTypeOf<string | { count: number }>();
  vi.stubEnv('LLM_PROVIDER', 'mock');
  const configured = fromEnv({ outputSchema: z.object({ ok: z.boolean() }) });
  expectTypeOf((await configured.generate('Reply as JSON')).value).toEqualTypeOf<
    string | { ok: boolean }
  >();
});

it.each(['rejected output', 'failed repair'])(
  'opens the circuit after five operations with %s and allows an explicit reset',
  async (mode) => {
    const llm = new MockProvider();
    const complete = vi.spyOn(llm, 'complete').mockResolvedValue({
      text: mode === 'rejected output' ? 'Bearer synthetic-token' : 'invalid json',
    });
    const safe = new SafeCall({
      llm,
      retries: 0,
      policy: new PolicyEngine({ redactSecrets: false }),
      outputSchema: z.object({ ok: z.boolean() }),
    });
    for (let call = 0; call < 5; call++) await expect(safe.generate('Hello')).rejects.toThrow();
    await expect(safe.generate('Hello')).rejects.toBeInstanceOf(CircuitOpenError);
    expect(complete).toHaveBeenCalledTimes(mode === 'rejected output' ? 5 : 10);
    safe.resetCircuit();
    complete.mockResolvedValue({ text: '{"ok":true}' });
    expect((await safe.generate('Hello')).value).toEqual({ ok: true });
  },
);

it('counts failed streams and resets the count only when a stream completes', async () => {
  const llm = new MockProvider();
  const stream = vi.spyOn(llm, 'stream').mockImplementation(async function* () {
    yield 'bomb';
  });
  const safe = new SafeCall({ llm });
  for (let call = 0; call < 4; call++)
    await expect(safe.streamGenerate('Hello').next()).rejects.toThrow('Output moderation failed');
  stream.mockImplementationOnce(async function* () {
    yield 'done';
  });
  const result = safe.streamGenerate('Hello');
  expect(await result.next()).toEqual({ value: 'done', done: false });
  expect(await result.next()).toEqual({ value: undefined, done: true });
  for (let call = 0; call < 5; call++)
    await expect(safe.streamGenerate('Hello').next()).rejects.toThrow('Output moderation failed');
  await expect(safe.streamGenerate('Hello').next()).rejects.toBeInstanceOf(CircuitOpenError);
  expect(stream).toHaveBeenCalledTimes(10);
});

it('resets preceding failures when a cached response passes validation', async () => {
  const llm = new MockProvider();
  const complete = vi.spyOn(llm, 'complete');
  const safe = new SafeCall({ llm, retries: 0 });
  await safe.generate('cached');
  complete.mockRejectedValue(new Error('failed'));
  for (let call = 0; call < 4; call++) await expect(safe.generate('new')).rejects.toThrow('failed');
  expect((await safe.generate('cached')).value).toBe('Mock response: cached');
  await expect(safe.generate('new')).rejects.toThrow('failed');
  expect(complete).toHaveBeenCalledTimes(6);
});

it.each([BudgetExceededError, PolicyViolationError, RateLimitExceededError])(
  'does not retry provider-side %s rejections',
  async (ErrorClass) => {
    vi.useFakeTimers();
    const llm = new MockProvider();
    const error = new ErrorClass('denied');
    const complete = vi.spyOn(llm, 'complete').mockRejectedValue(error);
    await expect(new SafeCall({ llm }).generate('Hello')).rejects.toBe(error);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it.each([null, 1, {}, ['Hello']])(
  'rejects a non-string prompt before dispatch: %j',
  async (prompt) => {
    const llm = new MockProvider();
    const complete = vi.spyOn(llm, 'complete');
    await expect(new SafeCall({ llm }).generate(prompt as string)).rejects.toThrow(
      'Prompt must be a string',
    );
    expect(complete).not.toHaveBeenCalled();
  },
);

it('checks the input limit before redaction can shrink a prompt', async () => {
  const llm = new MockProvider();
  const complete = vi.spyOn(llm, 'complete');
  const safe = new SafeCall({
    llm,
    redact: ['email'],
    policy: new PolicyEngine({ maxInputChars: 30 }),
  });
  await expect(safe.generate('a'.repeat(100) + '@example.test')).rejects.toThrow('Prompt too long');
  expect(complete).not.toHaveBeenCalled();
});

it.each([
  { moderation: 'false' },
  { failSafe: 'false' },
  { failSafeReturn: {} },
  { redact: 'email' },
  { redact: ['typo'] },
  { llm: {} },
])('rejects invalid JavaScript options: %j', (options) => {
  expect(() => new SafeCall({ llm: new MockProvider(), ...options } as SafeCallParams)).toThrow();
});

it('propagates tool failures by default', async () => {
  const error = new Error('handler failed');
  const runner = new ToolRunner(new PolicyEngine());
  runner.register('fail', () => {
    throw error;
  });
  await expect(runner.call('fail', {})).rejects.toBe(error);
});

it('allows fractional rates to accumulate enough capacity for a request', () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  const bucket = new TokenBucket(0.1);
  bucket.take();
  expect(() => bucket.take()).toThrow(RateLimitExceededError);
  clock.mockReturnValue(10_000);
  bucket.take();
  expect(() => bucket.take()).toThrow(RateLimitExceededError);
});

it('measures latency independently of wall clock changes', async () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
  const llm = new MockProvider();
  vi.spyOn(llm, 'complete').mockImplementation(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(-1_000);
    clock.mockReturnValue(150);
    return { text: 'done' };
  });
  expect((await new SafeCall({ llm }).generate('Hello')).report.latencyMs).toBe(50);
});

it('rejects input that expands beyond the limit after secret redaction', async () => {
  const llm = new MockProvider();
  const complete = vi.spyOn(llm, 'complete');
  const safe = new SafeCall({ llm, policy: new PolicyEngine({ maxInputChars: 10 }) });
  await expect(safe.generate('Bearer ab')).rejects.toThrow('Prompt too long');
  expect(complete).not.toHaveBeenCalled();
});

it('bounds aggregate redaction before argument validation or dispatch', async () => {
  const validate = vi.fn((value) => value);
  const handler = vi.fn();
  const runner = new ToolRunner(new PolicyEngine({ maxInputChars: 100 }));
  runner.register('run', handler, z.object({ values: z.array(z.string()) }).transform(validate));
  await expect(runner.call('run', { values: Array(5).fill('Bearer ab') })).rejects.toThrow(
    'text limit',
  );
  expect(validate).not.toHaveBeenCalled();
  expect(handler).not.toHaveBeenCalled();
});
