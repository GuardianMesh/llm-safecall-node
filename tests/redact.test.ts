import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { expect, it } from 'vitest';
import { redactEmailPhone } from '../src/redact';

it.each([
  ['Contact first.last+tag@example.co.uk.', 'Contact [REDACTED_EMAIL].'],
  ['a@host.com123@next.net', '[REDACTED_EMAIL][REDACTED_EMAIL]'],
  ['a@host.com-@next.net', '[REDACTED_EMAIL][REDACTED_EMAIL]'],
  ['a@invalid%user@example.com', 'a@[REDACTED_EMAIL]'],
  ['a@host.com123 and b@host.net-123', '[REDACTED_EMAIL]123 and [REDACTED_EMAIL]-123'],
  ['a@host..com and b@.com', '[REDACTED_EMAIL] and b@.com'],
  ['a@host.c, b@host.12, plain text', 'a@host.c, b@host.12, plain text'],
])('preserves email matching for %s', (input, expected) => {
  expect(redactEmailPhone(input, ['email'])).toBe(expected);
});

it('keeps redaction opt-in and combines email and phone fields', () => {
  const input = 'a@example.com +1 234-567-8901';
  expect(redactEmailPhone(input, [])).toBe(input);
  expect(redactEmailPhone(input, ['email', 'phone'])).toBe('[REDACTED_EMAIL] [REDACTED_PHONE]');
});

it('finishes long malformed email inputs within a bounded child process', () => {
  const source = readFileSync(new URL('../src/redact.ts', import.meta.url), 'utf8');
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      compiled +
        `
import assert from 'node:assert/strict';
for (const input of ['%'.repeat(1_000_000), 'a@' + 'x.'.repeat(250_000) + '1']) {
  assert.equal(redactEmailPhone(input, ['email']), input);
}
`,
    ],
    { encoding: 'utf8', timeout: 5_000 },
  );
  expect(child.error, child.error?.message).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
}, 10_000);
