import { Body, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiOperation, ApiProduces, getSchemaPath } from '@nestjs/swagger';
import { AdminAccess } from '@app/common';
import { ServerApiLog } from '@app/database';
import { AdminResource } from '../../auth';
import { ServerApiLogExportQueryDto, ServerApiLogQueryDto } from './dto/server-api-log-query.dto';
import { ServerApiLogStatsDto, ServerApiLogStatsQueryDto } from './dto/server-api-log-stats.dto';
import { ServerApiLogsService } from './server-api-logs.service';

/**
 * `/api/admin/server-api-logs`: read-only (no create/update/delete routes;
 * rows are removed by the retention job). Permission `server_api_log.read`.
 */
@ApiExtraModels(ServerApiLog)
@AdminResource('server-api-logs', { read: ['server_api_log.read'], write: [] })
export class ServerApiLogsController {
  constructor(private readonly service: ServerApiLogsService) {}

  @AdminAccess('read')
  @HttpCode(HttpStatus.OK)
  @Post('pagination')
  @ApiOperation({
    summary:
      'Paged logs (PrimeNG lazy table), newest first; bodies omitted. Typed filters: type, method, statusCode, path, userId, from, to, minDurationMs, maxDurationMs',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        count: { type: 'number', example: 1 },
        data: { type: 'array', items: { $ref: getSchemaPath(ServerApiLog) } },
      },
    },
  })
  findAllPagination(@Body() query: ServerApiLogQueryDto) {
    return this.service.page(query);
  }

  @AdminAccess('read')
  @Get('export')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'CSV download of the logs matching the pagination filters (no bodies; newest first; limit 20000, default 5000)',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'CSV file', schema: { type: 'string', format: 'binary' } })
  async exportLogs(@Query() query: ServerApiLogExportQueryDto): Promise<StreamableFile> {
    const { stream, filename } = await this.service.exportCsv(query);
    return new StreamableFile(stream, { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${filename}"` });
  }

  @AdminAccess('read')
  @Get('stats/summary')
  @ApiOperation({ summary: 'Counts by type and status, error totals and timings for the last N hours' })
  @ApiOkResponse({ type: ServerApiLogStatsDto })
  stats(@Query() query: ServerApiLogStatsQueryDto) {
    return this.service.stats(query.hours ?? 24);
  }

  @AdminAccess('read')
  @Get(':id')
  @ApiOperation({ summary: 'One log with its request and response bodies' })
  @ApiOkResponse({ type: ServerApiLog })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id, true);
  }
}
