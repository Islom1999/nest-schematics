import { Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AdminAccess } from '@app/common';
import { AdminResource } from '../../../auth';
import { AiUsageAdminService } from './ai-usage-admin.service';
import { AiUsageAdminDto, AiUsageAdminQueryDto } from './ai-usage.dto';

/**
 * `/api/admin/ai/usage`: per-user AI chat quota usage (`ai.read`), next to the
 * stats and logs of the core add-on (`npm run g -- ai --quota`).
 */
@AdminResource('ai', { read: ['ai.read'] })
export class AiAdminQuotaController {
  constructor(private readonly service: AiUsageAdminService) {}

  @AdminAccess('read')
  @Get('usage')
  @ApiOperation({ summary: 'Daily and monthly quota usage (messages, tokens) per user, for a day window (?userId=&from=&to=)' })
  @ApiOkResponse({ type: AiUsageAdminDto })
  usage(@Query() query: AiUsageAdminQueryDto): Promise<AiUsageAdminDto> {
    return this.service.usage(query);
  }
}
