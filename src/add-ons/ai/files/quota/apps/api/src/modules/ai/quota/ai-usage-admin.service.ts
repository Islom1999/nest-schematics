import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiUsageDaily, AiUsageMonthly } from '@app/database';
import { dayKey, dayWindow } from '../ai-days';
import { AiQuotaService } from './ai-quota.service';
import { AiUsageAdminDto, AiUsageAdminQueryDto } from './ai-usage.dto';

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 100;

/** Admin view of the quota counters (`ai_usage_daily` and `ai_usage_monthly`). */
@Injectable()
export class AiUsageAdminService {
  constructor(
    @InjectRepository(AiUsageDaily) private readonly daily: Repository<AiUsageDaily>,
    @InjectRepository(AiUsageMonthly) private readonly monthly: Repository<AiUsageMonthly>,
    private readonly quota: AiQuotaService,
  ) {}

  /**
   * Daily rows of the UTC days `from`..`to` (default the last 30 days) and the
   * monthly rows of the months they touch, for one user or for everyone
   * (heaviest first, at most `limit` rows each; `totals` count every row).
   * With a `userId` it also returns that user's usage and limits right now.
   */
  async usage(query: AiUsageAdminQueryDto): Promise<AiUsageAdminDto> {
    const window = dayWindow(query.from, query.to, DEFAULT_DAYS);
    const from = dayKey(window.from);
    const to = dayKey(window.to);
    const firstMonth = `${from.slice(0, 7)}-01`;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const dailyQuery = () => {
      const qb = this.daily.createQueryBuilder('d').where('d.day >= :from AND d.day <= :to', { from, to });
      return query.userId ? qb.andWhere('d.userId = :userId', { userId: query.userId }) : qb;
    };
    const monthlyQuery = () => {
      const qb = this.monthly.createQueryBuilder('m').where('m.month >= :firstMonth AND m.month <= :to', { firstMonth, to });
      return query.userId ? qb.andWhere('m.userId = :userId', { userId: query.userId }) : qb;
    };

    const [dailyRows, dailyTotals, monthlyRows, monthlyTotals] = await Promise.all([
      dailyQuery().orderBy('d.day', 'DESC').addOrderBy('d.tokens', 'DESC').addOrderBy('d.userId', 'ASC').limit(limit).getMany(),
      dailyQuery()
        .select('COALESCE(SUM(d.messages), 0)', 'messages')
        .addSelect('COALESCE(SUM(d.tokens), 0)', 'tokens')
        .addSelect('COUNT(DISTINCT d.userId)', 'users')
        .getRawOne<{ messages: string; tokens: string; users: string }>(),
      monthlyQuery().orderBy('m.month', 'DESC').addOrderBy('m.tokens', 'DESC').addOrderBy('m.userId', 'ASC').limit(limit).getMany(),
      monthlyQuery()
        .select('COALESCE(SUM(m.messages), 0)', 'messages')
        .addSelect('COALESCE(SUM(m.tokens), 0)', 'tokens')
        .addSelect('COUNT(DISTINCT m.userId)', 'users')
        .getRawOne<{ messages: string; tokens: string; users: string }>(),
    ]);

    return {
      userId: query.userId ?? null,
      from,
      to,
      daily: dailyRows.map((r) => ({ userId: r.userId, day: r.day, messages: r.messages, tokens: r.tokens })),
      monthly: monthlyRows.map((r) => ({ userId: r.userId, month: r.month.slice(0, 7), messages: r.messages, tokens: r.tokens })),
      totals: {
        dailyMessages: Number(dailyTotals?.messages ?? 0),
        dailyTokens: Number(dailyTotals?.tokens ?? 0),
        dailyUsers: Number(dailyTotals?.users ?? 0),
        monthlyMessages: Number(monthlyTotals?.messages ?? 0),
        monthlyTokens: Number(monthlyTotals?.tokens ?? 0),
        monthlyUsers: Number(monthlyTotals?.users ?? 0),
      },
      current: query.userId ? await this.quota.usage(query.userId) : null,
    };
  }
}
