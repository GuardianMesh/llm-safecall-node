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
