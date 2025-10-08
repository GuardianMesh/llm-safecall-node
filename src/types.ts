export type ProviderResponse = {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  cost?: number;
};

export interface Provider {
  complete(prompt: string, params?: Record<string, unknown>): Promise<ProviderResponse>;
  stream(prompt: string, params?: Record<string, unknown>): AsyncIterable<string>;
}

export type CallReport = {
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  costEstimate?: number;
};

export type SafeResult<T> = {
  value: T;
  report: CallReport;
};

export class CircuitOpenError extends Error {}
export class PolicyViolationError extends Error {}
export class BudgetExceededError extends Error {}
export class RateLimitExceededError extends Error {}
