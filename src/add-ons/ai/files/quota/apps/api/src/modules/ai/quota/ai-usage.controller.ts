import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, UserGuard, UserPrincipal } from '../../../client-auth';
import { AiQuotaService } from './ai-quota.service';
import { AiUsageDto } from './ai-usage.dto';

/** `/api/client/ai/usage`: the signed-in user's AI limits and what is left. */
@ApiTags('client/ai/usage')
@ApiBearerAuth()
@UseGuards(UserGuard)
@Controller('client/ai/usage')
export class AiUsageController {
  constructor(private readonly quota: AiQuotaService) {}

  @Get()
  @ApiOperation({ summary: 'AI chat usage today and this month, with the limits' })
  @ApiOkResponse({ type: AiUsageDto })
  usage(@CurrentUser() user: UserPrincipal): Promise<AiUsageDto> {
    return this.quota.usage(user.id);
  }
}
