import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Readable } from 'node:stream';
import { Repository } from 'typeorm';
import { BaseCrudService, escapeLike, runTableQuery, TableQueryOptions } from '@app/common';
import { ServerApiLog } from '@app/database';
import { csvRow } from './csv';
import { EXPORT_DEFAULT_ROWS, EXPORT_MAX_ROWS, ServerApiLogExportQueryDto, ServerApiLogQueryDto } from './dto/server-api-log-query.dto';
import { ServerApiLogStatsDto } from './dto/server-api-log-stats.dto';

/** Columns of the CSV export, in order (bodies are left out). */
export const EXPORT_COLUMNS = [
  'createdAt',
  'id',
  'type',
  'module',
  'handler',
  'method',
  'url',
  'statusCode',
  'durationMs',
  'userId',
  'userType',
  'ip',
  'requestId',
  'serverId',
  'error',
] as const;

/** Internal `filters` key: rows created up to the start of an export, so new rows do not shift its pages. */
const EXPORT_SNAPSHOT = '__exportSnapshot';
/** `runTableQuery` serves at most this many rows per page. */
const PAGE = 100;

const A = 'entity';

/** Read-only admin queries over `server_api_logs`. */
@Injectable()
export class ServerApiLogsService extends BaseCrudService<ServerApiLog> {
  protected override tableOptions: TableQueryOptions = {
    searchFields: ['url', 'module', 'handler', 'error', 'requestId', 'userId'],
    defaultSort: { field: 'createdAt', order: 'DESC' },
    // Typed shortcuts of ServerApiLogQueryDto: plain ones are `equals`, the rest are custom.
    queryFilters: ['type', 'method', 'statusCode', 'userId', 'path', 'from', 'to', 'minDurationMs', 'maxDurationMs'],
    customFilters: {
      path: (qb, rule, param) => qb.andWhere(`${A}.url ILIKE :${param}`, { [param]: `%${escapeLike(String(rule.value))}%` }),
      from: (qb, rule, param) => qb.andWhere(`${A}.createdAt >= :${param}`, { [param]: new Date(String(rule.value)) }),
      to: (qb, rule, param) => qb.andWhere(`${A}.createdAt <= :${param}`, { [param]: new Date(String(rule.value)) }),
      minDurationMs: (qb, rule, param) => qb.andWhere(`${A}.durationMs >= :${param}`, { [param]: Number(rule.value) }),
      maxDurationMs: (qb, rule, param) => qb.andWhere(`${A}.durationMs <= :${param}`, { [param]: Number(rule.value) }),
      [EXPORT_SNAPSHOT]: (qb, rule, param) => qb.andWhere(`${A}.createdAt <= :${param}`, { [param]: new Date(String(rule.value)) }),
    },
  };

  constructor(@InjectRepository(ServerApiLog) private readonly logs: Repository<ServerApiLog>) {
    super(logs);
  }

  /** Table rows without the (large) bodies; `GET :id` returns them. */
  async page(query: ServerApiLogQueryDto) {
    const result = await this.findAllPagination(query, true);
    return {
      count: result.count,
      data: result.data.map((row) => light(row as ServerApiLog)),
    };
  }

  /**
   * CSV of the rows matching the same filters as `page()`, newest first, at
   * most `limit` (default 5000, max 20000) rows. Read in pages of 100 while the
   * response is written, so memory stays flat. The first page is read before
   * this returns: a bad filter is a 400, not a broken download.
   */
  async exportCsv(query: ServerApiLogExportQueryDto, now = new Date()): Promise<{ stream: Readable; filename: string }> {
    const max = Math.min(Math.max(query.limit ?? EXPORT_DEFAULT_ROWS, 1), EXPORT_MAX_ROWS);
    const base = {
      ...query,
      sortField: query.sortField || 'createdAt',
      sortOrder: query.sortField ? query.sortOrder : -1,
      filters: { ...(query.filters ?? {}), [EXPORT_SNAPSHOT]: { value: now.toISOString() } },
    };
    const fetch = (offset: number, rows: number) => this.fetchPage({ ...base, first: offset, rows });
    const firstPage = await fetch(0, Math.min(PAGE, max));

    const lines = async function* () {
      yield `\uFEFF${csvRow([...EXPORT_COLUMNS])}`;
      let sent = 0;
      let page = firstPage;
      for (;;) {
        for (const row of page.data) {
          yield csvRow(EXPORT_COLUMNS.map((c) => row[c]));
          sent++;
        }
        if (sent >= max || page.data.length < PAGE) return;
        page = await fetch(sent, Math.min(PAGE, max - sent));
      }
    };
    return {
      stream: Readable.from(lines()),
      filename: `server-api-logs-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`,
    };
  }

  /** One page of rows (no bodies); `first` and `rows` come from the caller. */
  protected fetchPage(query: ServerApiLogQueryDto) {
    return runTableQuery(this.createQuery(), query, this.tableOptions);
  }

  async stats(hours: number): Promise<ServerApiLogStatsDto> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const base = () => this.logs.createQueryBuilder('log').where('log.createdAt >= :since', { since });

    const totals = await base()
      .select('COUNT(*)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE log.statusCode >= 500)', 'serverErrors')
      .addSelect('COUNT(*) FILTER (WHERE log.statusCode >= 400 AND log.statusCode < 500)', 'clientErrors')
      .addSelect('ROUND(AVG(log.durationMs))', 'avgDurationMs')
      .addSelect('MAX(log.durationMs)', 'maxDurationMs')
      .getRawOne<Record<string, string | null>>();
    const byType = await base()
      .select('log.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .groupBy('log.type')
      .orderBy('COUNT(*)', 'DESC')
      .getRawMany<{ type: string; count: string }>();
    const byStatus = await base()
      .select('log.statusCode', 'statusCode')
      .addSelect('COUNT(*)', 'count')
      .groupBy('log.statusCode')
      .orderBy('COUNT(*)', 'DESC')
      .limit(20)
      .getRawMany<{ statusCode: number | null; count: string }>();

    const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
    return {
      since: since.toISOString(),
      total: num(totals?.total) ?? 0,
      serverErrors: num(totals?.serverErrors) ?? 0,
      clientErrors: num(totals?.clientErrors) ?? 0,
      avgDurationMs: num(totals?.avgDurationMs),
      maxDurationMs: num(totals?.maxDurationMs),
      byType: byType.map((r) => ({ type: r.type, count: Number(r.count) })),
      byStatus: byStatus.map((r) => ({ statusCode: r.statusCode, count: Number(r.count) })),
    };
  }
}

/** A row without the (large) bodies. */
function light(row: ServerApiLog): Partial<ServerApiLog> {
  const copy: Partial<ServerApiLog> = { ...row };
  delete copy.requestBody;
  delete copy.responseBody;
  return copy;
}
