import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AiLog } from '@app/database';
import { addDays, dayKey, dayWindow, eachDay, MAX_RANGE_DAYS, parseDay } from './ai-days';
import { AiAdminService } from './ai-admin.service';

describe('day windows', () => {
  it('parses real UTC days only', () => {
    expect(parseDay('2026-02-28', 'from').toISOString()).toBe('2026-02-28T00:00:00.000Z');
    for (const bad of ['2026-02-30', '2026-2-3', 'yesterday', '2026-02-28T10:00:00Z', '']) {
      expect(() => parseDay(bad, 'from')).toThrow(BadRequestException);
    }
  });

  it('lists every day of a window, both ends included', () => {
    expect(eachDay(parseDay('2026-02-27', 'from'), parseDay('2026-03-02', 'to'))).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    expect(eachDay(parseDay('2026-03-02', 'from'), parseDay('2026-03-02', 'to'))).toEqual(['2026-03-02']);
  });

  it('defaults to a window of N days ending on `to` (or today)', () => {
    const { from, to } = dayWindow(undefined, '2026-03-10', 7);
    expect([dayKey(from), dayKey(to)]).toEqual(['2026-03-04', '2026-03-10']);
    const today = dayWindow(undefined, undefined, 30);
    expect(dayKey(today.to)).toBe(dayKey(new Date()));
    expect(eachDay(today.from, today.to).length).toBe(30);
  });

  it('refuses a backwards or too long window', () => {
    expect(() => dayWindow('2026-03-10', '2026-03-01', 30)).toThrow('from must not be after to');
    expect(() => dayWindow('2024-01-01', '2026-01-01', 30)).toThrow(`at most ${MAX_RANGE_DAYS} days`);
    expect(() => dayWindow('2026-01-01', '2026-12-31', 30)).not.toThrow();
  });

  it('adds days across month ends', () => {
    expect(dayKey(addDays(parseDay('2026-01-31', 'from'), 1))).toBe('2026-02-01');
  });
});

describe('AiAdminService.stats', () => {
  /** Query builder that records its parameters and answers the byDay, byModel and topUsers queries in order. */
  function service(byDay: Record<string, string>[] = []) {
    const params: Record<string, unknown>[] = [];
    const answers = [byDay, [], []];
    let call = 0;
    const qb: Record<string, unknown> = {};
    for (const name of ['select', 'addSelect', 'groupBy', 'addGroupBy', 'orderBy', 'addOrderBy', 'limit']) qb[name] = () => qb;
    for (const name of ['where', 'andWhere']) {
      qb[name] = (_sql: string, values?: Record<string, unknown>) => {
        if (values) params.push(values);
        return qb;
      };
    }
    qb.getRawOne = async () => ({ requests: '0' });
    qb.getRawMany = async () => answers[call++] ?? [];
    return { service: new AiAdminService({ createQueryBuilder: () => qb } as unknown as Repository<AiLog>), params };
  }

  it('keeps the old shape for ?days= and adds from, to and a zero-filled cost series', async () => {
    const { service: svc, params } = service([{ day: dayKey(new Date()), requests: '2', errors: '0', tokens: '10', costUsd: '0.5' }]);
    const stats = await svc.stats({ days: 3 });

    expect(Object.keys(stats).sort()).toEqual(['byDay', 'byModel', 'costByDay', 'from', 'since', 'to', 'topUsers', 'totals']);
    expect(params.some((p) => 'until' in p)).toBe(false);
    expect(stats.costByDay.length).toBeGreaterThanOrEqual(3);
    expect(stats.costByDay[stats.costByDay.length - 1]).toEqual({ day: dayKey(new Date()), costUsd: 0.5 });
    expect(stats.costByDay[0].costUsd).toBe(0);
  });

  it('filters by from/to (inclusive days) and fills idle days with 0', async () => {
    const { service: svc, params } = service([{ day: '2026-03-02', requests: '1', errors: '0', tokens: '5', costUsd: '0.25' }]);
    const stats = await svc.stats({ from: '2026-03-01', to: '2026-03-03' });

    expect(params[0]).toEqual({ since: new Date('2026-03-01T00:00:00.000Z') });
    expect(params[1]).toEqual({ until: new Date('2026-03-04T00:00:00.000Z') });
    expect([stats.from, stats.to, stats.since]).toEqual(['2026-03-01', '2026-03-03', '2026-03-01T00:00:00.000Z']);
    expect(stats.costByDay).toEqual([
      { day: '2026-03-01', costUsd: 0 },
      { day: '2026-03-02', costUsd: 0.25 },
      { day: '2026-03-03', costUsd: 0 },
    ]);
  });

  it('rejects a bad window', async () => {
    await expect(service().service.stats({ from: '2026-03-05', to: '2026-03-01' })).rejects.toThrow(BadRequestException);
    await expect(service().service.stats({ from: 'nope' })).rejects.toThrow(BadRequestException);
  });
});
