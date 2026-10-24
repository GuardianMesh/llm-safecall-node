import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { expect, it } from 'vitest';
import { PolicyEngine } from '../src/policy';
import { redactFindings, scanSecrets } from '../src/secrets';
import { allowlistUrls } from '../src/sanitize';

it('redacts overlapping findings without deleting the text after them', () => {
  const text = 'Bearer ghp_' + 'a1'.repeat(18) + ' and useful text';
  const findings = scanSecrets(text);
  expect(findings.map((finding) => finding.name)).toEqual(
    expect.arrayContaining(['github_pat', 'generic_bearer']),
  );
  expect(redactFindings(text, findings)).toBe('[REDACTED_GENERIC_BEARER] and useful text');
  expect(new PolicyEngine().postCall(text, false)).toBe(
    '[REDACTED_GENERIC_BEARER] and useful text',
  );
});

it('merges crossing spans without exposing the uncovered tail', () => {
  const text = '0123456789 remains';
  const findings = [
    { name: 'first', start: 0, end: 6, match: '012345' },
    { name: 'second', start: 4, end: 10, match: '456789' },
  ];
  expect(redactFindings(text, findings)).toBe('[REDACTED_FIRST] remains');
  expect(findings[0].end).toBe(6);
});

it('requires letters and digits within the candidate AWS secret', () => {
  expect(scanSecrets('a'.repeat(40) + ' trailing 1')).toEqual([]);
  expect(scanSecrets('a'.repeat(39) + '1').map((finding) => finding.name)).toContain(
    'aws_secret_access_key',
  );
});

it.each([
  'https://docs.example.test/blocked/../guide/start',
  'https://docs.example.test/blocked/%2e%2e/guide/start',
  'https://docs.example.test/guide/./start',
  'https://docs.example.test/guide/%2fstart',
])('rejects ambiguous paths before URL normalization: %s', (url) => {
  expect(allowlistUrls(url, ['https://docs.example.test/guide/'])).toBe('[BLOCKED_URL]');
});

it('rejects ambiguous allowlist paths too', () => {
  expect(
    allowlistUrls('https://docs.example.test/guide/start', [
      'https://docs.example.test/blocked/../guide/',
    ]),
  ).toBe('[BLOCKED_URL]');
});

it.each([
  'PRIVATE KEY',
  'ENCRYPTED PRIVATE KEY',
  'RSA PRIVATE KEY',
  'EC PRIVATE KEY',
  'DSA PRIVATE KEY',
  'OPENSSH PRIVATE KEY',
  'PGP PRIVATE KEY BLOCK',
])('redacts %s blocks', (label) => {
  const key = `-----BEGIN ${label}-----\nsynthetic-key-material\n-----END ${label}-----`;
  const policy = new PolicyEngine();
  expect(policy.preCall(key)).toBe('[REDACTED_PRIVATE_KEY_BLOCK]');
  expect(policy.postCall(key, false)).toBe('[REDACTED_PRIVATE_KEY_BLOCK]');
});

it('keeps public keys intact', () => {
  const key = '-----BEGIN PUBLIC KEY-----\npublic-material\n-----END PUBLIC KEY-----';
  expect(new PolicyEngine().preCall(key)).toBe(key);
});

it('does not leak private key material when nested tokens are also detected', () => {
  const key =
    '-----BEGIN RSA PRIVATE KEY-----\n' +
    'Bearer x\n'.repeat(8) +
    'secret-material\n-----END RSA PRIVATE KEY-----';
  expect(new PolicyEngine().preCall('before\n' + key + '\nafter')).toBe(
    'before\n[REDACTED_PRIVATE_KEY_BLOCK]\nafter',
  );
});

it('scans repeated ordinary words within a bounded process', () => {
  const source = readFileSync(new URL('../src/secrets.ts', import.meta.url), 'utf8');
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      compiled +
        `\nimport assert from 'node:assert/strict';\nassert.deepEqual(scanSecrets('a '.repeat(100_000)), []);`,
    ],
    { encoding: 'utf8', timeout: 5_000 },
  );
  expect(child.error, child.error?.message).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
}, 10_000);
