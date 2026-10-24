import { PolicyViolationError } from './types';

/** Check decoded JSON strings without invoking getters or re-running schema transforms. */
export function checkValue(
  value: unknown,
  check: (text: string) => string,
  maxTextChars = 1_048_576,
): unknown {
  const ancestors = new Set<object>();
  let nodes = 0;
  let characters = 0;
  let filteredCharacters = 0;
  function text(value: string): string {
    characters += value.length;
    if (characters > Math.min(maxTextChars, 1_048_576))
      throw new PolicyViolationError('Structured data exceeds the text limit');
    const filtered = check(value);
    filteredCharacters += filtered.length;
    if (filteredCharacters > Math.min(maxTextChars, 1_048_576))
      throw new PolicyViolationError('Structured data exceeds the text limit');
    return filtered;
  }
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > 10_000 || depth > 64)
      throw new PolicyViolationError('Structured data exceeds the depth or node limit');
    if (typeof value === 'string') return text(value);
    if (value === null || value === undefined || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object')
      throw new TypeError('Policy checks require JSON-compatible values');
    const prototype = Object.getPrototypeOf(value);
    if (
      Array.isArray(value)
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null
    ) {
      throw new TypeError('Policy checks require plain objects and arrays');
    }
    if (ancestors.has(value) || Object.getOwnPropertySymbols(value).length) {
      throw new TypeError('Cyclic values and symbol properties are unsupported');
    }
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        if (
          value.length > 10_000 ||
          Object.getOwnPropertyNames(value).length !== value.length + 1
        ) {
          throw new TypeError('Sparse or extended arrays are unsupported');
        }
        return Array.from({ length: value.length }, (_, index) => {
          const field = Object.getOwnPropertyDescriptor(value, String(index));
          if (!field || !('value' in field) || !field.enumerable)
            throw new TypeError('Array accessors are unsupported');
          return visit(field.value, depth + 1);
        });
      }
      const result: Record<string, unknown> = {};
      for (const key of Object.getOwnPropertyNames(value)) {
        const field = Object.getOwnPropertyDescriptor(value, key)!;
        if (!('value' in field) || !field.enumerable)
          throw new TypeError('Object accessors are unsupported');
        if (text(key) !== key) throw new PolicyViolationError('Object key violates policy');
        Object.defineProperty(result, key, {
          value: visit(field.value, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  }
  return visit(value, 0);
}

export function verifyValue(
  value: unknown,
  check: (text: string) => string,
  maxTextChars = 1_048_576,
): void {
  checkValue(
    value,
    (text) => {
      if (check(text) !== text) throw new PolicyViolationError('Schema output violates policy');
      return text;
    },
    maxTextChars,
  );
}
