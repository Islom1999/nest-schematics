import { ConfigService } from '@nestjs/config';
import { authThrottleLimit } from '../decorators/auth-throttle.decorator';
import { validateEnv } from './env.validation';
import { createThrottlerOptions } from './throttler.config';

const BASE = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_DATABASE: 'app',
};

describe('validateEnv', () => {
  it('accepts a minimal .env', () => {
    expect(validateEnv({ ...BASE })).toEqual(BASE);
  });

  it('lists every invalid key', () => {
    expect(() => validateEnv({ ...BASE, DB_PORT: 'x', NODE_ENV: 'staging' })).toThrow(
      /DB_PORT[\s\S]*NODE_ENV|NODE_ENV[\s\S]*DB_PORT/,
    );
  });

  it('refuses DB_SYNCHRONIZE=true in production', () => {
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'production', DB_SYNCHRONIZE: 'true' })).toThrow(/DB_SYNCHRONIZE/);
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'development', DB_SYNCHRONIZE: 'true' })).not.toThrow();
  });
});

describe('rate limits', () => {
  const config = (values: Record<string, string>) => new ConfigService(values);

  it('defaults to 100 requests per minute', () => {
    expect(createThrottlerOptions(config({}))).toEqual([{ name: 'default', ttl: 60_000, limit: 100 }]);
  });

  it('reads THROTTLE_TTL (seconds) and THROTTLE_LIMIT', () => {
    expect(createThrottlerOptions(config({ THROTTLE_TTL: '10', THROTTLE_LIMIT: '20' }))).toEqual([
      { name: 'default', ttl: 10_000, limit: 20 },
    ]);
  });

  it('reads AUTH_THROTTLE_LIMIT, falling back to 5', () => {
    expect(authThrottleLimit({})).toBe(5);
    expect(authThrottleLimit({ AUTH_THROTTLE_LIMIT: '3' })).toBe(3);
    expect(authThrottleLimit({ AUTH_THROTTLE_LIMIT: 'abc' })).toBe(5);
  });
});
