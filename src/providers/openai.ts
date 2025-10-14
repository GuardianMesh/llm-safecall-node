import { BaseProvider } from './base';
import { ProviderResponse } from '../types';
import { logJson } from '../logger';

export class OpenAIProvider extends BaseProvider {
  getDefaultModel(): string {
    return 'gpt-4o-mini';
  }

  protected async initializeClient() {
    try {
      const mod = await import('openai');
      const OpenAI = mod.default?.OpenAI ?? mod.OpenAI;
      if (!OpenAI) throw new Error('OpenAI client missing');
      return new OpenAI({ apiKey: this.apiKey ?? process.env.OPENAI_API_KEY });
    } catch (error) {
      logJson('provider_init_error', { provider: 'openai', error: error.message });
      throw new Error('Optional dependency missing: `npm i openai`');
    }
  }

  async complete(prompt: string, params: Record<string, unknown> = {}): Promise<ProviderResponse> {
    const client = await this.getClient();
    const defaultParams = this.getDefaultParams();
    
    try {
      const resp = await client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: String(prompt) }],
        temperature: (params.temperature as number) ?? defaultParams.temperature,
        max_tokens: (params.maxTokens as number) ?? defaultParams.maxTokens
      });

      const text = resp.choices?.[0]?.message?.content ?? '';
      const usage: any = (resp as any).usage || {};

      return {
        text,
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        model: this.model
      };
    } catch (error) {
      logJson('provider_complete_error', {
        provider: 'openai',
        model: this.model,
        error: error.message
      });
      throw error;
    }
  }

  async *stream(prompt: string, params: Record<string, unknown> = {}) {
    const client = await this.getClient();
    const defaultParams = this.getDefaultParams();

    try {
      const stream = await client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: String(prompt) }],
        temperature: (params.temperature as number) ?? defaultParams.temperature,
        max_tokens: (params.maxTokens as number) ?? defaultParams.maxTokens,
        stream: true
      });

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content ?? '';
        if (delta) yield delta;
      }
    } catch (error) {
      logJson('provider_stream_error', {
        provider: 'openai',
        model: this.model,
        error: error.message
      });
      throw error;
    }
  }
}