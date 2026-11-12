import { Throttle } from '@nestjs/throttler';

/** Window of `@AuthThrottle()`: one minute. */
export const AUTH_THROTTLE_TTL_MS = 60_000;
export const AUTH_THROTTLE_DEFAULT_LIMIT = 5;

/** Requests per minute allowed by `@AuthThrottle()` (env AUTH_THROTTLE_LIMIT, default 5). */
export function authThrottleLimit(env: NodeJS.ProcessEnv = process.env): number {
  const limit = Number(env.AUTH_THROTTLE_LIMIT);
  return Number.isInteger(limit) && limit > 0 ? limit : AUTH_THROTTLE_DEFAULT_LIMIT;
}

/**
 * Strict rate limit for sign-in, OTP and password-reset routes: AUTH_THROTTLE_LIMIT
 * requests per minute per client IP and route (the global limit stays on other
 * routes). The limit is read per request, so `.env` loaded by ConfigModule applies.
 *
 *   @AuthThrottle()
 *   @Post('sign-in')
 */
export const AuthThrottle = () =>
  Throttle({ default: { ttl: AUTH_THROTTLE_TTL_MS, limit: () => authThrottleLimit() } });
