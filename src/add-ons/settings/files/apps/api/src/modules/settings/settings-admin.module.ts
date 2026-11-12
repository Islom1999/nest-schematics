import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppSetting } from '@app/database';
import { PublicSettingsController } from './public-settings.controller';
import { SettingsAdminController } from './settings-admin.controller';
import { SettingsAdminService } from './settings-admin.service';

/** Admin CRUD (`admin/settings`) and the public read (`settings/public`). */
@Module({
  imports: [TypeOrmModule.forFeature([AppSetting])],
  controllers: [SettingsAdminController, PublicSettingsController],
  providers: [SettingsAdminService],
})
export class SettingsAdminModule {}
