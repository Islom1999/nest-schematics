import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CacheStoreModule, createThrottlerOptions, SHARED_THROTTLER_STORAGE, validateEnv } from '@app/common';
import { DatabaseModule } from '@app/database';
import { AdminNotificationsModule } from './admin-notifications/admin-notifications.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { NavigationModule } from './navigation/navigation.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, { token: SHARED_THROTTLER_STORAGE, optional: true }],
      useFactory: createThrottlerOptions,
    }),
    CacheStoreModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    AdminNotificationsModule,
    NavigationModule,
    SearchModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class ApiModule {}
