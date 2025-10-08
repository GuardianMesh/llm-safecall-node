import type { ZodSchema } from 'zod';
import { PolicyEngine } from './policy';
export class ToolRunner {
  private registry = new Map<string, { fn: Function; args?: ZodSchema; result?: ZodSchema }>();
  constructor(private policy: PolicyEngine, private failSafe: boolean = true) {}
  register(name: string, fn: Function, args?: ZodSchema, result?: ZodSchema) { this.registry.set(name, { fn, args, result }); }
  async call(name: string, args: Record<string, unknown>) {
    const entry = this.registry.get(name); if (!entry) throw new Error(`Tool not found: ${name}`);
    try {
      const validated = entry.args ? entry.args.parse(args) : args;
      const preChecked = Object.fromEntries(Object.entries(validated).map(([k,v]) => [k, typeof v === 'string' ? this.policy.preCall(v) : v]));
      const out = await entry.fn(preChecked);
      const textOut = typeof out === 'string' ? this.policy.postCall(out, !!entry.result) : out;
      return entry.result ? entry.result.parse(textOut) : textOut;
    } catch (_e) {
      if (this.failSafe) return entry?.result ? entry.result.parse({}) : '';
      throw _e;
    }
  }
}
