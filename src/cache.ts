import fs from 'node:fs';
export class Cache {
  constructor(private file = '.llm_safecall_cache.json') {
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '{}', 'utf-8');
  }
  key(prompt: string, params: unknown, schemaName?: string) {
    const spec = JSON.stringify({ prompt, params, schemaName });
    const crypto = require('node:crypto');
    return crypto.createHash('sha256').update(spec).digest('hex');
  }
  get<T>(key: string): T | undefined {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf-8') || '{}')[key]; }
    catch { return undefined; }
  }
  set<T>(key: string, value: T) {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf-8') || '{}');
      data[key] = value;
      fs.writeFileSync(this.file, JSON.stringify(data));
    } catch {}
  }
}
