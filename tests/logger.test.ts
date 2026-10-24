import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { expect, it } from 'vitest';

it('keeps running when the log reader closes stderr', async () => {
  const source = readFileSync(new URL('../src/logger.ts', import.meta.url), 'utf8');
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  const child = spawn(process.execPath, [
    '--input-type=module',
    '-e',
    compiled + `\nfor (let i = 0; i < 100; i++) logJson('complete');\nconsole.log('done');`,
  ]);
  child.stderr.destroy();
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  expect(code).toBe(0);
  expect(output).toBe('done\n');
});
