import type { ProviderResponse } from '../types';
export class OpenAIProvider {
  model: string; apiKey?: string;
  constructor(opts: { model?: string; apiKey?: string } = {}) { this.model = opts.model ?? 'gpt-4o-mini'; this.apiKey = opts.apiKey; }
  private async client() {
    try { const mod: any = await import('openai'); const OpenAI = mod.default?.OpenAI ?? mod.OpenAI; if (!OpenAI) throw new Error('OpenAI client missing'); return new OpenAI({ apiKey: this.apiKey ?? process.env.OPENAI_API_KEY }); }
    catch { throw new Error('Optional dependency missing: `npm i openai`'); }
  }
  async complete(prompt: string, params: Record<string, unknown> = {}): Promise<ProviderResponse> {
    const client = await this.client();
    const resp = await client.chat.completions.create({ model: this.model, messages: [{ role: 'user', content: String(prompt) }], temperature: (params.temperature as number) ?? 0.2, max_tokens: (params.maxTokens as number) ?? 512 });
    const text = resp.choices?.[0]?.message?.content ?? ''; const usage: any = (resp as any).usage || {};
    return { text, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, model: this.model };
  }
  async *stream(prompt: string, params: Record<string, unknown> = {}) {
    const client = await this.client();
    const stream = await client.chat.completions.create({ model: this.model, messages: [{ role: 'user', content: String(prompt) }], temperature: (params.temperature as number) ?? 0.2, max_tokens: (params.maxTokens as number) ?? 512, stream: true });
    for await (const chunk of stream) { const delta = chunk.choices?.[0]?.delta?.content ?? ''; if (delta) yield delta; }
  }
}
