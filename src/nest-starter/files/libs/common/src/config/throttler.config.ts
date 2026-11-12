import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Global rate limit: THROTTLE_LIMIT requests per THROTTLE_TTL seconds per client
 * IP (default 100/min). The IP comes from X-Forwarded-For only when TRUST_PROXY
 * is set (see main.ts). Use `@SkipThrottle()` for webhooks and `@AuthThrottle()`
 * for sign-in routes.
 */
export function createThrottlerOptions(config: ConfigService): ThrottlerModuleOptions {
  return [
    {
      name: 'default',
      ttl: positiveInt(config.get('THROTTLE_TTL'), 60) * 1000,
      limit: positiveInt(config.get('THROTTLE_LIMIT'), 100),
    },
  ];
}
