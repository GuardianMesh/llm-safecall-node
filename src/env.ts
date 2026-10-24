import { SafeCall, type SafeCallParams } from './safeCall';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { MockProvider } from './providers/mock';
import { PolicyEngine } from './policy';

export function fromEnv<T = string>(opts: Omit<SafeCallParams<T>, 'llm' | 'model'> = {}) {
  const provider = (process.env.LLM_PROVIDER ?? 'openai').toLowerCase();
  if (!['openai', 'anthropic', 'mock'].includes(provider)) {
    throw new Error('LLM_PROVIDER must be openai, anthropic, or mock');
  }
  const model =
    process.env.LLM_MODEL ?? (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o-mini');
  const allowShell = (process.env.LLM_ALLOW_SHELL ?? 'false').toLowerCase() === 'true';
  const allowUrls = (process.env.LLM_URL_ALLOWLIST ?? '').split(',').filter(Boolean);
  const policy = new PolicyEngine({
    allowShellOutput: allowShell,
    outboundUrlAllowlist: allowUrls,
  });
  const llm =
    provider === 'anthropic'
      ? new AnthropicProvider({ model, apiKey: process.env.ANTHROPIC_API_KEY })
      : provider === 'mock'
        ? new MockProvider()
        : new OpenAIProvider({ model, apiKey: process.env.OPENAI_API_KEY });
  return new SafeCall({ llm, ...opts, policy: opts.policy ?? policy });
}
