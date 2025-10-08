import { PolicyViolationError } from './types';
import { scanSecrets, redactFindings } from './secrets';
import { stripCodeBlocks, stripDangerousCommands, allowlistUrls } from './sanitize';

const DEFAULT_SIGNS = [
  'ignore previous instructions',
  'disregard prior instructions',
  'reveal the system prompt',
  'show hidden prompt',
  'exfiltrate',
  'send to http',
  'upload to',
  'base64 encode the following secrets'
];

export type PolicyConfig = {
  blockSecrets?: boolean;
  redactSecrets?: boolean;
  allowShellOutput?: boolean;
  outboundUrlAllowlist?: string[];
  jsonOnlyWhenSchema?: boolean;
  maxOutputChars?: number;
  maxInputChars?: number;
  forbidInjectionPhrases?: string[];
};

export class PolicyEngine {
  constructor(private cfg: PolicyConfig = {}) {}

  preCall(prompt: string): string {
    const maxIn = this.cfg.maxInputChars ?? 20000;
    if (prompt.length > maxIn) throw new PolicyViolationError(`Prompt too long (>${maxIn})`);
    const lowered = prompt.toLowerCase();
    for (const phrase of this.cfg.forbidInjectionPhrases ?? DEFAULT_SIGNS) {
      if (lowered.includes(phrase)) throw new PolicyViolationError('Prompt contains injection markers');
    }
    if (this.cfg.blockSecrets ?? true) {
      const findings = scanSecrets(prompt);
      if (findings.length) {
        if (this.cfg.redactSecrets ?? true) return redactFindings(prompt, findings);
        throw new PolicyViolationError('Secrets detected in prompt');
      }
    }
    return prompt;
  }

  postCall(text: string, schemaExpected: boolean): string {
    const outMax = this.cfg.maxOutputChars ?? 10000;
    if (text.length > outMax) text = text.slice(0, outMax) + '...[TRUNCATED]';
    if (this.cfg.blockSecrets ?? true) {
      const findings = scanSecrets(text);
      if (findings.length) {
        if (this.cfg.redactSecrets ?? true) text = redactFindings(text, findings);
        else throw new PolicyViolationError('Secrets detected in output');
      }
    }
    text = stripCodeBlocks(text, this.cfg.allowShellOutput ?? false);
    text = stripDangerousCommands(text, this.cfg.allowShellOutput ?? false);
    text = allowlistUrls(text, this.cfg.outboundUrlAllowlist ?? []);

    if (schemaExpected && (this.cfg.jsonOnlyWhenSchema ?? true)) {
      const s = text.trim();
      if (!(s.startsWith('{') || s.startsWith('['))) throw new PolicyViolationError('Non-JSON output when JSON schema expected');
    }
    return text;
  }
}
