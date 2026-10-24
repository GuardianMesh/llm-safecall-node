import type { ProviderResponse } from '../types';
export class AnthropicProvider {
  model: string;
  apiKey?: string;
  constructor(opts: { model?: string; apiKey?: string } = {}) {
    this.model = opts.model ?? 'claude-sonnet-4-6';
    this.apiKey = opts.apiKey;
  }
  private async client() {
    const apiKey = this.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new TypeError('ANTHROPIC_API_KEY is required');
    let mod: any;
    try {
      mod = await import('@anthropic-ai/sdk');
    } catch (error) {
      throw new Error('Optional dependency could not be loaded: `npm i @anthropic-ai/sdk`', {
        cause: error,
      });
    }
    const Anthropic = mod.default;
    if (!Anthropic) throw new Error('Anthropic client missing');
    return new Anthropic({ apiKey, maxRetries: 0 });
  }
  async complete(prompt: string, params: Record<string, unknown> = {}): Promise<ProviderResponse> {
    const client = await this.client();
    const msg: any = await client.messages.create(
      {
        model: this.model,
        max_tokens: (params.maxTokens as number) ?? 512,
        messages: [{ role: 'user', content: String(prompt) }],
      } as any,
      { timeout: params.timeoutMs as number | undefined, maxRetries: 0 },
    );
    const text = (msg.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');
    return {
      text,
      model: this.model,
      inputTokens: msg.usage?.input_tokens,
      outputTokens: msg.usage?.output_tokens,
    };
  }
  async *stream(prompt: string, params: Record<string, unknown> = {}) {
    const client = await this.client();
    const stream: any = await client.messages.stream(
      {
        model: this.model,
        max_tokens: (params.maxTokens as number) ?? 512,
        messages: [{ role: 'user', content: String(prompt) }],
      },
      { timeout: params.timeoutMs as number | undefined, maxRetries: 0 },
    );
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta?.text ?? '';
        if (delta) yield delta;
      }
    }
  }
}
