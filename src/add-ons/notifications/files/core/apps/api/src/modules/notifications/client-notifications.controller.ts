import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, PaginatedResult } from '@app/common';
import { Notification } from '@app/database';
import { CurrentUser, UserGuard, UserPrincipal } from '../../client-auth';
import { MarkedReadDto, NotificationListQueryDto, UnreadCountDto } from './dto/notification.dto';
import { NotificationInboxService } from './notification-inbox.service';

/**
 * `/api/client/notifications`: the signed-in user's notifications, newest
 * first. The device's push token is set with `PUT client/auth/push-token`.
 */
@ApiTags('client/notifications')
@ApiBearerAuth()
@UseGuards(UserGuard)
@Controller('client/notifications')
export class ClientNotificationsController {
  constructor(private readonly inbox: NotificationInboxService) {}

  @Get()
  @ApiOperation({ summary: 'My notifications, newest first (?first=&rows=&unread=true)' })
  @ApiPaginatedResponse(Notification)
  findAll(@CurrentUser() user: UserPrincipal, @Query() query: NotificationListQueryDto): Promise<PaginatedResult<Notification>> {
    return this.inbox.list(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Number of unread notifications (badge)' })
  @ApiOkResponse({ type: UnreadCountDto })
  async unreadCount(@CurrentUser() user: UserPrincipal): Promise<UnreadCountDto> {
    return { count: await this.inbox.unreadCount(user.id) };
  }

  @HttpCode(HttpStatus.OK)
  @Post('read-all')
  @ApiOperation({ summary: 'Mark every notification read' })
  @ApiOkResponse({ type: MarkedReadDto })
  async markAllRead(@CurrentUser() user: UserPrincipal): Promise<MarkedReadDto> {
    return { updated: await this.inbox.markAllRead(user.id) };
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/read')
  @ApiOperation({ summary: 'Mark one notification read' })
  @ApiOkResponse({ type: Notification })
  markRead(@CurrentUser() user: UserPrincipal, @Param('id', ParseUUIDPipe) id: string): Promise<Notification> {
    return this.inbox.markRead(user.id, id);
  }
}
