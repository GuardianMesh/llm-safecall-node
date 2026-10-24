// Example rates in USD per 1,000 tokens; replace with your provider's rates.
export const PRICING: Record<string, { input: number; output: number }> = {
  'openai:gpt-4o-mini': { input: 0.0003, output: 0.0012 },
  'anthropic:claude-3-5-sonnet-20240620': { input: 0.003, output: 0.015 },
};
export function estimateCost(vendorModel: string, inTok?: number, outTok?: number) {
  const p = PRICING[vendorModel];
  if (!p) return undefined;
  let total = 0;
  if (inTok) total += (inTok / 1000) * p.input;
  if (outTok) total += (outTok / 1000) * p.output;
  return Math.round(total * 1e6) / 1e6;
}
