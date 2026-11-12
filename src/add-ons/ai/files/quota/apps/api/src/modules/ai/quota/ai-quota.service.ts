import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiUsageDaily, AiUsageMonthly } from '@app/database';
import { AiChatQuota } from '../chat/ai-chat.quota';
import { AiUsageDto } from './ai-usage.dto';

function limit(value: unknown, fallback: number): number {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** UTC calendar keys and reset times. */
function periods(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const month = `${day.slice(0, 7)}-01`;
  const nextDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { day, month, dayResetAt: nextDay.toISOString(), monthResetAt: nextMonth.toISOString() };
}

/**
 * Per-user AI chat limits (`npm run g -- ai --quota`): AI_DAILY_MESSAGES
 * messages per UTC day and AI_MONTHLY_TOKENS tokens per UTC month (0 = no
 * limit). Counters live in ai_usage_daily / ai_usage_monthly and are changed
 * with atomic upserts, so parallel requests and several API instances cannot
 * overshoot the daily message limit. Tokens are known only after an answer,
 * so the monthly token limit is checked before each message.
 */
@Injectable()
export class AiQuotaService implements AiChatQuota {
  constructor(
    @InjectRepository(AiUsageDaily) private readonly daily: Repository<AiUsageDaily>,
    @InjectRepository(AiUsageMonthly) private readonly monthly: Repository<AiUsageMonthly>,
    private readonly config: ConfigService,
  ) {}

  get dailyMessageLimit(): number {
    return limit(this.config.get('AI_DAILY_MESSAGES'), 50);
  }

  get monthlyTokenLimit(): number {
    return limit(this.config.get('AI_MONTHLY_TOKENS'), 500_000);
  }

  async reserve(userId: string): Promise<void> {
    const { day, month, dayResetAt, monthResetAt } = periods();

    const tokenLimit = this.monthlyTokenLimit;
    if (tokenLimit > 0) {
      const used = await this.monthly.findOne({ where: { userId, month } });
      if (used && used.tokens >= tokenLimit) {
        throw this.exceeded(
          'AI_MONTHLY_TOKENS_EXCEEDED',
          `Monthly AI token limit reached (${tokenLimit} tokens per month). It resets at ${monthResetAt}.`,
          tokenLimit,
          used.tokens,
          monthResetAt,
        );
      }
    }

    const messageLimit = this.dailyMessageLimit;
    const rows: { messages: number }[] = await this.daily.query(
      `INSERT INTO "ai_usage_daily" ("user_id", "day", "messages") VALUES ($1, $2, 1)
       ON CONFLICT ("user_id", "day") DO UPDATE
         SET "messages" = "ai_usage_daily"."messages" + 1, "updated_at" = now()
         WHERE $3::int = 0 OR "ai_usage_daily"."messages" < $3::int
       RETURNING "messages"`,
      [userId, day, messageLimit],
    );
    if (!rows.length) {
      throw this.exceeded(
        'AI_DAILY_MESSAGES_EXCEEDED',
        `Daily AI message limit reached (${messageLimit} messages per day). It resets at ${dayResetAt}.`,
        messageLimit,
        messageLimit,
        dayResetAt,
      );
    }
    await this.bump('ai_usage_monthly', 'month', userId, month, 1, 0);
  }

  async addTokens(userId: string, tokens: number): Promise<void> {
    if (tokens <= 0) return;
    const { day, month } = periods();
    await this.bump('ai_usage_daily', 'day', userId, day, 0, tokens);
    await this.bump('ai_usage_monthly', 'month', userId, month, 0, tokens);
  }

  async usage(userId: string): Promise<AiUsageDto> {
    const { day, month, dayResetAt, monthResetAt } = periods();
    const [today, thisMonth] = await Promise.all([
      this.daily.findOne({ where: { userId, day } }),
      this.monthly.findOne({ where: { userId, month } }),
    ]);
    return {
      day,
      dailyMessages: today?.messages ?? 0,
      dailyMessageLimit: this.dailyMessageLimit,
      dailyResetAt: dayResetAt,
      month: month.slice(0, 7),
      monthlyTokens: thisMonth?.tokens ?? 0,
      monthlyTokenLimit: this.monthlyTokenLimit,
      monthlyResetAt: monthResetAt,
    };
  }

  /** Atomic `+=` on one counter row (created on first use). */
  private async bump(
    table: 'ai_usage_daily' | 'ai_usage_monthly',
    period: 'day' | 'month',
    userId: string,
    key: string,
    messages: number,
    tokens: number,
  ): Promise<void> {
    const repository = table === 'ai_usage_daily' ? this.daily : this.monthly;
    await repository.query(
      `INSERT INTO "${table}" ("user_id", "${period}", "messages", "tokens") VALUES ($1, $2, $3, $4)
       ON CONFLICT ("user_id", "${period}") DO UPDATE
         SET "messages" = "${table}"."messages" + EXCLUDED."messages",
             "tokens" = "${table}"."tokens" + EXCLUDED."tokens",
             "updated_at" = now()`,
      [userId, key, messages, tokens],
    );
  }

  private exceeded(code: string, message: string, max: number, used: number, resetAt: string): HttpException {
    return new HttpException(
      { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'Too Many Requests', code, message, limit: max, used, resetAt },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
