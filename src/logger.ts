import { writeSync } from 'node:fs';

export function logJson(event: string, fields: Record<string, unknown> = {}) {
  const rec = { ts: new Date().toISOString(), event, ...fields };
  try {
    writeSync(2, JSON.stringify(rec) + '\n');
  } catch {
    // A closed log destination should not interrupt the caller.
  }
}
