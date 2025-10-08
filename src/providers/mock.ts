import type { ProviderResponse } from '../types';
export class MockProvider {
  model = 'mock-1';
  async complete(prompt: string): Promise<ProviderResponse> {
    const text = this._respond(prompt);
    return { text, inputTokens: Math.floor(prompt.length/4), outputTokens: Math.floor(text.length/4), model: this.model, cost: 0 };
  }
  async *stream(prompt: string) { yield this._respond(prompt); }
  private _respond(prompt: string): string {
    if (prompt.includes('Repair this to valid')) return '{"ok":true}';
    if (prompt.toLowerCase().includes('as json')) return "{bad:'json'}";
    return 'Mock response: ' + prompt.slice(0, 200);
  }
}
