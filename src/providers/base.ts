import { ProviderResponse } from '../types';

export abstract class BaseProvider {
  protected model: string;
  protected apiKey?: string;

  constructor(opts: { model?: string; apiKey?: string }) {
    this.model = opts.model ?? this.getDefaultModel();
    this.apiKey = opts.apiKey;
  }

  abstract getDefaultModel(): string;
  protected abstract initializeClient(): Promise<any>;

  protected async getClient() {
    try {
      return await this.initializeClient();
    } catch (error) {
      throw new Error(`Failed to initialize provider client: ${error.message}`);
    }
  }

  protected getDefaultParams() {
    return {
      temperature: 0.2,
      maxTokens: 512
    };
  }

  abstract complete(prompt: string, params?: Record<string, unknown>): Promise<ProviderResponse>;
  abstract stream(prompt: string, params?: Record<string, unknown>): AsyncGenerator<string>;
}