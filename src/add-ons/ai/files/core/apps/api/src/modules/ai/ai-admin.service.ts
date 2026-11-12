import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaginatedResult, runTableQuery, TableQueryDto } from '@app/common';
import { AiLog } from '@app/database';
import { AiStatsDto } from './dto/ai-stats.dto';

const num = (value: string | number | null | undefined): number => (value === null || value === undefined ? 0 : Number(value));
const nullableNum = (value: string | number | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.round(Number(value));
const usd = (value: string | number | null | undefined): number => Math.round(num(value) * 1e6) / 1e6;

/** Read-only admin queries over `ai_logs`: usage statistics and the log table. */
@Injectable()
export class AiAdminService {
  constructor(@InjectRepository(AiLog) private readonly logs: Repository<AiLog>) {}

  /** Table rows without the (large) bodies; `GET logs/:id` returns them. */
  async page(query: TableQueryDto): Promise<PaginatedResult<AiLog>> {
    const result = await runTableQuery(this.logs.createQueryBuilder('log'), query, {
      searchFields: ['userId', 'module', 'provider', 'model', 'operation', 'error'],
      defaultSort: { field: 'createdAt', order: 'DESC' },
    });
    for (const row of result.data) {
      row.requestBody = null;
      row.responseBody = null;
    }
    return result;
  }

  async findOne(id: string): Promise<AiLog> {
    const log = await this.logs.findOne({ where: { id } });
    if (!log) throw new NotFoundException('AI log not found');
    return log;
  }

  async stats(days: number, top: number): Promise<AiStatsDto> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const base = () => this.logs.createQueryBuilder('log').where('log.createdAt >= :since', { since });
    const tokens = 'COALESCE(SUM(log.promptTokens + log.completionTokens), 0)';
    const cost = 'COALESCE(SUM(log.costUsd), 0)';

    const totals = await base()
      .select('COUNT(*)', 'requests')
      .addSelect('COUNT(*) FILTER (WHERE log.error IS NOT NULL)', 'errors')
      .addSelect('COALESCE(SUM(log.promptTokens), 0)', 'promptTokens')
      .addSelect('COALESCE(SUM(log.completionTokens), 0)', 'completionTokens')
      .addSelect(cost, 'costUsd')
      .addSelect('AVG(log.latencyMs)', 'avgLatencyMs')
      .addSelect('COUNT(*) FILTER (WHERE log.cacheHit)', 'cacheHits')
      .getRawOne<Record<string, string | null>>();

    const day = `to_char(date_trunc('day', log.createdAt AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
    const byDay = await base()
      .select(day, 'day')
      .addSelect('COUNT(*)', 'requests')
      .addSelect('COUNT(*) FILTER (WHERE log.error IS NOT NULL)', 'errors')
      .addSelect(tokens, 'tokens')
      .addSelect(cost, 'costUsd')
      .groupBy(day)
      .orderBy('"day"', 'ASC')
      .getRawMany<Record<string, string>>();

    const byModel = await base()
      .select('log.provider', 'provider')
      .addSelect('log.model', 'model')
      .addSelect('COUNT(*)', 'requests')
      .addSelect(tokens, 'tokens')
      .addSelect(cost, 'costUsd')
      .addSelect('AVG(log.latencyMs)', 'avgLatencyMs')
      .groupBy('log.provider')
      .addGroupBy('log.model')
      .orderBy('"costUsd"', 'DESC')
      .addOrderBy('"requests"', 'DESC')
      .limit(50)
      .getRawMany<Record<string, string | null>>();

    const topUsers = await base()
      .andWhere('log.userId IS NOT NULL')
      .select('log.userId', 'userId')
      .addSelect('COUNT(*)', 'requests')
      .addSelect(tokens, 'tokens')
      .addSelect(cost, 'costUsd')
      .groupBy('log.userId')
      .orderBy('"costUsd"', 'DESC')
      .addOrderBy('"tokens"', 'DESC')
      .limit(top)
      .getRawMany<Record<string, string>>();

    return {
      since: since.toISOString(),
      totals: {
        requests: num(totals?.requests),
        errors: num(totals?.errors),
        promptTokens: num(totals?.promptTokens),
        completionTokens: num(totals?.completionTokens),
        costUsd: usd(totals?.costUsd),
        avgLatencyMs: nullableNum(totals?.avgLatencyMs),
        cacheHits: num(totals?.cacheHits),
      },
      byDay: byDay.map((r) => ({
        day: r.day,
        requests: num(r.requests),
        errors: num(r.errors),
        tokens: num(r.tokens),
        costUsd: usd(r.costUsd),
      })),
      byModel: byModel.map((r) => ({
        provider: r.provider ?? '',
        model: r.model ?? '',
        requests: num(r.requests),
        tokens: num(r.tokens),
        costUsd: usd(r.costUsd),
        avgLatencyMs: nullableNum(r.avgLatencyMs),
      })),
      topUsers: topUsers.map((r) => ({ userId: r.userId, requests: num(r.requests), tokens: num(r.tokens), costUsd: usd(r.costUsd) })),
    };
  }
}
