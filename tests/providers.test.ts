import { expect, it } from 'vitest';
import { OpenAIProvider } from '../src/providers/openai';
import { AnthropicProvider } from '../src/providers/anthropic';

it('passes the timeout to OpenAI requests', async () => {
  const provider = new OpenAIProvider({ model: 'test-model' });
  const calls: unknown[][] = [];
  Object.assign(provider, {
    client: async () => ({
      chat: {
        completions: {
          create: async (...args: unknown[]) => {
            calls.push(args);
            return { choices: [{ message: { content: 'Response' } }] };
          },
        },
      },
    }),
  });
  expect((await provider.complete('Hello', { timeoutMs: 1234 })).text).toBe('Response');
  expect(calls[0]?.[1]).toEqual({ timeout: 1234, maxRetries: 0 });
});

it('passes the timeout to Anthropic requests', async () => {
  const provider = new AnthropicProvider({ model: 'test-model' });
  const calls: unknown[][] = [];
  Object.assign(provider, {
    client: async () => ({
      messages: {
        create: async (...args: unknown[]) => {
          calls.push(args);
          return { content: [{ type: 'text', text: 'Response' }] };
        },
      },
    }),
  });
  expect((await provider.complete('Hello', { timeoutMs: 1234 })).text).toBe('Response');
  expect(calls[0]?.[1]).toEqual({ timeout: 1234, maxRetries: 0 });
});

it('configures installed SDK clients without hidden transport retries', async () => {
  for (const provider of [
    new OpenAIProvider({ model: 'test-model', apiKey: 'test-only-not-a-real-key' }),
    new AnthropicProvider({ model: 'test-model', apiKey: 'test-only-not-a-real-key' }),
  ]) {
    const client = await (
      provider as unknown as { client(): Promise<{ maxRetries: number }> }
    ).client();
    expect(client.maxRetries).toBe(0);
  }
});

it('uses an available Anthropic default and omits unsupported sampling parameters', async () => {
  const provider = new AnthropicProvider();
  expect(provider.model).toBe('claude-sonnet-4-6');
  const calls: unknown[][] = [];
  Object.assign(provider, {
    client: async () => ({
      messages: {
        create: async (...args: unknown[]) => {
          calls.push(args);
          return { content: [{ type: 'text', text: 'Response' }] };
        },
        stream: async (...args: unknown[]) => {
          calls.push(args);
          return (async function* () {
            yield { type: 'content_block_delta', delta: { text: 'Response' } };
          })();
        },
      },
    }),
  });
  await provider.complete('Hello', { temperature: 0.2 });
  for await (const chunk of provider.stream('Hello', { temperature: 0.2 })) {
    expect(chunk).toBe('Response');
  }
  expect(calls).toHaveLength(2);
  for (const [body] of calls) {
    expect(body).toMatchObject({ model: 'claude-sonnet-4-6' });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('top_k');
  }
});
