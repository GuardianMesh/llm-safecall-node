import { afterEach, expect, it } from 'vitest';
import { PRICING, estimateCost } from '../src/pricing';

afterEach(() => {
  delete PRICING['test:model'];
});

it('uses explicit rates and requires complete usage', () => {
  PRICING['test:model'] = { input: 0.2, output: 0.5 };
  expect(estimateCost('test:model', 2000, 1000)).toBe(0.9);
  expect(estimateCost('test:model', 0, 0)).toBe(0);
  expect(estimateCost('test:model', undefined, 1000)).toBeUndefined();
  expect(estimateCost('test:model', 1000)).toBeUndefined();
  expect(estimateCost('unknown', 1000, 1000)).toBeUndefined();
  expect(estimateCost('toString', 1000, 1000)).toBeUndefined();
});

it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid token counts: %s',
  (count) => {
    expect(() => estimateCost('test:model', count, 1000)).toThrow('Token counts');
  },
);

it.each([-1, NaN, Infinity])('rejects invalid rates: %s', (rate) => {
  PRICING['test:model'] = { input: rate, output: 0.5 };
  expect(() => estimateCost('test:model', 1000, 1000)).toThrow('Token rates');
});

it('rejects overflow without overflowing the rounding step', () => {
  PRICING['test:model'] = { input: 1e308, output: 1e308 };
  expect(() => estimateCost('test:model', 2000, 2000)).toThrow('numeric range');
  expect(estimateCost('test:model', 1000, 0)).toBe(1e308);
});
