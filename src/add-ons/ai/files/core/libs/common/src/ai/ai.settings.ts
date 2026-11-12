import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const isTrue = (value: string | undefined) => ['true', '1'].includes((value ?? '').trim().toLowerCase());

function int(value: string | number | undefined, fallback: number, min = 0): number {
  const n = typeof value === 'number' ? value : Number((value ?? '').toString().trim() || NaN);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

/** AI_* settings from .env, with working defaults (every key is optional). */
@Injectable()
export class AiSettings {
  constructor(private readonly config: ConfigService) {}

  /** AI_PROVIDER: provider used when a call does not name one. */
  get defaultProvider(): string | undefined {
    return this.config.get<string>('AI_PROVIDER')?.trim() || undefined;
  }

  /** AI_TIMEOUT_MS (default 60000): per attempt; for streams, max silence between chunks. */
  get timeoutMs(): number {
    return int(this.config.get('AI_TIMEOUT_MS'), 60_000, 1);
  }

  /** AI_MAX_RETRIES (default 2): extra attempts on 429 / 5xx / network errors. */
  get maxRetries(): number {
    return int(this.config.get('AI_MAX_RETRIES'), 2);
  }

  /** AI_LOG_BODIES (default false): store prompts and answers in ai_logs. */
  get logBodies(): boolean {
    return isTrue(this.config.get<string>('AI_LOG_BODIES'));
  }

  /** AI_LOG_MAX_BODY (default 16384): stored body size limit, characters of JSON. */
  get logMaxBody(): number {
    return int(this.config.get('AI_LOG_MAX_BODY'), 16_384, 256);
  }

  /** Raw env value (provider keys, models, URLs). */
  get(key: string): string | undefined {
    const value = this.config.get<string>(key);
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
}
