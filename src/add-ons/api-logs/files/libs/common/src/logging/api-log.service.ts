import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ServerApiLog, ServerApiLogType } from '@app/database';
import { ApiLogSettings, readApiLogSettings } from './api-log.settings';
import { limitSize, maskSecrets, maskUrl, secretKeyMatcher } from './mask';

/** Fields of one log row; bodies may be anything, they are masked and truncated on write. */
export type ApiLogEntry = Partial<Omit<ServerApiLog, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>;

const LIMITS: Partial<Record<keyof ApiLogEntry, number>> = {
  module: 128,
  handler: 128,
  method: 10,
  url: 2048,
  error: 4000,
  userId: 64,
  userType: 32,
  ip: 64,
  requestId: 64,
  serverId: 128,
};

function clip(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** HTTP status an error ends up as (mirrors AllExceptionsFilter for TypeORM errors). */
export function errorStatus(error: unknown): number {
  if (error instanceof HttpException) return error.getStatus();
  const code = (error as { code?: unknown })?.code;
  if (code === '23505' || code === '23503') return 409;
  if (code === '23502' || code === '22P02' || code === '22001') return 400;
  if ((error as Error)?.name === 'EntityNotFoundError') return 404;
  return 500;
}

/** Short text for the `error` column: the message, plus the stack for unexpected errors. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const status = errorStatus(error);
    return status >= 500 && error.stack ? error.stack : `${error.name}: ${error.message}`;
  }
  return String(error);
}

/**
 * Writes `server_api_logs` rows. Writing never throws and never delays the
 * caller: a failed insert is only a warning in the console.
 *
 *   await this.apiLogs.logCron('ReportsJob', 'daily-report', () => this.reports.build());
 *   this.apiLogs.write({ type: ServerApiLogType.AUTH, module: 'auth', handler: 'login-failed', userId });
 */
@Injectable()
export class ApiLogService {
  private readonly logger = new Logger(ApiLogService.name);
  readonly settings: ApiLogSettings;
  readonly isSecretKey: (key: string) => boolean;

  constructor(
    @InjectRepository(ServerApiLog) private readonly repository: Repository<ServerApiLog>,
    config: ConfigService,
  ) {
    this.settings = readApiLogSettings(config);
    this.isSecretKey = secretKeyMatcher(this.settings.maskKeys);
  }

  /** Masked (`***` for secret keys at any depth) and size-limited copy of a body. */
  sanitize(value: unknown): unknown {
    if (value === undefined || value === null) return null;
    return limitSize(maskSecrets(value, this.isSecretKey), this.settings.maxBody);
  }

  maskUrl(url: string): string {
    return maskUrl(url, this.isSecretKey);
  }

  /** Saves a row in the background (fire and forget). */
  write(entry: ApiLogEntry): void {
    try {
      const row: Record<string, unknown> = { ...entry };
      for (const [key, max] of Object.entries(LIMITS)) {
        if (key in row) row[key] = clip(row[key], max);
      }
      if (typeof row.url === 'string') row.url = this.maskUrl(row.url);
      row.requestBody = this.sanitize(entry.requestBody);
      row.responseBody = this.sanitize(entry.responseBody);
      row.type = entry.type ?? ServerApiLogType.API;
      row.serverId = clip(entry.serverId ?? this.settings.serverId, 128);
      this.repository.insert(row as QueryDeepPartialEntity<ServerApiLog>).catch((e: Error) => {
        this.logger.warn(`Could not save an API log row: ${e.message}`);
      });
    } catch (e) {
      this.logger.warn(`Could not prepare an API log row: ${(e as Error).message}`);
    }
  }

  /**
   * Runs a cron job and logs it as `CRON` (success or failure, with timing).
   * The job's error is re-thrown after logging; the result is returned.
   */
  async logCron<T>(module: string, name: string, fn: () => Promise<T> | T): Promise<T> {
    const started = Date.now();
    try {
      const result = await fn();
      this.write({
        type: ServerApiLogType.CRON,
        module,
        handler: name,
        statusCode: 200,
        durationMs: Date.now() - started,
        responseBody: result === undefined ? null : result,
      });
      return result;
    } catch (error) {
      this.write({
        type: ServerApiLogType.CRON,
        module,
        handler: name,
        statusCode: errorStatus(error),
        durationMs: Date.now() - started,
        error: describeError(error),
      });
      throw error;
    }
  }

  /**
   * Deletes rows older than API_LOG_RETENTION_DAYS in batches (short
   * transactions, no long table lock). Returns the number of deleted rows.
   */
  async purgeExpired(days = this.settings.retentionDays, batchSize = 5000): Promise<number> {
    if (!days || days <= 0) return 0;
    const before = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let total = 0;
    for (;;) {
      const result = await this.repository
        .createQueryBuilder()
        .delete()
        .from(ServerApiLog)
        .where('id IN (SELECT id FROM server_api_logs WHERE created_at < :before LIMIT :limit)', {
          before,
          limit: batchSize,
        })
        .execute();
      const affected = result.affected ?? 0;
      total += affected;
      if (affected < batchSize) break;
    }
    return total;
  }
}
