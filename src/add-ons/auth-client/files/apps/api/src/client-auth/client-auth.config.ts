import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'node:crypto';
import { isSwaggerExport, parseDuration } from '@app/common';

export const CLIENT_AUTH_OPTIONS = Symbol('CLIENT_AUTH_OPTIONS');

export interface ClientAuthOptions {
  accessSecret: string;
  refreshSecret: string;
  /** Seconds. */
  accessTtl: number;
  /** Seconds. */
  refreshTtl: number;
  sessionLimit: number;
  /** HMAC key for one-time codes (derived from USER_JWT_SECRET). */
  otpKey: string;
  production: boolean;
}

const MIN_SECRET = 32;
const PLACEHOLDER = 'change-me';

function secret(config: ConfigService, key: string, production: boolean): string {
  const value = config.get<string>(key)?.trim() ?? '';
  // `npm run swagger:export` runs without a .env and never issues tokens.
  if (!value && isSwaggerExport()) return randomBytes(32).toString('hex');
  if (value.length < MIN_SECRET) {
    throw new Error(`${key} must be set in .env (at least ${MIN_SECRET} characters; e.g. openssl rand -hex 32)`);
  }
  if (production && value.startsWith(PLACEHOLDER)) {
    throw new Error(`${key} still has the .env.example placeholder; set a random value for production`);
  }
  return value;
}

/**
 * Reads and checks the client (user) auth settings once at boot. The user
 * secrets must differ from each other and from the admin secrets, so an admin
 * token can never be valid for the client API (tokens also carry `typ`).
 * Outside production the shared `.env.example` placeholder is tolerated with
 * a warning, so a copied `.env.example` still boots.
 */
export function clientAuthOptions(config: ConfigService): ClientAuthOptions {
  const production = config.get<string>('NODE_ENV') === 'production';
  const accessSecret = secret(config, 'USER_JWT_SECRET', production);
  const refreshSecret = secret(config, 'USER_REFRESH_SECRET', production);
  const adminSecrets = ['ADMIN_JWT_SECRET', 'ADMIN_REFRESH_SECRET']
    .map((key) => config.get<string>(key)?.trim())
    .filter((v): v is string => !!v);

  const problems: string[] = [];
  if (accessSecret === refreshSecret) problems.push('USER_JWT_SECRET and USER_REFRESH_SECRET must be different');
  if (adminSecrets.includes(accessSecret) || adminSecrets.includes(refreshSecret)) {
    problems.push('USER_JWT_SECRET / USER_REFRESH_SECRET must differ from the ADMIN_* secrets');
  }
  if (problems.length) {
    const placeholders = accessSecret.startsWith(PLACEHOLDER) || refreshSecret.startsWith(PLACEHOLDER);
    if (production || !placeholders) throw new Error(problems.join('; '));
    Logger.warn(`${problems.join('; ')} (tolerated for the .env.example placeholders outside production)`, 'ClientAuth');
  }

  const sessionLimit = Number(config.get('USER_SESSION_LIMIT') || 5);
  if (!Number.isInteger(sessionLimit) || sessionLimit < 1) {
    throw new Error('USER_SESSION_LIMIT must be a positive integer');
  }
  return {
    accessSecret,
    refreshSecret,
    accessTtl: parseDuration(config.get<string>('USER_JWT_EXPIRES_IN'), '15m'),
    refreshTtl: parseDuration(config.get<string>('USER_REFRESH_EXPIRES_IN'), '30d'),
    sessionLimit,
    otpKey: createHmac('sha256', accessSecret).update('user-otp').digest('hex'),
    production,
  };
}
