import { DynamicModule, Module, Type } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification, NotificationCampaign, User, UserSession } from '@app/database';
import { FcmSender } from './fcm.sender';
import { NOTIFICATION_CHANNELS, NotificationChannel } from './notification-channel';
import { NOTIFICATION_EXTRA_CHANNELS } from './notification-channels';
import { NotificationService } from './notification.service';
import { PushTokenStore, SessionPushTokenStore } from './push-token-store';

export interface NotificationModuleOptions {
  /**
   * Where push tokens come from. Default: `user_sessions` through TypeORM
   * (SessionPushTokenStore). The API passes ClientPushTokenStore, which goes
   * through the auth-client's UserSessionsService.
   */
  tokenStore?: Type<PushTokenStore>;
  /** false = push only, no telegram/email channels (the worker only retries pushes). Default true. */
  channels?: boolean;
}

/**
 * NotificationService (send + push retry) and FcmSender, global once imported
 * (`npm run g -- notifications`). The API imports
 * `NotificationModule.forRoot({ tokenStore: ClientPushTokenStore })`, the
 * worker `NotificationModule.forRoot({ channels: false })`.
 */
@Module({})
export class NotificationModule {
  static forRoot(options: NotificationModuleOptions = {}): DynamicModule {
    const channels = options.channels === false ? [] : NOTIFICATION_EXTRA_CHANNELS;
    return {
      module: NotificationModule,
      global: true,
      imports: [TypeOrmModule.forFeature([Notification, NotificationCampaign, User, UserSession])],
      providers: [
        FcmSender,
        { provide: PushTokenStore, useClass: options.tokenStore ?? SessionPushTokenStore },
        ...channels,
        { provide: NOTIFICATION_CHANNELS, inject: channels, useFactory: (...list: NotificationChannel[]) => list },
        NotificationService,
      ],
      exports: [NotificationService, FcmSender, PushTokenStore],
    };
  }
}
