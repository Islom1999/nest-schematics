import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import { isSwaggerExport } from '../swagger/export-mode';

/** Injection token of the shared ioredis client (`Redis | null`). */
export const REDIS_CLIENT = 'REDIS_CLIENT';

const logger = new Logger('Redis');

/** REDIS_URL, trimmed; empty when unset. */
export function redisUrl(config: ConfigService): string {
  return config.get<string>('REDIS_URL')?.trim() ?? '';
}

/**
 * ioredis options from a `redis://[user:password@]host:port[/db]` or
 * `rediss://` (TLS) URL. BullMQ opens its own connections with these.
 */
export function redisOptionsFromUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(`REDIS_URL must start with redis:// or rediss:// (got "${parsed.protocol}")`);
  }
  const db = parsed.pathname.replace(/^\//, '');
  return {
    host: parsed.hostname || 'localhost',
    port: parsed.port ? Number(parsed.port) : 6379,
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(db ? { db: Number(db) } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

/**
 * The app's Redis client, or `null` when Redis is not used:
 * - `npm run swagger:export` (nothing may connect);
 * - REDIS_URL empty: cache, session cache, sign-in counters and rate limits
 *   stay in process memory (fine for one instance; logged as a warning).
 *
 * The client connects lazily (first command), reconnects on its own and fails
 * commands after a few retries instead of hanging requests while Redis is down.
 */
export function createRedisClient(config: ConfigService, connectionName = 'api'): Redis | null {
  if (isSwaggerExport()) return null;
  const url = redisUrl(config);
  if (!url) {
    logger.warn(
      'REDIS_URL is not set: cache, session cache, sign-in limits and rate limits use process memory ' +
        '(one instance only). Set REDIS_URL to share them between instances.',
    );
    return null;
  }
  const client = new Redis({
    ...redisOptionsFromUrl(url),
    connectionName,
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
  });
  let lastError = 0;
  client.on('error', (error: Error) => {
    // ioredis retries forever; log at most every 30s.
    if (Date.now() - lastError < 30_000) return;
    lastError = Date.now();
    logger.error(`Redis error: ${error.message}`);
  });
  return client;
}
