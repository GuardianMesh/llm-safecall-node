# Behavior reference

## Defaults

`SafeCall` accepts a provider with `complete()` and `stream()` methods.

| Option                | Default             | Meaning                                                       |
| --------------------- | ------------------- | ------------------------------------------------------------- |
| `outputSchema`        | None                | Zod 4 schema; otherwise return text                           |
| `timeoutMs`           | `20000`             | Timeout passed to each provider attempt                       |
| `retries`             | `2`                 | Additional attempts per provider call, from 0 to 10           |
| `moderation`          | `true`              | Reject the substrings `bomb`, `dox`, and `credit card number` |
| `redact`              | `[]`                | Optional input email and phone redaction                      |
| `failSafe`            | `false`             | Return a string fallback on error                             |
| `failSafeReturn`      | `''`                | Fallback text                                                 |
| `cache`               | New in-memory cache | Reuse checked responses within this instance                  |
| `budget`, `rateLimit` | None                | Optional accounting and request admission                     |

The moderation check is a case-insensitive substring list, including matches
inside other words. It does not understand context. Set `moderation: false` if
your application supplies its own moderation.

## Policy

`loadPolicy('./policy.yml')` returns a `PolicyEngine`. Unknown keys and invalid
types are rejected. YAML keys use the same camelCase names as `PolicyConfig`:

```yaml
blockSecrets: true
redactSecrets: true
allowShellOutput: false
outboundUrlAllowlist: []
jsonOnlyWhenSchema: true
maxInputChars: 20000
maxOutputChars: 10000
```

When `blockSecrets` is enabled, recognized secrets are redacted if
`redactSecrets` is true and rejected otherwise. These patterns are incomplete.

Omitting `forbidInjectionPhrases` uses the built-in phrase list; `[]` disables
that check. Phrase matches reject input, including repair prompts.
Shell filtering removes a small set of recognizable commands and code blocks.

An empty URL allowlist leaves output URLs unchanged. An allowed URL matches
scheme, authority, and either the exact path or a directory beneath it. Paths
with dot segments or encoded separators are rejected. This filters text; it
does not restrict network requests.

Oversized input and output are rejected. Structured checks inspect decoded JSON
strings and keys before schema validation and transformed values after it.
Only plain objects, arrays, JSON scalar values, and `undefined` are supported;
accessors, cycles, and excessive nesting are rejected. Character limits apply
across all strings and keys, with additional caps of 64 levels, 10,000 nodes, and
1 MiB of text.

## Generation and errors

`generate()` returns `{ value, report }`. TypeScript infers the schema's output
type. The return type includes a possible string fallback, even when fallback
mode is disabled.

Zod's input JSON Schema is appended to initial and repair prompts. Schemas must
support `z.toJSONSchema()` conversion; unsupported types fail at construction.
This does not enable provider-native constrained decoding. Transforms run once
per validation. Invalid JSON or a schema mismatch allows one repair call.
Policy and moderation rejections are not repaired. Repair prompts go through
input checks.

Each initial or repair call can make `retries + 1` attempts. Permanent HTTP,
type, configuration, and cancellation errors are not retried. Built-in SDK
retries are disabled. Every attempt consumes a rate-limit token and checks the
recorded budget. The timeout applies per attempt; there is no single deadline
for the operation. Custom providers must honor it.

Five consecutive failed generation operations open the circuit. Rejected
output, failed repairs, and failed streams count. A completed operation resets
the count; local budget and rate denials do not count. There is no timed
cooldown. Call `resetCircuit()` after investigating the failures.

`failSafe: true` catches generation errors and returns `failSafeReturn` with
a report containing zero latency and no usage. This includes policy errors
and an open circuit. The fallback is not checked against a schema or output
policy; use trusted display text.

## Streaming and tools

`streamGenerate(prompt)` yields filtered strings. It bounds received and emitted
text by `maxOutputChars`, checks chunks independently, and does not validate a
final structured result or retry a failed stream. Patterns split across chunks
can escape checks. Already yielded text cannot be recalled. In fallback mode a
failure yields the fallback after any earlier chunks.

`ToolRunner` checks nested arguments, validates registered argument schemas,
calls the function, then checks and validates its result. Values introduced by
schema validation are checked too. String result schemas accept ordinary text.

Tool exceptions propagate by default. The legacy opt-in fallback mode
(`new ToolRunner(policy, true)`) tries `{}` through the result schema, or returns
`''` when there is no result schema. Tool lookup and fallback validation can
still throw. Functions run in the caller's process with its permissions; the
runner provides no authorization or isolation.

## Reports, budgets, and rates

Reports contain total generation latency, model, and token usage and cost when
all successful provider responses supply them. Initial and repair responses
are combined. Failed requests can incur unreported charges. Built-in adapters
report token usage but do not calculate monetary cost.

`Budget` records supplied amounts by UTC day and checks the recorded limit
before each attempt. A response can exceed the limit: the known charge is saved,
an error is raised, and later provider work is blocked. Unknown costs, streaming,
and simultaneous requests prevent this from enforcing a strict spending cap.
File-backed budgets do not support concurrent writers.

`new TokenBucket(0.5)` admits one initial request and refills one token every two
seconds. Default capacity is at least one token. Admission rejects immediately
when there are not enough tokens; it does not queue work.

The optional pricing helper starts with an empty `PRICING` registry. Supply
your own rates per 1,000 tokens before calling `estimateCost()`. Missing rates
or either missing token count return `undefined`. Rates must be finite
nonnegative numbers and counts must be nonnegative safe integers. The helper
is not called automatically by provider adapters.

## Cache

Cache storage is in memory unless you pass a JSON file path to `Cache`.
Entries belong to one `SafeCall` instance. A new instance, including after a
restart, does not reuse old entries. Every hit is checked against the current
policy and schema. Hits retain the original report and add no budget entry.

Values are serialized snapshots. Direct `Cache.set()` calls accept
JSON-compatible values. Defaults are 256 entries and 1 MiB of serialized keys
and values, with oldest-written entries evicted first. Oversized or
non-serializable entries are skipped.

Override limits with
`new Cache(undefined, { maxEntries: 512, maxBytes: 2 * 1024 * 1024 })`.
Existing files over these limits are left untouched and treated as cache misses.
File-backed storage does not support concurrent writers.

## Providers and CLI

Choose the model explicitly. The OpenAI adapter sends Chat Completions requests;
the Anthropic adapter sends Messages requests and omits sampling parameters.
The shared `temperature` option applies to OpenAI only. Check the provider's
documentation for model support.

Custom `complete(prompt, params)` methods return a `ProviderResponse`;
`stream(prompt, params)` returns an async iterable of strings. Honor `timeoutMs`.
Omit unknown usage or cost instead of reporting zero.

`fromEnv()` reads `LLM_PROVIDER`, `LLM_MODEL`, provider API keys,
`LLM_ALLOW_SHELL`, and `LLM_URL_ALLOWLIST`. It does not load files. See
[the example](../.env.example); use `node --env-file=.env app.mjs` to load a local
file explicitly.

The CLI accepts `--policy`, `--schema title:string,count:number`, `--stream`,
and `--fail-safe`. Schema types are `string`, `number`, `int`, and `boolean`.
Unknown types and duplicate names are rejected. Results go to stdout and JSON
logs to stderr. Errors exit with nonzero status. Schema and policy errors include
fixed guidance; provider errors report only the exception class. An explicit
generation fallback exits successfully.
