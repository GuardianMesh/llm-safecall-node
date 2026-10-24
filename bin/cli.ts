#!/usr/bin/env node
import { Command } from 'commander';
import { fromEnv } from '../src/env.js';
import { loadPolicy } from '../src/policyYaml.js';
import { z } from 'zod';

class UsageError extends Error {}

const program = new Command();
program
  .name('llm-safecall')
  .description('Model calls with policy checks')
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
          throw new UsageError(
            'Schema fields must use name:string, name:number, name:int or name:boolean',
          );
        }
        if (Object.hasOwn(shape, k)) throw new UsageError('Schema fields must have unique names');
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

    let policy;
    if (opts.policy) {
      try {
        policy = loadPolicy(opts.policy);
      } catch {
        throw new UsageError('Could not load --policy. Check the file path and policy keys.');
      }
    }
    const provider = (process.env.LLM_PROVIDER ?? 'openai').toLowerCase();
    if (!['openai', 'anthropic', 'mock'].includes(provider)) {
      throw new UsageError('LLM_PROVIDER must be openai, anthropic, or mock');
    }
    const safe = fromEnv({
      outputSchema: schema,
      failSafe: opts.failSafe,
      ...(policy ? { policy } : {}),
    });

    if (opts.stream) {
      for await (const chunk of safe.streamGenerate(opts.prompt)) process.stdout.write(chunk);
    } else {
      const res = await safe.generate(opts.prompt);
      console.log(schema ? JSON.stringify(res.value, null, 2) : String(res.value));
    }
  } catch (e) {
    const detail = e instanceof UsageError ? e.message : e instanceof Error ? e.name : 'Error';
    console.error(`llm-safecall: ${detail}`);
    process.exitCode = 1;
  }
});

program.parseAsync().catch(() => {
  process.exitCode = 1;
});
