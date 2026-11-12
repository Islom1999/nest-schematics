/** A counter with a fixed window (rate limits, failed sign-ins). */
export interface CacheCounter {
  count: number;
  /** Milliseconds until the window ends and the counter disappears. */
  resetInMs: number;
}

/**
 * Key/value cache with per-key expiry, used for the auth session cache, the
 * sign-in attempt counters and the settings cache. Values must be JSON-safe
 * (a shared store serialises them).
 *
 * Inject it with `@Inject(CACHE_STORE)`. By default it is an in-process
 * {@link MemoryCacheStore}; the redis add-on provides `SHARED_CACHE_STORE`,
 * which then replaces it, so every instance sees the same entries (a revoked
 * session is refused everywhere at once).
 */
export interface CacheStore {
  /** True when every app instance sees the same entries (Redis). */
  readonly shared: boolean;
  get<T>(key: string): Promise<T | undefined>;
  /** `ttlMs <= 0` stores nothing. */
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(...keys: string[]): Promise<void>;
  /** Deletes every key that starts with `prefix` (rare operations: role changes, settings writes). */
  deleteByPrefix(prefix: string): Promise<void>;
  /** Adds 1; the first increment starts a window of `windowMs`. */
  increment(key: string, windowMs: number): Promise<CacheCounter>;
  /** The counter, if its window is still open. */
  counter(key: string): Promise<CacheCounter | undefined>;
}

/** Injection token of the effective store (shared when the redis add-on provides one). */
export const CACHE_STORE = 'CACHE_STORE';

/**
 * Optional provider of a store shared by all instances (the redis add-on's
 * RedisModule). A `null` value (e.g. REDIS_URL unset) keeps the memory store.
 */
export const SHARED_CACHE_STORE = 'SHARED_CACHE_STORE';
