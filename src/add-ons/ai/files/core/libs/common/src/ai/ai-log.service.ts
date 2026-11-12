import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AiLog } from '@app/database';
import { AiSettings } from './ai.settings';

export interface AiLogEntry {
  operation: string;
  provider: string;
  model: string;
  userId?: string | null;
  module?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number | null;
  latencyMs: number;
  cacheHit?: boolean;
  error?: string | null;
  request?: unknown;
  response?: unknown;
}

/** Big base64 payloads (images) are replaced by their size. */
function stripBinary(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value ?? null, (_key, v: unknown) => {
      if (typeof v !== 'string' || v.length < 512) return v;
      if (/^data:[\w/+.-]+;base64,/.test(v) || /^[A-Za-z0-9+/=\r\n]+$/.test(v.slice(0, 512))) {
        return `[binary ${v.length} chars]`;
      }
      return v;
    }),
  ) as unknown;
}

/** Writes ai_logs rows. Never throws: a logging failure must not fail the AI call. */
@Injectable()
export class AiLogService {
  private readonly logger = new Logger(AiLogService.name);

  constructor(
    @InjectRepository(AiLog) private readonly logs: Repository<AiLog>,
    private readonly settings: AiSettings,
  ) {}

  /** JSON body as stored: binary stripped, truncated to AI_LOG_MAX_BODY (null unless AI_LOG_BODIES=true). */
  body(value: unknown): unknown {
    if (!this.settings.logBodies || value === undefined) return null;
    const clean = stripBinary(value);
    const json = JSON.stringify(clean);
    const max = this.settings.logMaxBody;
    return json.length > max ? { truncated: true, size: json.length, preview: json.slice(0, max) } : clean;
  }

  async record(entry: AiLogEntry): Promise<void> {
    try {
      const row: Partial<AiLog> = {
        operation: entry.operation,
        provider: entry.provider,
        model: entry.model.slice(0, 128),
        userId: entry.userId ?? null,
        module: entry.module?.slice(0, 64) ?? null,
        promptTokens: entry.promptTokens ?? 0,
        completionTokens: entry.completionTokens ?? 0,
        costUsd: entry.costUsd ?? null,
        latencyMs: Math.round(entry.latencyMs),
        cacheHit: entry.cacheHit ?? false,
        error: entry.error ?? null,
        requestBody: this.body(entry.request),
        responseBody: this.body(entry.response),
      };
      // jsonb columns are typed `unknown`, which QueryDeepPartialEntity cannot express.
      await this.logs.insert(row as QueryDeepPartialEntity<AiLog>);
    } catch (error) {
      this.logger.warn(`ai_logs insert failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
