import { TtlCache } from '../auth/ttl-cache';
import { CacheCounter, CacheStore } from './cache-store';

interface Counter {
  count: number;
  resetAt: number;
}

/**
 * In-process {@link CacheStore} on top of {@link TtlCache} (per-entry expiry,
 * oldest entries dropped beyond `maxSize`). Per process: with several
 * instances each one has its own entries.
 */
export class MemoryCacheStore implements CacheStore {
  readonly shared = false;
  private readonly entries: TtlCache<string, unknown>;
  private readonly counters = new Map<string, Counter>();

  constructor(private readonly maxSize = 10_000) {
    this.entries = new TtlCache<string, unknown>(60_000, maxSize);
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.entries.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.entries.set(key, value, ttlMs);
  }

  async delete(...keys: string[]): Promise<void> {
    for (const key of keys) {
      this.entries.delete(key);
      this.counters.delete(key);
    }
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    this.entries.deleteWhere((_value, key) => key.startsWith(prefix));
    for (const key of this.counters.keys()) {
      if (key.startsWith(prefix)) this.counters.delete(key);
    }
  }

  async increment(key: string, windowMs: number): Promise<CacheCounter> {
    const now = Date.now();
    const entry = this.liveCounter(key, now) ?? { count: 0, resetAt: now + windowMs };
    entry.count += 1;
    this.counters.set(key, entry);
    if (this.counters.size > this.maxSize) this.prune(now);
    return { count: entry.count, resetInMs: entry.resetAt - now };
  }

  async counter(key: string): Promise<CacheCounter | undefined> {
    const now = Date.now();
    const entry = this.liveCounter(key, now);
    return entry ? { count: entry.count, resetInMs: entry.resetAt - now } : undefined;
  }

  private liveCounter(key: string, now: number): Counter | undefined {
    const entry = this.counters.get(key);
    if (entry && entry.resetAt <= now) {
      this.counters.delete(key);
      return undefined;
    }
    return entry;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.counters) {
      if (entry.resetAt <= now) this.counters.delete(key);
    }
  }
}
