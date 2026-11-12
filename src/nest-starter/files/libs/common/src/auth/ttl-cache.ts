/**
 * Small in-process cache with per-entry expiry and a size cap (oldest entries
 * are dropped first). Used by auth guards so a request does not hit the
 * database for its session every time. Per process: with several instances a
 * revoked session stays valid elsewhere for at most `ttlMs`.
 */
export class TtlCache<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxSize = 10_000,
  ) {}

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs = this.ttlMs): void {
    if (ttlMs <= 0) return;
    this.entries.delete(key);
    if (this.entries.size >= this.maxSize) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: K): void {
    this.entries.delete(key);
  }

  /** Removes every entry whose value matches. */
  deleteWhere(predicate: (value: V, key: K) => boolean): void {
    for (const [key, entry] of this.entries) {
      if (predicate(entry.value, key)) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
