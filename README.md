# llm-safecall for Node.js

`llm-safecall` wraps model calls with input checks, output filtering, Zod schema
validation, retries, and structured logs. It includes OpenAI and Anthropic
adapters and a local mock provider.

The checks use fixed patterns and can miss prompt injections, secrets, and unsafe
output. Keep tool permissions and network access under application control, and
validate model output before executing it.

## Install

Requires Node.js 22 or later. The package exports ES modules and TypeScript types.

```sh
npm install llm-safecall
```

Provider SDKs are optional dependencies. If you installed with `--omit=optional`,
run `npm install --include=optional` to restore the SDK versions declared by the package.

## Try it without an API key

Save this as `example.mjs` and run `node example.mjs`:

```js
import { MockProvider, SafeCall } from 'llm-safecall';

const safe = new SafeCall({ llm: new MockProvider() });
const result = await safe.generate('Hello');
console.log(result.value);
console.log(result.report);
```

For structured output, supply a Zod 4 schema. The prepared 0.4.0 release requires
Zod 4 for both `outputSchema` and `ToolRunner` schemas. It is not yet published. Zod 3
schema objects are incompatible with the public types and schema conversion.
Existing users must upgrade their direct dependency with
`npm install zod@^4.6.7`, migrate their schemas to Zod 4, and rerun their tests.
This is a breaking change from the earlier Zod 3 API.

```ts
import { OpenAIProvider, SafeCall } from 'llm-safecall';
import { z } from 'zod';

const Summary = z.object({ title: z.string(), summary: z.string() });
const model = process.env.LLM_MODEL;
if (!model) throw new Error('Set LLM_MODEL to a model available to your account');
const safe = new SafeCall({
  llm: new OpenAIProvider({ model }),
  outputSchema: Summary,
  failSafe: false,
});
const result = await safe.generate('Return JSON with "title" and "summary" about unit tests.');
console.log(result.value);
```

Set `OPENAI_API_KEY` and select a model available to your account before running
that example. Provider calls and repair attempts may incur charges.

