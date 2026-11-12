import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseCrudService, TableQueryDto, TableQueryOptions } from '@app/common';
import { ServerApiLog } from '@app/database';
import { ServerApiLogStatsDto } from './dto/server-api-log-stats.dto';

/** Read-only admin queries over `server_api_logs`. */
@Injectable()
export class ServerApiLogsService extends BaseCrudService<ServerApiLog> {
  protected override tableOptions: TableQueryOptions = {
    searchFields: ['url', 'module', 'handler', 'error', 'requestId', 'userId'],
    defaultSort: { field: 'createdAt', order: 'DESC' },
  };

  constructor(@InjectRepository(ServerApiLog) private readonly logs: Repository<ServerApiLog>) {
    super(logs);
  }

  /** Table rows without the (large) bodies; `GET :id` returns them. */
  async page(query: TableQueryDto) {
    const result = await this.findAllPagination(query, true);
    return {
      count: result.count,
      data: result.data.map((row) => {
        const light: Partial<ServerApiLog> = { ...(row as ServerApiLog) };
        delete light.requestBody;
        delete light.responseBody;
        return light;
      }),
    };
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
