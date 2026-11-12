import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, PaginatedResult } from '@app/common';
import { Notification } from '@app/database';
import { CurrentUser, UserGuard, UserPrincipal } from '../../client-auth';
import { SuccessDto } from '../../auth/dto/auth-response.dto';
import { MarkedReadDto, NotificationListQueryDto, NotificationTopicDto, UnreadCountDto } from './dto/notification.dto';
import { NotificationInboxService } from './notification-inbox.service';

/**
 * `/api/client/notifications`: the signed-in user's notifications, newest
 * first, and the topics the user is subscribed to (an admin broadcast with target
 * topic reaches them). The device's push token is set with `PUT client/auth/push-token`.
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

  @Get('topics')
  @ApiOperation({ summary: 'Topics I am subscribed to' })
  @ApiOkResponse({ type: NotificationTopicDto, isArray: true })
  topics(@CurrentUser() user: UserPrincipal): Promise<NotificationTopicDto[]> {
    return this.inbox.topicsOf(user.id);
  }

  @Put('topics/:topic')
  @ApiOperation({ summary: 'Subscribe to a topic (letters, digits and - _ . ~ %, max 100 chars; at most 100 topics)' })
  @ApiOkResponse({ type: NotificationTopicDto })
  subscribe(@CurrentUser() user: UserPrincipal, @Param('topic') topic: string): Promise<NotificationTopicDto> {
    return this.inbox.subscribe(user.id, topic);
  }

  @Delete('topics/:topic')
  @ApiOperation({ summary: 'Unsubscribe from a topic' })
  @ApiOkResponse({ type: SuccessDto })
  async unsubscribe(@CurrentUser() user: UserPrincipal, @Param('topic') topic: string): Promise<SuccessDto> {
    await this.inbox.unsubscribe(user.id, topic);
    return { success: true };
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
