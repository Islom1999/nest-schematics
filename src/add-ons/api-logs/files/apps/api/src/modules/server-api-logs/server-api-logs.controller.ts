import { Body, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiOperation, getSchemaPath } from '@nestjs/swagger';
import { AdminAccess, TableQueryDto } from '@app/common';
import { ServerApiLog } from '@app/database';
import { AdminResource } from '../../auth';
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
  @ApiOperation({ summary: 'Paged logs (PrimeNG lazy table), newest first; bodies omitted' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        count: { type: 'number', example: 1 },
        data: { type: 'array', items: { $ref: getSchemaPath(ServerApiLog) } },
      },
    },
  })
  findAllPagination(@Body() query: TableQueryDto) {
    return this.service.page(query);
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
