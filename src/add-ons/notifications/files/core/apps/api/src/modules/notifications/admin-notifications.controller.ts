import { Body, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AdminAccess, ApiPaginatedResponse, PaginatedResult, TableQueryDto } from '@app/common';
import { Notification, NotificationCampaign } from '@app/database';
import { AdminPrincipal, AdminResource, CurrentAdmin } from '../../auth';
import { SuccessDto } from '../../auth/dto/auth-response.dto';
import { BroadcastNotificationDto, NotificationCampaignDetailDto, NotificationTableQueryDto } from './dto/notification.dto';
import { NotificationAdminService } from './notification-admin.service';

/**
 * `/api/admin/notifications`: broadcasts, resend, delete and cancelling a
 * scheduled campaign (`notification.write`), campaign history and every
 * user's notifications (`notification.read`). Table routes
 * match the CRUD ones (PrimeNG lazy table).
 */
@AdminResource('notifications', { read: ['notification.read'], write: ['notification.write'] })
export class AdminNotificationsController {
  constructor(private readonly service: NotificationAdminService) {}

  @AdminAccess('write')
  @HttpCode(HttpStatus.OK)
  @Post('broadcast')
  @ApiOperation({ summary: 'Send a notification to all users, to some users, to the users of one platform or to a topic; with sendAt it is scheduled' })
  @ApiOkResponse({ type: NotificationCampaign })
  broadcast(@Body() dto: BroadcastNotificationDto, @CurrentAdmin() admin: AdminPrincipal): Promise<NotificationCampaign> {
    return this.service.broadcast(dto, admin?.id ?? null);
  }

  @AdminAccess('write')
  @Delete('campaigns/:id')
  @ApiOperation({ summary: 'Cancel a scheduled campaign (soft delete; 409 once it is being sent or was sent)' })
  @ApiOkResponse({ type: SuccessDto })
  async cancelCampaign(@Param('id', ParseUUIDPipe) id: string): Promise<SuccessDto> {
    await this.service.cancelCampaign(id);
    return { success: true };
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

  @AdminAccess('write')
  @HttpCode(HttpStatus.OK)
  @Post(':id/resend')
  @ApiOperation({ summary: 'Deliver one notification again: marks it unread, pushes it to the user again and re-sends the extra channels' })
  @ApiOkResponse({ type: Notification })
  resend(@Param('id', ParseUUIDPipe) id: string): Promise<Notification> {
    return this.service.resend(id);
  }

  @AdminAccess('write')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete one notification (soft delete); the user no longer sees it' })
  @ApiOkResponse({ type: SuccessDto })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<SuccessDto> {
    await this.service.remove(id);
    return { success: true };
  }
}
