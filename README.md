# llm-safecall (Node / TypeScript)

Secure, **fail-safe**, and observable wrapper for calling LLMs (OpenAI, Anthropic, Mock) with:
- Prompt-injection heuristics & secret scanning
- Output sanitization (strip shell blocks/commands, URL allowlist)
- Zod schema validation (JSON-only mode when schema provided)
- Retries, circuit breaker, budgets, and rate limiting
- Streaming support
- Structured JSON logs
- **Fail-safe by default:** worst case, it returns a harmless fallback and **won’t break your app**

## Install
```bash
npm i llm-safecall
# Provider SDKs are optional; install what you use:
npm i openai
npm i @anthropic-ai/sdk
```

## Quickstart
```ts
import { SafeCall, OpenAIProvider } from 'llm-safecall';
import { z } from 'zod';

const Output = z.object({ title: z.string(), summary: z.string() });

const safe = new SafeCall({
  llm: new OpenAIProvider({ model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY }),
  outputSchema: Output  // enforce JSON-only output
});

const res = await safe.generate('Return ONLY valid JSON with keys: title, summary');
console.log(res.value);  // {} if fail-safe repair fails
```

## Streaming
```ts
const safe = new SafeCall({ llm: new OpenAIProvider({ model: 'gpt-4o-mini' }) });
for await (const chunk of safe.streamGenerate('Explain zero-knowledge proofs.')) {
  process.stdout.write(chunk);
}
```

## fromEnv
```ts
import { fromEnv } from 'llm-safecall';
const safe = fromEnv(); // reads LLM_PROVIDER, LLM_MODEL, OPENAI_API_KEY, etc.
```

## ToolRunner (agents)
```ts
import { ToolRunner, PolicyEngine } from 'llm-safecall';
import { z } from 'zod';

const runner = new ToolRunner(new PolicyEngine({}));
runner.register('fetch', async ({ url }) => `Fetched ${url}`, z.object({ url: z.string().url() }));
const out = await runner.call('fetch', { url: 'https://example.com' });
```

## Fail-safe by default (won’t break your app)
- `SafeCall` (generate/stream) and `ToolRunner` are **fail-safe by default**.
- If provider SDKs are missing, policy fails, or network errors occur, they return a harmless fallback (`""` or `{}`) without throwing.
- Set `failSafe: false` only when you want strict errors during debugging.

## Environment
- `LLM_PROVIDER=openai|anthropic|mock`
- `LLM_MODEL=` model string (e.g. `gpt-4o-mini`, `claude-3-5-sonnet-20240620`)
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- `LLM_TIMEOUT_MS`, `LLM_RETRIES`, `LLM_RATE_PER_SEC`
- `LLM_ALLOW_SHELL`, `LLM_URL_ALLOWLIST`
- `LLM_BUDGET_DAILY`, `LLM_BUDGET_PATH`
