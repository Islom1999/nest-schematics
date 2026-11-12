import type Redis from 'ioredis';
import type { CacheCounter, CacheStore } from '../cache/cache-store';

/** INCR with a window that starts on the first hit; returns [count, pttl]. */
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

/** Glob characters of SCAN MATCH patterns. */
function escapeGlob(value: string): string {
  return value.replace(/[*?[\]\\]/g, '\\$&');
}

/**
 * {@link CacheStore} in Redis: one key per entry under `namespace`, values as
 * JSON with a PX expiry. Every app instance sees the same entries, so a
 * revoked session or a settings change is visible everywhere at once.
 */
export class RedisCacheStore implements CacheStore {
  readonly shared = true;

  constructor(
    private readonly redis: Redis,
    private readonly namespace = 'cache:',
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.redis.get(this.key(key));
    return raw === null ? undefined : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const ms = Math.floor(ttlMs);
    if (ms <= 0) return;
    await this.redis.set(this.key(key), JSON.stringify(value), 'PX', ms);
  }

  async delete(...keys: string[]): Promise<void> {
    if (keys.length) await this.redis.del(...keys.map((k) => this.key(k)));
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    const pattern = `${escapeGlob(this.key(prefix))}*`;
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      if (keys.length) await this.redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  }

  async increment(key: string, windowMs: number): Promise<CacheCounter> {
    const [count, ttl] = (await this.redis.eval(INCREMENT_SCRIPT, 1, this.key(key), Math.max(1, Math.floor(windowMs)))) as [
      number,
      number,
    ];
    return { count: Number(count), resetInMs: Number(ttl) };
  }

  async counter(key: string): Promise<CacheCounter | undefined> {
    const k = this.key(key);
    const [raw, ttl] = await Promise.all([this.redis.get(k), this.redis.pttl(k)]);
    if (raw === null || ttl === -2) return undefined;
    return { count: Number(raw), resetInMs: Math.max(0, ttl) };
  }

  private key(key: string): string {
    return `${this.namespace}${key}`;
  }
}
