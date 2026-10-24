#!/usr/bin/env node
import { Command } from 'commander';
import { fromEnv } from '../src/env.js';
import { loadPolicy } from '../src/policyYaml.js';
import { z } from 'zod';

const program = new Command();
program
  .name('llm-safecall')
  .description('Safe LLM caller (Node/TS)')
  .option('-p, --prompt <text>', 'Prompt text')
  .option('--policy <path>', 'Path to policy.yml')
  .option('--schema <fields>', 'Comma list like key:string,value:number')
  .option('--fail-safe', 'Return a fallback when generation fails', false)
  .option('--stream', 'Stream output to stdout', false);

program.action(async (opts) => {
  try {
    if (!opts.prompt) {
      console.error('Missing --prompt');
      process.exitCode = 1;
      return;
    }
    let schema: z.ZodTypeAny | undefined;
    if (opts.schema) {
      const shape: Record<string, z.ZodTypeAny> = Object.create(null);
      for (const part of String(opts.schema).split(',')) {
        const fields = part.split(':').map((s) => s.trim());
        const [k, t] = fields;
        if (fields.length !== 2 || !k || !['string', 'number', 'int', 'boolean'].includes(t)) {
          throw new Error(
            'Schema fields must use name:string, name:number, name:int or name:boolean',
          );
        }
        if (Object.hasOwn(shape, k)) throw new Error(`Duplicate schema field: ${k}`);
        shape[k] =
          t === 'int'
            ? z.number().int()
            : t === 'number'
              ? z.number()
              : t === 'boolean'
                ? z.boolean()
                : z.string();
      }
      schema = z.object(shape);
    }

    const safe = fromEnv({
      outputSchema: schema,
      failSafe: opts.failSafe,
      ...(opts.policy ? { policy: loadPolicy(opts.policy) } : {}),
    });

    if (opts.stream) {
      for await (const chunk of safe.streamGenerate(opts.prompt)) process.stdout.write(chunk);
    } else {
      const res = await safe.generate(opts.prompt);
      console.log(schema ? JSON.stringify(res.value, null, 2) : String(res.value));
    }
  } catch (e: any) {
    console.error(e?.message || String(e));
    process.exitCode = 1;
  }
});

program.parseAsync().catch(() => {
  process.exitCode = 1;
});
