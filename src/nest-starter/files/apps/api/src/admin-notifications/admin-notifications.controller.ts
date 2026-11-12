import { Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AdminResource } from '../auth/admin-resource.decorator';
import { AdminPrincipal } from '../auth/auth.types';
import { CurrentAdmin } from '../auth/current-admin.decorator';
import { AdminNotificationDto } from './admin-notifications.dto';
import { AdminNotificationsService } from './admin-notifications.service';

/** `admin/me/notifications`: the signed-in admin's own notifications; no permission needed. */
@AdminResource('me/notifications')
export class AdminMeNotificationsController {
  constructor(private readonly notifications: AdminNotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'My notifications, newest first (at most 50)' })
  @ApiOkResponse({ type: AdminNotificationDto, isArray: true })
  findAll(@CurrentAdmin() admin: AdminPrincipal): Promise<AdminNotificationDto[]> {
    return this.notifications.list(admin.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/read')
  @ApiOperation({ summary: 'Mark one of my notifications as read' })
  @ApiOkResponse({ type: AdminNotificationDto })
  @ApiNotFoundResponse({ description: 'No such notification of mine' })
  markRead(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminNotificationDto> {
    return this.notifications.markRead(admin.id, id);
  }
}
