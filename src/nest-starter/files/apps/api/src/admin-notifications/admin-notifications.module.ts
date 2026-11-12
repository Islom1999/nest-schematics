import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminNotification } from '@app/database';
import { AdminMeNotificationsController } from './admin-notifications.controller';
import { AdminNotificationsService } from './admin-notifications.service';

/**
 * The admin's own notifications. Global so any feature can inject
 * `AdminNotificationsService` and call `notify(adminId, { title, link })`.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AdminNotification])],
  controllers: [AdminMeNotificationsController],
  providers: [AdminNotificationsService],
  exports: [AdminNotificationsService],
})
export class AdminNotificationsModule {}
