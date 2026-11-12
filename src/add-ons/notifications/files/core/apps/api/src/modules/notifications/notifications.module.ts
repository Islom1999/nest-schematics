import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationModule } from '@app/common/notifications';
import { Notification, NotificationCampaign } from '@app/database';
import { AdminNotificationsController } from './admin-notifications.controller';
import { ClientNotificationsController } from './client-notifications.controller';
import { ClientPushTokenStore } from './client-push-token.store';
import { NotificationAdminService } from './notification-admin.service';
import { NotificationInboxService } from './notification-inbox.service';

/**
 * Notification routes (`npm run g -- notifications`): `client/notifications`
 * and `admin/notifications`. Also makes NotificationService global, with push
 * tokens from the auth-client sessions, so any module can inject it:
 *
 *   constructor(private readonly notifications: NotificationService) {}  // from '@app/common/notifications'
 */
@Module({
  imports: [
    NotificationModule.forRoot({ tokenStore: ClientPushTokenStore }),
    TypeOrmModule.forFeature([Notification, NotificationCampaign]),
  ],
  controllers: [ClientNotificationsController, AdminNotificationsController],
  providers: [NotificationInboxService, NotificationAdminService],
})
export class NotificationsModule {}
