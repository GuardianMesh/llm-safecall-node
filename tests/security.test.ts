import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Cache } from '../src/cache';
import { fromEnv } from '../src/env';
import { PolicyEngine } from '../src/policy';
import { SafeCall } from '../src/safeCall';
import { allowlistUrls } from '../src/sanitize';

const directories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});
function cacheFile() {
  const directory = mkdtempSync(join(tmpdir(), 'safecall-security-'));
  directories.push(directory);
  return join(directory, 'cache.json');
}
function provider(text: string) {
  return {
    model: 'same-model',
    complete: vi.fn(async () => ({ text })),
    async *stream() {
      yield text;
    },
  };
}

it('isolates callers even when they share an explicit cache and model name', async () => {
  const cache = new Cache(cacheFile());
  const first = new SafeCall({ llm: provider('private result'), cache, failSafe: false });
  const second = new SafeCall({ llm: provider('public result'), cache, failSafe: false });
  expect((await first.generate('Hello')).value).toBe('private result');
  expect((await second.generate('Hello')).value).toBe('public result');
});

it('rechecks persisted output against the current policy', async () => {
  const file = cacheFile();
  const llm = provider('clean result');
  const safe = new SafeCall({
    llm,
    cache: new Cache(file),
    failSafe: false,
    policy: new PolicyEngine({ redactSecrets: false }),
  });
  await safe.generate('Hello');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data[Object.keys(data)[0]].text = 'Bearer secret-token';
  writeFileSync(file, JSON.stringify(data));
  expect((await safe.generate('Hello')).value).toBe('clean result');
  expect(llm.complete).toHaveBeenCalledTimes(2);
});

it('does not cache the mutable object returned to the caller', async () => {
  const llm = provider('{"title":"original"}');
  const safe = new SafeCall({
    llm,
    outputSchema: z.object({ title: z.string() }),
    failSafe: false,
  });
  const first = await safe.generate('Hello');
  (first.value as { title: string }).title = 'changed';
  expect((await safe.generate('Hello')).value).toEqual({ title: 'original' });
  expect(llm.complete).toHaveBeenCalledTimes(1);
});

it('validates cached JSON against the output schema', async () => {
  const file = cacheFile();
  const llm = provider('{"title":"original"}');
  const safe = new SafeCall({
    llm,
    cache: new Cache(file),
    outputSchema: z.object({ title: z.string() }),
    failSafe: false,
  });
  await safe.generate('Hello');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data[Object.keys(data)[0]].text = '{"title":42}';
  writeFileSync(file, JSON.stringify(data));
  expect((await safe.generate('Hello')).value).toEqual({ title: 'original' });
  expect(llm.complete).toHaveBeenCalledTimes(2);
});

it.each([
  '/guide/../private',
  '/guide/%2e%2e/private',
  '/guide/%2e%2e%2fprivate',
  '/guide/%252e%252e%252fprivate',
  '/guide/%5c../private',
  '/guidebook',
])('blocks paths outside the allowed directory: %s', (path) => {
  expect(allowlistUrls('https://docs.example.com' + path, ['https://docs.example.com/guide'])).toBe(
    '[BLOCKED_URL]',
  );
});

it('checks complete URL matches when one URL is a prefix of another', () => {
  const text = 'https://evil.test/ https://evil.test/https://docs.example.com/guide';
  expect(allowlistUrls(text, ['https://docs.example.com/guide'])).toBe(
    '[BLOCKED_URL] [BLOCKED_URL]',
  );
});

it('rejects unknown provider names before choosing an API client', () => {
  vi.stubEnv('LLM_PROVIDER', 'opneai');
  expect(() => fromEnv()).toThrow('LLM_PROVIDER');
});

it('does not expose inherited properties as cache entries', () => {
  const cache = new Cache();
  expect(cache.get('__proto__')).toBeUndefined();
  expect(cache.get('constructor')).toBeUndefined();
});

it('evicts the oldest cache entries when capacity is reached', () => {
  const cache = new Cache(undefined, { maxEntries: 2 });
  cache.set('first', 'one');
  cache.set('second', 'two');
  cache.set('third', 'three');
  expect(cache.get('first')).toBeUndefined();
  expect(cache.get('second')).toBe('two');
  expect(cache.get('third')).toBe('three');
});

it('bounds cache capacity by default', () => {
  const cache = new Cache();
  for (let index = 0; index < 257; index++) cache.set(String(index), 'value');
  expect(cache.get('0')).toBeUndefined();
  expect(cache.get('256')).toBe('value');
});

it('caps total serialized bytes and skips oversized entries', () => {
  const cache = new Cache(undefined, { maxBytes: 100 });
  for (const key of ['a', 'b', 'c']) cache.set(key, 'x'.repeat(40));
  expect(cache.get('a')).toBeUndefined();
  expect(cache.get('b')).toBe('x'.repeat(40));
  expect(cache.get('c')).toBe('x'.repeat(40));
  cache.set('oversized', '👋'.repeat(30));
  expect(cache.get('oversized')).toBeUndefined();
  expect(cache.get('c')).toBe('x'.repeat(40));
});

it('stores snapshots so later mutations cannot grow retained values', () => {
  const cache = new Cache(undefined, { maxBytes: 100 });
  const value = { text: 'short' };
  cache.set('key', value);
  value.text = 'x'.repeat(1000);
  cache.get<{ text: string }>('key')!.text = 'x'.repeat(1000);
  expect(cache.get('key')).toEqual({ text: 'short' });
});

it.each([
  { maxEntries: 0 },
  { maxEntries: NaN },
  { maxEntries: 1.5 },
  { maxBytes: 1 },
  { maxBytes: Infinity },
])('rejects invalid cache limits: %o', (limits) => {
  expect(() => new Cache(undefined, limits)).toThrow(RangeError);
});

it('returns a completed model response even when it is too large to cache', async () => {
  const safe = new SafeCall({
    llm: provider('valid response'),
    cache: new Cache(undefined, { maxBytes: 2 }),
    failSafe: false,
  });
  expect((await safe.generate('Hello')).value).toBe('valid response');
});

it('does not read or overwrite oversized existing cache files', () => {
  const file = cacheFile();
  const content = JSON.stringify({ large: 'x'.repeat(1000) });
  writeFileSync(file, content);
  const cache = new Cache(file, { maxBytes: 100 });
  expect(cache.get('large')).toBeUndefined();
  cache.set('small', 'value');
  expect(readFileSync(file, 'utf8')).toBe(content);
});
