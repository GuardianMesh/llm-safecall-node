import type { ZodSchema } from 'zod';
import { PolicyEngine } from './policy';
import { checkValue, verifyValue } from './values';
export class ToolRunner {
  private registry = new Map<string, { fn: Function; args?: ZodSchema; result?: ZodSchema }>();
  constructor(
    private policy: PolicyEngine,
    private failSafe: boolean = false,
  ) {}
  register(name: string, fn: Function, args?: ZodSchema, result?: ZodSchema) {
    this.registry.set(name, { fn, args, result });
  }
  async call(name: string, args: Record<string, unknown>) {
    const entry = this.registry.get(name);
    if (!entry) throw new Error(`Tool not found: ${name}`);
    try {
      if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        throw new TypeError('Tool arguments must be an object');
      }
      const preChecked = checkValue(
        args,
        (text) => this.policy.preCall(text),
        this.policy.maxInputChars,
      );
      const validated = entry.args ? entry.args.parse(preChecked) : preChecked;
      if (validated === null || typeof validated !== 'object' || Array.isArray(validated)) {
        throw new TypeError('Tool arguments must be an object');
      }
      verifyValue(validated, (text) => this.policy.preCall(text), this.policy.maxInputChars);
      const out = await entry.fn(validated);
      const checked = checkValue(
        out,
        (text) => this.policy.postCall(text, false),
        this.policy.maxOutputChars,
      );
      const result = entry.result ? entry.result.parse(checked) : checked;
      verifyValue(result, (text) => this.policy.postCall(text, false), this.policy.maxOutputChars);
      return result;
    } catch (_e) {
      if (this.failSafe) {
        const fallback = entry.result ? entry.result.parse({}) : '';
        verifyValue(
          fallback,
          (text) => this.policy.postCall(text, false),
          this.policy.maxOutputChars,
        );
        return fallback;
      }
      throw _e;
    }
  }
}
