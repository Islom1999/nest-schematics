import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppSetting } from '@app/database';
import { MaintenanceGuard } from './maintenance.guard';
import { SettingsService } from './settings.service';

/**
 * SettingsService for any app (api, worker). Global, so feature modules can
 * inject it without importing this module again. Needs CACHE_STORE
 * (CacheStoreModule, imported by the api of the starter).
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AppSetting])],
  providers: [SettingsService, MaintenanceGuard],
  exports: [SettingsService, MaintenanceGuard],
})
export class SettingsModule {}
