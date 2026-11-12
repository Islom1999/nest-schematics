import { Body, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AdminAccess, ApiPaginatedResponse, PaginatedResult, TableQueryDto } from '@app/common';
import { Notification, NotificationCampaign } from '@app/database';
import { AdminPrincipal, AdminResource, CurrentAdmin } from '../../auth';
import { BroadcastNotificationDto, NotificationCampaignDetailDto, NotificationTableQueryDto } from './dto/notification.dto';
import { NotificationAdminService } from './notification-admin.service';

/**
 * `/api/admin/notifications`: broadcasts (`notification.write`), campaign
 * history and every user's notifications (`notification.read`). Table routes
 * match the CRUD ones (PrimeNG lazy table).
 */
@AdminResource('notifications', { read: ['notification.read'], write: ['notification.write'] })
export class AdminNotificationsController {
  constructor(private readonly service: NotificationAdminService) {}

  @AdminAccess('write')
  @HttpCode(HttpStatus.OK)
  @Post('broadcast')
  @ApiOperation({ summary: 'Send a notification to all users, to some users, or to the users of one platform' })
  @ApiOkResponse({ type: NotificationCampaign })
  broadcast(@Body() dto: BroadcastNotificationDto, @CurrentAdmin() admin: AdminPrincipal): Promise<NotificationCampaign> {
    return this.service.broadcast(dto, admin?.id ?? null);
  }

  @AdminAccess('read')
  @HttpCode(HttpStatus.OK)
  @Post('campaigns/pagination')
  @ApiOperation({ summary: 'Paged broadcast history (PrimeNG lazy table), newest first' })
  @ApiPaginatedResponse(NotificationCampaign)
  campaigns(@Body() query: TableQueryDto): Promise<PaginatedResult<NotificationCampaign>> {
    return this.service.campaignsPage(query);
  }

  @AdminAccess('read')
  @Get('campaigns/:id')
  @ApiOperation({ summary: 'One campaign with live read and push counts' })
  @ApiOkResponse({ type: NotificationCampaignDetailDto })
  campaign(@Param('id', ParseUUIDPipe) id: string): Promise<NotificationCampaignDetailDto> {
    return this.service.campaign(id);
  }

  @AdminAccess('read')
  @HttpCode(HttpStatus.OK)
  @Post('pagination')
  @ApiOperation({ summary: 'Paged notifications of every user (PrimeNG lazy table, optional userId), newest first' })
  @ApiPaginatedResponse(Notification)
  findAllPagination(@Body() query: NotificationTableQueryDto): Promise<PaginatedResult<Notification>> {
    return this.service.notificationsPage(query);
  }
}
