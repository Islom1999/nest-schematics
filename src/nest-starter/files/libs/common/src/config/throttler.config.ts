import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';

/**
 * Optional provider of a throttler storage shared by all instances (the redis
 * add-on's RedisModule). Absent or `null`: the built-in in-memory storage.
 */
export const SHARED_THROTTLER_STORAGE = 'SHARED_THROTTLER_STORAGE';

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Global rate limit: THROTTLE_LIMIT requests per THROTTLE_TTL seconds per client
 * IP (default 100/min). The IP comes from X-Forwarded-For only when TRUST_PROXY
 * is set (see main.ts). Use `@SkipThrottle()` for webhooks and `@AuthThrottle()`
 * for sign-in routes. With a shared `storage` (Redis) the limit counts across
 * every instance; otherwise per process.
 */
export function createThrottlerOptions(
  config: ConfigService,
  storage?: ThrottlerStorage | null,
): ThrottlerModuleOptions {
  const throttlers = [
    {
      name: 'default',
      ttl: positiveInt(config.get('THROTTLE_TTL'), 60) * 1000,
      limit: positiveInt(config.get('THROTTLE_LIMIT'), 100),
    },
  ];
  return storage ? { throttlers, storage } : throttlers;
}
