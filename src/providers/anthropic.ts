import type { ProviderResponse } from '../types';
export class AnthropicProvider {
  model: string; apiKey?: string;
  constructor(opts: { model?: string; apiKey?: string } = {}) { this.model = opts.model ?? 'claude-3-5-sonnet-20240620'; this.apiKey = opts.apiKey; }
  private async client() {
    try { const mod: any = await import('@anthropic-ai/sdk'); const Anthropic = mod.default; return new Anthropic({ apiKey: this.apiKey ?? process.env.ANTHROPIC_API_KEY }); }
    catch { throw new Error('Optional dependency missing: `npm i @anthropic-ai/sdk`'); }
  }
  async complete(prompt: string, params: Record<string, unknown> = {}): Promise<ProviderResponse> {
    const client = await this.client();
    const msg: any = await client.messages.create({ model: this.model, max_tokens: (params.maxTokens as number) ?? 512, temperature: (params.temperature as number) ?? 0.2, messages: [{ role: 'user', content: String(prompt) }] } as any);
    const text = (msg.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    return { text, model: this.model };
  }
  async *stream(prompt: string, params: Record<string, unknown> = {}) {
    const client = await this.client();
    const stream: any = await client.messages.stream({ model: this.model, max_tokens: (params.maxTokens as number) ?? 512, temperature: (params.temperature as number) ?? 0.2, messages: [{ role: 'user', content: String(prompt) }] });
    for await (const event of stream) { if (event.type === 'content_block_delta') { const delta = event.delta?.text ?? ''; if (delta) yield delta; } }
  }
}
