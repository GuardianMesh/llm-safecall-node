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
  .option('--fail-safe', 'Enable fail-safe mode (never throw)', false)
  .option('--stream', 'Stream output to stdout', false);

program.action(async (opts) => {
  try {
    if (!opts.prompt) {
      console.error('Missing --prompt');
      process.exit(0);
    }
    let schema: any = undefined;
    if (opts.schema) {
      const shape: Record<string, any> = {};
      for (const part of String(opts.schema).split(',')) {
        const [k, t] = part.split(':').map((s) => s.trim());
        if (!k) continue;
        shape[k] = t === 'number' || t === 'int' ? z.number() : z.string();
      }
      schema = z.object(shape);
    }

    const safe = fromEnv({ outputSchema: schema });
    if (opts.policy) (safe as any)['policy'] = loadPolicy(opts.policy);
    if (opts['failSafe']) { (safe as any)['failSafe'] = true; (safe as any)['failSafeReturn'] = ''; }

    if (opts.stream) {
      for await (const chunk of safe.streamGenerate(opts.prompt)) process.stdout.write(chunk);
      process.exit(0);
    } else {
      const res = await safe.generate(opts.prompt);
      console.log(schema ? JSON.stringify(res.value, null, 2) : String(res.value));
      process.exit(0);
    }
  } catch (e: any) {
    console.error(e?.message || String(e));
    process.exit(0);
  }
});

program.parseAsync().catch(() => process.exit(0));
