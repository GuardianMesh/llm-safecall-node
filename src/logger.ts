export function logJson(event: string, fields: Record<string, unknown> = {}) {
  const rec = { ts: new Date().toISOString(), event, ...fields };
  try { process.stdout.write(JSON.stringify(rec) + "\n"); } catch {}
}
