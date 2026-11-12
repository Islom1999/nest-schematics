import { HttpException, HttpStatus } from '@nestjs/common';
import type { CacheCounter, CacheStore } from '../cache/cache-store';

/**
 * Counts failed sign-in attempts per key (e.g. `email|ip`): after `max`
 * failures within `windowMs` the key is locked until the window that started
 * with the first failure ends. A success clears the key.
 *
 * This is the built-in brute-force guard of the auth services; it works with
 * no extra setup. Without `store` the counters live in this process; pass a
 * shared {@link CacheStore} (the redis add-on's) so every instance counts
 * together. `prefix` namespaces the keys in that store.
 */
export class LoginAttemptLimiter {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly store?: CacheStore,
    private readonly prefix = 'login-attempts',
  ) {}

  /** Throws 429 while `key` is locked. */
  async assertAllowed(key: string): Promise<void> {
    const entry = await this.current(key);
    if (entry && entry.count >= this.max) {
      const retryAfter = Math.ceil(entry.resetInMs / 1000);
      throw new HttpException(
        `Too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Records a failure; returns the attempts left before the lock. */
  async fail(key: string): Promise<number> {
    if (this.store) {
      const { count } = await this.store.increment(this.storeKey(key), this.windowMs);
      return Math.max(0, this.max - count);
    }
    const now = Date.now();
    const entry = this.local(key) ?? { count: 0, resetAt: now + this.windowMs };
    entry.count += 1;
    this.attempts.set(key, entry);
    if (this.attempts.size > 10_000) this.prune();
    return Math.max(0, this.max - entry.count);
  }

  async reset(key: string): Promise<void> {
    if (this.store) await this.store.delete(this.storeKey(key));
    else this.attempts.delete(key);
  }

  private async current(key: string): Promise<CacheCounter | undefined> {
    if (this.store) return this.store.counter(this.storeKey(key));
    const entry = this.local(key);
    return entry ? { count: entry.count, resetInMs: entry.resetAt - Date.now() } : undefined;
  }

  private storeKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  private local(key: string) {
    const entry = this.attempts.get(key);
    if (entry && entry.resetAt <= Date.now()) {
      this.attempts.delete(key);
      return undefined;
    }
    return entry;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.attempts) {
      if (entry.resetAt <= now) this.attempts.delete(key);
    }
  }
}