The Anthropic adapter defaults to `claude-sonnet-4-6`. It omits `temperature`
because the current [Anthropic API](https://platform.claude.com/docs/en/about-claude/model-deprecations#api-parameter-deprecations)
no longer accepts sampling parameters; the shared `temperature` option applies
to OpenAI only. Choose an explicit model for your deployment and review provider
retirement dates. The OpenAI default `gpt-4o-mini` is scheduled for removal on
January 14, 2027; see [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations).

The input JSON Schema is appended to the initial prompt and any repair prompt.
Schemas must support Zod's `toJSONSchema` conversion; unsupported types fail at
construction. This is prompt guidance, not provider-native constrained decoding.
Decoded JSON strings are checked before schema validation, and transformed
values are checked before return. Schema transforms run once per validation.

## Policies

YAML keys use the same camelCase names as `PolicyConfig`:

```yaml
blockSecrets: true
redactSecrets: true
allowShellOutput: false
outboundUrlAllowlist:
  - 'https://docs.example.com/'
jsonOnlyWhenSchema: true
maxInputChars: 20000
maxOutputChars: 10000
```

```ts
import { loadPolicy, MockProvider, SafeCall } from 'llm-safecall';

const safe = new SafeCall({
  llm: new MockProvider(),
  policy: loadPolicy('./policy.yml'),
});
```

See [policy.yml.example](https://github.com/GuardianMesh/llm-safecall-node/blob/main/policy.yml.example) for the full example. Unknown keys
and invalid value types are rejected. An empty URL allowlist leaves URLs
unchanged. URL filtering examines output text, not outbound network requests.
Allowed paths match a complete path or a directory beneath it. Encoded path
separators are rejected to avoid differing URL interpretations.

## Errors and fallback values

`generate()` uses fallback mode by default. A failed request returns an empty
string, or `{}` when a schema is supplied. The empty object is not validated
against that schema; check it before using required fields. Set `failSafe: false`
to receive errors instead. `failSafeReturn` customizes the text fallback.

Retries apply to individual provider calls, including repair calls. `retries: 0`
makes one attempt; a value of `n` allows at most `n + 1` attempts. Known permanent
HTTP, type, configuration and cancellation errors are not retried. Built-in SDK
retries are disabled so they cannot multiply this count. There is at most one
repair, only for invalid JSON or a schema mismatch. Policy and moderation failures
are never repaired. Repair prompts pass the same input policy, redaction and
moderation checks as the original prompt.

The circuit counts failures of the initial provider call after its retries are
exhausted. A successful initial call resets the count. After five failures, the
circuit stays open for that `SafeCall` instance; there is no timed cooldown.
Repair and streaming calls do not update this count.

`ToolRunner` runs registered functions in the current process. It validates
arguments and results when schemas are supplied and checks nested string
values and object keys. Only plain objects, arrays, JSON scalar values and
`undefined` are supported; accessors, cycles and excessive nesting are rejected. Argument checks run before schema validation, so a redacted value must
still satisfy the schema before the function is called. String result schemas
accept ordinary text; they do not imply JSON output. It is not a sandbox or authorization system. Tool lookup and fallback
schema validation and fallback policy checks can still throw, even when its
fallback mode is enabled.

## Streaming

```ts
for await (const chunk of safe.streamGenerate('Hello')) {
  process.stdout.write(chunk);
}
```

Streaming filters and moderates each chunk independently and bounds the total
received and emitted characters by `maxOutputChars`. Strict mode propagates
errors; fallback mode stops and emits the text fallback. Previously emitted
chunks cannot be recalled. Streaming does not validate a complete
structured result, retry failed streams, or detect patterns split across chunks.
Buffer and validate the full response if you need every check to pass before
displaying or acting on it.

## Environment and CLI

`fromEnv()` reads `LLM_PROVIDER`, `LLM_MODEL`, the provider API keys,
`LLM_ALLOW_SHELL`, and `LLM_URL_ALLOWLIST` from the process environment. It does
not load `.env` files. See [.env.example](https://github.com/GuardianMesh/llm-safecall-node/blob/main/.env.example).

For an application using `.env`, copy those settings into a local file and start
with `LLM_PROVIDER=mock`. Save this as `app.mjs`:

```js
import { fromEnv } from 'llm-safecall';

const safe = fromEnv({ failSafe: false });
console.log((await safe.generate('Hello')).value);
```

Node loads the file when you run `node --env-file=.env app.mjs`. For a live provider,
set `LLM_PROVIDER` to `openai` or `anthropic`, choose an available `LLM_MODEL`, and
set the matching API key. Keep `.env` out of version control; use your deployment's
secret store in production.

The installed CLI also accepts settings from the process environment:

```sh
LLM_PROVIDER=mock npx llm-safecall --prompt 'Hello'
npx llm-safecall --help
```

The CLI accepts `--policy`, `--schema title:string,count:number`, `--stream`, and
`--fail-safe`. Schema field types are `string`, `number`, `int`, and `boolean`;
unknown types and duplicate field names are rejected. The CLI reports generation
errors with a nonzero exit code by default. `--fail-safe` explicitly enables
fallback results and a successful exit status. Results go to stdout; structured
diagnostic logs go to stderr. Unlike the CLI, the library keeps fallback mode
enabled by default. `fromEnv({ failSafe: false })` selects strict library errors.

## Current limits

- `timeoutMs` is passed to built-in provider SDKs; custom providers must honor it.
  Retries are not a single overall deadline. Retry counts must be nonnegative
  safe integers, and timeouts must be positive safe integers.
- `TokenBucket` uses monotonic time and rejects invalid rates or charges. The
  optional rate limit admits each provider attempt, including retries, repairs
  and stream starts. `Budget` rejects invalid charges and corrupt stored totals.
- Reports aggregate available token usage and costs across generation and repair
  responses. Built-in providers report tokens but do not calculate monetary
  costs. A custom provider may return `cost`; known charges are persisted even
  when they exceed the daily limit, and exhausted budgets block later attempts.
  A charge can exceed the remaining budget because its amount is known only
  after the response. Missing costs and stream costs are not tracked; this is
  not a provider billing limit.
- Oversized output is rejected before any prefix is returned. Structured values
  apply the configured input/output character limit across all string values
  and keys, with additional caps of 64 levels, 10,000 nodes and 1 MiB of text.
- Caches are in memory by default. An explicit file path enables JSON persistence;
  entries belong to one `SafeCall` instance and are checked against its current
  policy and schema on every hit. New instances do not reuse earlier entries,
  including after a process restart. File-backed cache and budget storage are
  not designed for concurrent writers.

Caches hold at most 256 entries and 1 MiB of serialized keys and values by
default. The oldest written entries are evicted when either limit is reached;
oversized or non-serializable values are skipped. Override these limits with
`new Cache(undefined, { maxEntries: 512, maxBytes: 2 * 1024 * 1024 })`. Direct
`Cache.set()` calls must store JSON-compatible values. Cached values are
snapshots; changing a returned object does not change the stored entry.
Existing files over the configured limits are left untouched and treated as
cache misses; use a new path or raise the limit to read them.

## Development

Development tools require Node.js 22.12 or later.

```sh
npm ci --ignore-scripts
npm run check
npm pack --dry-run
```

See [CONTRIBUTING.md](https://github.com/GuardianMesh/llm-safecall-node/blob/main/CONTRIBUTING.md) and [SECURITY.md](https://github.com/GuardianMesh/llm-safecall-node/blob/main/SECURITY.md). The project
uses the [MIT license](LICENSE). Source and issues are on
[GitHub](https://github.com/GuardianMesh/llm-safecall-node).
