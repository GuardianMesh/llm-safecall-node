import fs from 'node:fs';
import { createHash } from 'node:crypto';

type CacheLimits = { maxEntries?: number; maxBytes?: number };

export class Cache {
  private memory = new Map<string, string>();
  private maxEntries: number;
  private maxBytes: number;

  constructor(
    private file?: string,
    limits: CacheLimits = {},
  ) {
    this.maxEntries = limits.maxEntries ?? 256;
    this.maxBytes = limits.maxBytes ?? 1024 * 1024;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new RangeError('maxEntries must be a positive integer');
    }
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 2) {
      throw new RangeError('maxBytes must be an integer of at least 2');
    }
    if (this.file && !fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, '{}', { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
    }
  }

  key(prompt: string, params: unknown, schemaName?: string) {
    const spec = JSON.stringify({ prompt, params, schemaName });
    return createHash('sha256').update(spec).digest('hex');
  }

  get<T>(key: string): T | undefined {
    try {
      const encoded = this.read().get(key);
      return encoded === undefined ? undefined : JSON.parse(encoded);
    } catch {
      return undefined;
    }
  }

  set<T>(key: string, value: T) {
    try {
      const data = this.read();
      const encoded = JSON.stringify(value);
      data.delete(key);
      if (encoded !== undefined && this.size(new Map([[key, encoded]])) <= this.maxBytes) {
        data.set(key, encoded);
      }
      while (data.size && (data.size > this.maxEntries || this.size(data) > this.maxBytes)) {
        data.delete(data.keys().next().value!);
      }
      if (this.file) {
        const content =
          '{' + [...data].map(([k, v]) => JSON.stringify(k) + ':' + v).join(',') + '}';
        fs.writeFileSync(this.file, content);
      }
    } catch {
      // A cache write must not discard a completed model response.
    }
  }

  private size(data: Map<string, string>) {
    let bytes = 2;
    for (const [key, value] of data) {
      bytes +=
        Buffer.byteLength(JSON.stringify(key), 'utf8') + Buffer.byteLength(value, 'utf8') + 2;
    }
    return bytes;
  }

  private read(): Map<string, string> {
    if (!this.file) return this.memory;
    const fd = fs.openSync(this.file, 'r');
    let text: string;
    try {
      const buffer = Buffer.alloc(this.maxBytes + 1);
      const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
      if (length > this.maxBytes) throw new Error('Cache file exceeds maxBytes');
      text = buffer.toString('utf8', 0, length);
    } finally {
      fs.closeSync(fd);
    }
    const data = JSON.parse(text || '{}');
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Cache must contain a JSON object');
    }
    const entries = Object.entries(data);
    if (entries.length > this.maxEntries) throw new Error('Cache file exceeds maxEntries');
    return new Map(entries.map(([key, value]) => [key, JSON.stringify(value)]));
  }
}
