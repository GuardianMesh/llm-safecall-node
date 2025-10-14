import { z } from 'zod';
import { OpenAIProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { MockProvider } from './providers/mock';
import { PolicyEngine } from './policy';
import { SafeCall } from './safeCall';
import { logJson } from './logger';

const EnvConfig = z.object({
  LLM_PROVIDER: z.enum(['openai', 'anthropic', 'mock']).default('openai'),
  LLM_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_TIMEOUT_MS: z.coerce.number().default(20000),
  LLM_RETRIES: z.coerce.number().default(2),
  LLM_RATE_PER_SEC: z.coerce.number().default(5),
  LLM_ALLOW_SHELL: z.coerce.boolean().default(false),
  LLM_URL_ALLOWLIST: z.string().default(''),
  LLM_BUDGET_DAILY: z.coerce.number().default(100),
  LLM_CACHE_PATH: z.string().optional(),
  LLM_CIRCUIT_THRESHOLD: z.coerce.number().default(5)
});

export type Config = z.infer<typeof EnvConfig>;

export function fromEnv(opts: { outputSchema?: any } = {}) {
  let config: Config;
  try {
    config = EnvConfig.parse(process.env);
  } catch (error) {
    logJson('env_config_error', { error: error.message }, 'error');
    throw error;
  }

  const allowUrls = config.LLM_URL_ALLOWLIST.split(',').filter(Boolean);
  const policy = new PolicyEngine({
    allowShellOutput: config.LLM_ALLOW_SHELL,
    outboundUrlAllowlist: allowUrls
  });

  let provider;
  switch (config.LLM_PROVIDER) {
    case 'anthropic':
      provider = new AnthropicProvider({
        model: config.LLM_MODEL,
        apiKey: config.ANTHROPIC_API_KEY
      });
      break;
    case 'mock':
      provider = new MockProvider();
      break;
    default:
      provider = new OpenAIProvider({
        model: config.LLM_MODEL,
        apiKey: config.OPENAI_API_KEY
      });
  }

  return new SafeCall({
    llm: provider,
    outputSchema: opts.outputSchema,
    policy,
    timeoutMs: config.LLM_TIMEOUT_MS,
    retries: config.LLM_RETRIES,
    rateLimit: config.LLM_RATE_PER_SEC,
    circuitThreshold: config.LLM_CIRCUIT_THRESHOLD
  });
}