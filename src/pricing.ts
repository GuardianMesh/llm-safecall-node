// Caller-supplied rates per 1,000 tokens, in a consistent currency.
export const PRICING: Record<string, { input: number; output: number }> = Object.create(null);
export function estimateCost(vendorModel: string, inTok?: number, outTok?: number) {
  for (const count of [inTok, outTok]) {
    if (count !== undefined && (!Number.isSafeInteger(count) || count < 0))
      throw new RangeError('Token counts must be nonnegative safe integers');
  }
  if (!Object.hasOwn(PRICING, vendorModel) || inTok === undefined || outTok === undefined)
    return undefined;
  const rates = PRICING[vendorModel];
  for (const rate of [rates.input, rates.output]) {
    if (!Number.isFinite(rate) || rate < 0)
      throw new RangeError('Token rates must be finite nonnegative numbers');
  }
  const total = (inTok / 1000) * rates.input + (outTok / 1000) * rates.output;
  if (!Number.isFinite(total)) throw new RangeError('Estimated cost exceeds the numeric range');
  return Number(total.toFixed(6));
}
