# Migration to 0.4.0

These changes apply to version 0.4.0. Update the package before using the new
behavior described below.

## Errors are raised by default

`SafeCall`, `fromEnv()`, and `ToolRunner` now propagate errors by default.
Remove assumptions that a failed call produces an empty object or string.

For an intentional display fallback, set `failSafe: true` and
`failSafeReturn`. Generation always returns that string on failure, including
when a schema was supplied. The previous unvalidated `{}` fallback is gone.
Check `typeof result.value === 'string'` before accessing schema fields.
The return type includes this possibility.

The CLI continues to raise by default; `--fail-safe` opts into a successful
exit with a fallback. Provider diagnostics contain an error class rather than
raw exception messages. Local schema and policy errors keep fixed guidance.

## Zod 4

Upgrade your application's direct dependency with `npm install zod@^4.6.7`
and migrate schemas to Zod 4. Zod 3 schema objects are incompatible.
Schemas must support `z.toJSONSchema(schema, { io: 'input' })`.

`SafeCall` now infers the schema's output type, including transforms.
Unsupported structured values, cycles, accessors, and excessive nesting are
rejected before return.

## Retries and circuit

`retries` must be an integer from 0 to 10. Rejected output, failed repairs,
and failed streams now count toward the circuit. After five consecutive
failed operations it stays open until `resetCircuit()` is called.
A completed operation resets the count. Local budget and rate denials do
not count.

## Pricing and cache

The example model prices have been removed. Register rates that match your
provider contract. For example, if your own rate is 0.2 currency units per
1,000 input tokens and 0.5 per 1,000 output tokens:

```js
import { PRICING, estimateCost } from 'llm-safecall';

PRICING['my-provider:my-model'] = { input: 0.2, output: 0.5 };
console.log(estimateCost('my-provider:my-model', 2000, 1000)); // 0.9
```

Missing rates or incomplete usage return `undefined`. Invalid rates and counts
raise `RangeError`. Built-in adapters do not use the helper automatically.

Caches default to memory. Entries belong to one `SafeCall` instance and do
not carry across a restart, even with file storage. Direct `Cache.set()`
values must be JSON-compatible.
