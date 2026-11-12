import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';

/**
 * - `errors` (default): failed requests only (exception or status >= 400);
 * - `slow`: failures and requests slower than API_LOG_SLOW_MS;
 * - `all`: every request.
 * `@LogPayment()` routes and `logCron()` runs are always logged.
 */
export type ApiLogMode = 'errors' | 'slow' | 'all';

export interface ApiLogSettings {
  mode: ApiLogMode;
  slowMs: number;
  /** Max JSON size of one stored body, in bytes; larger bodies keep a preview. */
  maxBody: number;
  /** Keys whose values are replaced with `***` (case, `_` and `-` are ignored). */
  maskKeys: string[];
  /** Rows older than this are deleted by the worker; 0 keeps them forever. */
  retentionDays: number;
  /** Instance name stored with every row (default: host name). */
  serverId: string;
  /** Path prefixes that are never logged. */
  skipPaths: string[];
}

export const DEFAULT_MASK_KEYS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'otp',
  'code',
  'secret',
  'card',
  'cardNumber',
  'cvv',
  'authorization',
];

export const DEFAULT_SKIP_PATHS = ['/api/health', '/docs'];

function list(value: unknown): string[] {
  return (typeof value === 'string' ? value : '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function int(value: unknown, fallback: number): number {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function readApiLogSettings(config: ConfigService): ApiLogSettings {
  const mode = String(config.get('API_LOG_MODE') ?? '').trim();
  return {
    mode: mode === 'slow' || mode === 'all' ? mode : 'errors',
    slowMs: int(config.get('API_LOG_SLOW_MS'), 1000),
    maxBody: int(config.get('API_LOG_MAX_BODY'), 8192),
    maskKeys: [...DEFAULT_MASK_KEYS, ...list(config.get('API_LOG_MASK_KEYS'))],
    retentionDays: int(config.get('API_LOG_RETENTION_DAYS'), 30),
    serverId: String(config.get('API_LOG_SERVER_ID') ?? '').trim() || hostname(),
    skipPaths: [...DEFAULT_SKIP_PATHS, ...list(config.get('API_LOG_SKIP_PATHS'))],
  };
}
