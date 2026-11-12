import { Body, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse } from '@nestjs/swagger';
import { AdminAccess, AiService, ApiPaginatedResponse, TableQueryDto } from '@app/common';
import { AiLog } from '@app/database';
import { AdminPrincipal, AdminResource, CurrentAdmin } from '../../auth';
import { AiAdminService } from './ai-admin.service';
import { AiGenerateDto, AiGenerateResultDto, AiStatusDto } from './dto/ai-generate.dto';
import { AiStatsDto, AiStatsQueryDto } from './dto/ai-stats.dto';

/**
 * `/api/admin/ai`: AI usage statistics and the ai_logs table (permission
 * `ai.read`), and a prompt playground (`ai.write`, the call is billed).
 */
@AdminResource('ai', { read: ['ai.read'], write: ['ai.write'] })
export class AiAdminController {
  constructor(
    private readonly service: AiAdminService,
    private readonly ai: AiService,
  ) {}

  @AdminAccess('read')
  @Get('stats')
  @ApiOperation({ summary: 'Totals, usage and cost per day, usage per model and the top users for the last N days, or for the days from..to' })
  @ApiOkResponse({ type: AiStatsDto })
  stats(@Query() query: AiStatsQueryDto) {
    return this.service.stats(query);
  }

  @AdminAccess('read')
  @HttpCode(HttpStatus.OK)
  @Post('logs/pagination')
  @ApiOperation({ summary: 'Paged ai_logs (PrimeNG lazy table), newest first; bodies omitted' })
  @ApiPaginatedResponse(AiLog)
  findLogs(@Body() query: TableQueryDto) {
    return this.service.page(query);
  }

  @AdminAccess('read')
  @Get('logs/:id')
  @ApiOperation({ summary: 'One AI call with its request and response bodies (when AI_LOG_BODIES=true)' })
  @ApiOkResponse({ type: AiLog })
  findLog(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @AdminAccess('read')
  @Get('status')
  @ApiOperation({ summary: 'Installed providers and whether their API keys are set' })
  @ApiOkResponse({ type: AiStatusDto })
  status(): AiStatusDto {
    return this.ai.status();
  }

  @AdminAccess('write')
  @HttpCode(HttpStatus.OK)
  @Post('generate')
  @ApiOperation({ summary: 'Run a prompt (logged to ai_logs as module "admin", user "admin:<id>")' })
  @ApiOkResponse({ type: AiGenerateResultDto })
  @ApiServiceUnavailableResponse({ description: 'AI_NOT_CONFIGURED: the provider API key is not set' })
  generate(@Body() dto: AiGenerateDto, @CurrentAdmin() admin: AdminPrincipal): Promise<AiGenerateResultDto> {
    return this.ai.generate(dto.prompt, {
      system: dto.system,
      provider: dto.provider,
      model: dto.model,
      maxTokens: dto.maxTokens,
      // Prefixed so admin test calls are told apart from app users in the stats.
      userId: `admin:${admin.id}`,
      module: 'admin',
    });
  }
}
