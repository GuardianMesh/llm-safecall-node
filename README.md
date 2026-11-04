# llm-safecall

Validate LLM JSON responses with Zod, retry failed model calls, and keep a call report.
Supports OpenAI, Anthropic, and custom providers on Node.js 22+.

Try the [no-key response-validation walkthrough](https://github.com/GuardianMesh/llm-safecall-node/blob/main/docs/validated-responses.md)
for verified examples of Zod validation, transient retries, schema repair and
display-only fallback using the published package.

Use it when several call sites need the same validation and error handling.
If your application already handles those in a provider SDK or framework,
you probably don't need another wrapper.

The text filters match known patterns. They can miss attacks and reject harmless
text. Tool permissions, approvals, and process isolation belong in the
application; this package does not enforce them.

## Install

```sh
npm install llm-safecall zod@^4.6.7
```

The package exports ES modules and TypeScript types. Provider SDKs are optional
dependencies. After installing with `--omit=optional`, use
`npm install --include=optional` to restore them.

Version **0.4.0** requires **Zod 4** and raises errors by default. Existing users should read the
[migration notes](https://github.com/GuardianMesh/llm-safecall-node/blob/main/docs/migration.md).

## Validate a response

Set `OPENAI_API_KEY` and `LLM_MODEL` to a model available to your account.
Save this as `summary.mjs` and run `node summary.mjs`:

```js
import { OpenAIProvider, SafeCall } from 'llm-safecall';
import { z } from 'zod';

const model = process.env.LLM_MODEL;
if (!model) throw new Error('Set LLM_MODEL');

const safe = new SafeCall({
  llm: new OpenAIProvider({ model }),
  outputSchema: z.object({ title: z.string(), summary: z.string() }),
  timeoutMs: 15_000,
  retries: 2,
});
const { value, report } = await safe.generate('Return a title and summary about unit tests.');
console.log(value);
console.log(report);
```

The schema is included in the prompt. Invalid JSON or a schema mismatch gets
one repair call; a policy rejection raises immediately. Requests can incur
charges, including retries and repairs.

Without `outputSchema`, `value` is a string. To check installation without
credentials:

```sh
LLM_PROVIDER=mock npx llm-safecall --prompt 'Hello'
```

## Handle errors

Calls raise by default. Catch errors where your application can decide whether
to retry later, show a message, or abandon the operation. Set `retries: 0` if
another layer already retries requests.

For a display-only fallback, opt in explicitly:

```js
const safe = new SafeCall({
  llm: new OpenAIProvider({ model }),
  outputSchema: z.object({ title: z.string(), summary: z.string() }),
  failSafe: true,
  failSafeReturn: 'Summary unavailable',
});
const { value } = await safe.generate('Summarize the release notes.');
if (typeof value === 'string') {
  console.log(value);
} else {
  console.log(value.title);
}
```

A fallback is always a string, even with a schema. It is not a validated result.
TypeScript infers schema output and includes the possible string fallback in
the return type.

## Configure checks

Pass `policy: loadPolicy('./policy.yml')` to load a
[policy file](https://github.com/GuardianMesh/llm-safecall-node/blob/main/policy.yml.example).
Use `redact: ['email', 'phone']` for input redaction. Settings from the process
environment are available through `fromEnv()`; it does not load `.env` files.

Streaming checks individual chunks. A secret or other pattern split across
chunks can pass through. Use `generate()` when the complete response must pass
validation before anything is displayed or executed.

The [behavior reference](https://github.com/GuardianMesh/llm-safecall-node/blob/main/docs/behavior.md)
covers defaults, retries, streaming, tools, reports, budgets, caches, and the CLI.

## Related packages

Use [Agent Guard](https://github.com/ShieldaAI/agent-guard) when an agent also needs
resource-scoped tool permissions, approvals and budgets. Use
[Security Watch](https://github.com/ShieldaAI/security-watch) to monitor advisory
evidence for a dependency inventory. The
[package selection guide](https://github.com/ShieldaAI/agent-guard/blob/main/docs/package-guide.md)
explains their separate roles. For Pydantic validation, see the
[Python SafeCall package](https://github.com/GuardianMesh/llm-safecall).

## Development

Development tools require Node.js 22.12 or later.

```sh
npm ci --ignore-scripts
npm run check
npm pack --dry-run
```

[Contributing](https://github.com/GuardianMesh/llm-safecall-node/blob/main/CONTRIBUTING.md)
· [Security reports](https://github.com/GuardianMesh/llm-safecall-node/blob/main/SECURITY.md)
· [MIT license](LICENSE)
