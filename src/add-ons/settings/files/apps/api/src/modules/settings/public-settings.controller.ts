import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SettingsService } from '@app/common';

/** `GET /api/settings/public`: settings marked `isPublic` (no auth; works during maintenance). */
@ApiTags('settings')
@Controller('settings')
export class PublicSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('public')
  @ApiOperation({ summary: 'Public settings as { key: value } (includes maintenance { enabled, message })' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      additionalProperties: true,
      example: { maintenance: { enabled: false, message: '' } },
    },
  })
  getPublic(): Promise<Record<string, unknown>> {
    return this.settings.getPublic();
  }
}
