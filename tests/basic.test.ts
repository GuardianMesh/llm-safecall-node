import { describe, it, expect } from 'vitest';
import { SafeCall } from '../src/safeCall';
import { MockProvider } from '../src/providers/mock';
import { z } from 'zod';

describe('happy path', () => {
  it('validates and reports', async () => {
    const Output = z.object({ ok: z.boolean().optional() });
    const safe = new SafeCall({ llm: new MockProvider(), outputSchema: Output });
    const res = await safe.generate('say hi as json');
    expect(res.report.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
