import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileExists } from './utils';
import { logJson } from './logger';

export interface CacheOptions {
  filePath?: string;
  ttlMs?: number;
  maxSize?: number;
}

export class Cache {
  private filePath: string;
  private ttlMs: number;
  private maxSize: number;
  private lockFile: string;

  constructor(opts: CacheOptions = {}) {
    this.filePath = opts.filePath ?? process.env.LLM_CACHE_PATH ?? '.llm_safecall_cache.json';
    this.ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000; // 24 hours
    this.maxSize = opts.maxSize ?? 1000;
    this.lockFile = `${this.filePath}.lock`;
    this.initializeCache().catch(err => {
      logJson('cache_init_error', { error: err.message });
    });
  }

  private async initializeCache() {
    try {
      const exists = await fileExists(this.filePath);
      if (!exists) {
        await fs.writeFile(this.filePath, '{}', 'utf-8');
      }
    } catch (error) {
      logJson('cache_init_error', { error: error.message });
      throw error;
    }
  }

  async key(prompt: string, params: unknown, schemaName?: string): Promise<string> {
    const spec = JSON.stringify({ prompt, params, schemaName });
    return createHash('sha256').update(spec).digest('hex');
  }

  private async acquireLock(): Promise<boolean> {
    try {
      await fs.writeFile(this.lockFile, '', { flag: 'wx' });
      return true;
    } catch {
      return false;
    }
  }

  private async releaseLock() {
    try {
      await fs.unlink(this.lockFile);
    } catch (error) {
      logJson('cache_lock_release_error', { error: error.message });
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const cache = JSON.parse(data || '{}');
      const entry = cache[key];

      if (!entry) return undefined;
      if (Date.now() - entry.timestamp > this.ttlMs) {
        delete cache[key];
        await this.saveCache(cache);
        return undefined;
      }

      return entry.value;
    } catch (error) {
      logJson('cache_read_error', { error: error.message });
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    let locked = false;
    try {
      locked = await this.acquireLock();
      if (!locked) {
        logJson('cache_write_error', { error: 'Failed to acquire lock' });
        return;
      }

      const data = await fs.readFile(this.filePath, 'utf-8');
      const cache = JSON.parse(data || '{}');
      
      // Implement LRU eviction if cache is too large
      const entries = Object.entries(cache);
      if (entries.length >= this.maxSize) {
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        delete cache[entries[0][0]];
      }

      cache[key] = {
        value,
        timestamp: Date.now()
      };

      await this.saveCache(cache);
    } catch (error) {
      logJson('cache_write_error', { error: error.message });
    } finally {
      if (locked) {
        await this.releaseLock();
      }
    }
  }

  private async saveCache(cache: Record<string, any>) {
    try {
      await fs.writeFile(this.filePath, JSON.stringify(cache), 'utf-8');
    } catch (error) {
      logJson('cache_save_error', { error: error.message });
      throw error;
    }
  }
}