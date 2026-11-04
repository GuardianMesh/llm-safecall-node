# Validate LLM JSON responses with Zod and retries in Node.js

Use SafeCall when several model-call sites need the same response validation,
retry behavior and call reports. This example exercises the published npm
`llm-safecall@0.4.0` API using a deterministic local provider. It demonstrates
valid JSON, one transient failure, invalid schema output and a display fallback.
No model API key or provider SDK is needed.

## Install

Use Node.js 22 or newer in a new directory:

```sh
mkdir safecall-demo
cd safecall-demo
npm init -y
npm install --ignore-scripts --omit=optional --save-exact llm-safecall@0.4.0 zod@4.6.7
```

## Run the example

Save this as `validated-response.mjs`:

```js
import assert from 'node:assert/strict';
import { SafeCall } from 'llm-safecall';
import { z } from 'zod';

// A custom local provider exercises the real published SafeCall API without an API key.
class FixtureProvider {
  model = 'local-fixture';
  calls = 0;
  constructor(responses) {
    this.responses = responses;
  }
  async complete() {
    const response = this.responses[Math.min(this.calls++, this.responses.length - 1)];
    if (response instanceof Error) throw response;
    return {
      text: JSON.stringify(response),
      inputTokens: 10,
      outputTokens: 5,
      model: this.model,
      cost: 0,
    };
  }
  async *stream() {
    yield (await this.complete()).text;
  }
}

const schema = z.object({ title: z.string().min(1), count: z.number().int().nonnegative() });
const valid = { title: 'Quarterly report', count: 2 };
const invalid = { title: 7, count: 'two' };

const accepted = new SafeCall({
  llm: new FixtureProvider([valid]),
  outputSchema: schema,
  retries: 0,
});
const result = await accepted.generate('Return the fixture report.');
assert.deepEqual(result.value, valid);
assert.equal(result.report.model, 'local-fixture');
console.log(`VALIDATED ${JSON.stringify(result.value)}; call report attached`);

const retryProvider = new FixtureProvider([new Error('Synthetic transient failure'), valid]);
const retried = await new SafeCall({
  llm: retryProvider,
  outputSchema: schema,
  retries: 1,
}).generate('Return the fixture report after a transient failure.');
assert.deepEqual(retried.value, valid);
assert.equal(retryProvider.calls, 2);
console.log(`RETRIED transient failure; provider calls: ${retryProvider.calls}`);

const invalidProvider = new FixtureProvider([invalid]);
await assert.rejects(
  () =>
    new SafeCall({ llm: invalidProvider, outputSchema: schema, retries: 0 }).generate(
      'Return the invalid fixture report.',
    ),
  (error) => error instanceof z.ZodError,
);
assert.equal(invalidProvider.calls, 2); // Initial response plus one schema-repair attempt.
console.log(`REJECTED invalid schema after one repair; provider calls: ${invalidProvider.calls}`);

const fallbackProvider = new FixtureProvider([invalid]);
const fallback = await new SafeCall({
  llm: fallbackProvider,
  outputSchema: schema,
  retries: 0,
  failSafe: true,
  failSafeReturn: 'Summary unavailable',
}).generate('Return the display-only fallback fixture.');
assert.equal(fallback.value, 'Summary unavailable');
assert.equal(typeof fallback.value, 'string');
console.log('FALLBACK Summary unavailable; string, not validated schema output');
console.log('All assertions passed. Local fixtures; no network or model requests.');
```

```sh
node validated-response.mjs
```

Expected standard output:

```text
VALIDATED {"title":"Quarterly report","count":2}; call report attached
RETRIED transient failure; provider calls: 2
REJECTED invalid schema after one repair; provider calls: 2
FALLBACK Summary unavailable; string, not validated schema output
All assertions passed. Local fixtures; no network or model requests.
```

The default logger also writes call events to standard error; timestamps and
call IDs vary. The fixture provider records zero monetary cost. A live provider
can charge for every request, including retries and repairs.

## Understand errors and repair calls

SafeCall 0.4.0 raises errors by default. A schema mismatch can make one repair
request, even with `retries: 0`; that setting disables transient retries, not the
separate repair step. This example verifies both behaviors by counting provider
calls.

The `failSafe` fallback is explicitly enabled and returns a string. It must not
be treated as a validated object. Without that option, let the application catch
an error and decide whether to show a message or retry later.

A provider schema or a response validator does not authorize agent tools. Use
[Agent Guard](https://github.com/ShieldaAI/agent-guard) for registered tool calls
that need resource-scoped grants and approvals. For Python/Pydantic, use the
[separate Python example](https://github.com/GuardianMesh/llm-safecall/blob/main/docs/validated-responses.md).

See [behavior](behavior.md), [migration](migration.md), and the
[standalone example](../examples/validated-response.mjs). This guide uses the
released completion API; it does not depend on locally developed buffered-stream
or admission extensions.
