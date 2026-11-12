import { BadRequestException } from '@nestjs/common';
import { ObjectLiteral, Repository } from 'typeorm';
import { AiUsageDaily, AiUsageMonthly } from '@app/database';
import { AiQuotaService } from './ai-quota.service';
import { AiUsageAdminService } from './ai-usage-admin.service';
import { AiUsageDto } from './ai-usage.dto';

describe('AiUsageAdminService', () => {
  const usageNow = { day: '2026-03-03', dailyMessages: 4 } as AiUsageDto;
  const quota = { usage: jest.fn(async (_userId: string) => usageNow) } as unknown as AiQuotaService;

  /** Repository whose query builder records `where` parameters and answers the rows and the sums. */
  function repo<T extends ObjectLiteral>(rows: unknown[], sums: Record<string, string>) {
    const params: Record<string, unknown>[] = [];
    const qb: Record<string, unknown> = {};
    for (const name of ['orderBy', 'addOrderBy', 'limit', 'select', 'addSelect']) qb[name] = () => qb;
    for (const name of ['where', 'andWhere']) {
      qb[name] = (_sql: string, values?: Record<string, unknown>) => {
        if (values) params.push(values);
        return qb;
      };
    }
    qb.getMany = async () => rows;
    qb.getRawOne = async () => sums;
    return { repository: { createQueryBuilder: () => qb } as unknown as Repository<T>, params };
  }

  function service() {
    const daily = repo<AiUsageDaily>(
      [{ userId: 'u1', day: '2026-03-02', messages: 3, tokens: 900 }],
      { messages: '3', tokens: '900', users: '1' },
    );
    const monthly = repo<AiUsageMonthly>(
      [{ userId: 'u1', month: '2026-03-01', messages: 7, tokens: 2100 }],
      { messages: '7', tokens: '2100', users: '1' },
    );
    return { service: new AiUsageAdminService(daily.repository, monthly.repository, quota), daily, monthly };
  }

  it('returns the daily and monthly rows of one user with their current usage', async () => {
    const { service: svc, daily, monthly } = service();
    const result = await svc.usage({ userId: 'u1', from: '2026-02-20', to: '2026-03-03' });

    expect(result.userId).toBe('u1');
    expect([result.from, result.to]).toEqual(['2026-02-20', '2026-03-03']);
    expect(result.daily).toEqual([{ userId: 'u1', day: '2026-03-02', messages: 3, tokens: 900 }]);
    expect(result.monthly).toEqual([{ userId: 'u1', month: '2026-03', messages: 7, tokens: 2100 }]);
    expect(result.totals).toEqual({ dailyMessages: 3, dailyTokens: 900, dailyUsers: 1, monthlyMessages: 7, monthlyTokens: 2100, monthlyUsers: 1 });
    expect(result.current).toBe(usageNow);
    expect(daily.params[0]).toEqual({ from: '2026-02-20', to: '2026-03-03' });
    expect(daily.params[1]).toEqual({ userId: 'u1' });
    // The months the window touches: from February's first day.
    expect(monthly.params[0]).toEqual({ firstMonth: '2026-02-01', to: '2026-03-03' });
  });

  it('covers everyone for the last 30 days without a userId', async () => {
    const { service: svc, daily } = service();
    const result = await svc.usage({});

    expect(result.userId).toBeNull();
    expect(result.current).toBeNull();
    expect(daily.params.length).toBe(2); // the rows query and the totals query, no userId filter
    expect(daily.params.every((p) => !('userId' in p))).toBe(true);
    const { from, to } = daily.params[0] as { from: string; to: string };
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBe(29);
  });

  it('rejects a bad window', async () => {
    await expect(service().service.usage({ from: '2026-03-05', to: '2026-03-01' })).rejects.toThrow(BadRequestException);
    await expect(service().service.usage({ to: '03/01/2026' })).rejects.toThrow(BadRequestException);
  });
});
