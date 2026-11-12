import { ConfigService } from '@nestjs/config';
import { parseDuration } from '@app/common';

export const ADMIN_AUTH_OPTIONS = Symbol('ADMIN_AUTH_OPTIONS');

export interface AdminAuthOptions {
  accessSecret: string;
  refreshSecret: string;
  /** Seconds. */
  accessTtl: number;
  /** Seconds. */
  refreshTtl: number;
  sessionLimit: number;
}

const MIN_SECRET = 32;

function secret(config: ConfigService, key: string): string {
  const value = config.get<string>(key)?.trim() ?? '';
  if (value.length < MIN_SECRET) {
    throw new Error(`${key} must be set in .env (at least ${MIN_SECRET} characters; e.g. openssl rand -hex 32)`);
  }
  if (config.get<string>('NODE_ENV') === 'production' && value.startsWith('change-me')) {
    throw new Error(`${key} still has the .env.example placeholder; set a random value for production`);
  }
  return value;
}

/** Reads and checks the admin auth settings once at boot; a bad .env fails fast. */
export function adminAuthOptions(config: ConfigService): AdminAuthOptions {
  const accessSecret = secret(config, 'ADMIN_JWT_SECRET');
  const refreshSecret = secret(config, 'ADMIN_REFRESH_SECRET');
  if (accessSecret === refreshSecret) {
    throw new Error('ADMIN_JWT_SECRET and ADMIN_REFRESH_SECRET must be different');
  }
  const sessionLimit = Number(config.get('ADMIN_SESSION_LIMIT') || 10);
  if (!Number.isInteger(sessionLimit) || sessionLimit < 1) {
    throw new Error('ADMIN_SESSION_LIMIT must be a positive integer');
  }
  return {
    accessSecret,
    refreshSecret,
    accessTtl: parseDuration(config.get<string>('ADMIN_JWT_EXPIRES_IN'), '15m'),
    refreshTtl: parseDuration(config.get<string>('ADMIN_REFRESH_EXPIRES_IN'), '30d'),
    sessionLimit,
  };
}
