import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Counts failed sign-in attempts per key (e.g. `email|ip`) in memory: after
 * `max` failures within `windowMs` the key is locked until the window that
 * started with the first failure ends. A success clears the key.
 *
 * This is the built-in brute-force guard of the auth services; it works with
 * no extra setup. It is per process — add route-level rate limiting
 * (throttler, Redis) on top for multi-instance deployments.
 */
export class LoginAttemptLimiter {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}

  /** Throws 429 while `key` is locked. */
  assertAllowed(key: string): void {
    const entry = this.current(key);
    if (entry && entry.count >= this.max) {
      const retryAfter = Math.ceil((entry.resetAt - Date.now()) / 1000);
      throw new HttpException(
        `Too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Records a failure; returns the attempts left before the lock. */
  fail(key: string): number {
    const now = Date.now();
    const entry = this.current(key) ?? { count: 0, resetAt: now + this.windowMs };
    entry.count += 1;
    this.attempts.set(key, entry);
    if (this.attempts.size > 10_000) this.prune();
    return Math.max(0, this.max - entry.count);
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  private current(key: string) {
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
