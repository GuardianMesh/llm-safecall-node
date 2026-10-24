import { defineConfig } from 'tsup';
export default defineConfig({
  entry: { index: 'src/index.ts', 'bin/cli': 'bin/cli.ts' },
  format: ['esm'],
  external: ['openai', '@anthropic-ai/sdk'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'node22',
});
