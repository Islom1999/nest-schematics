import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';
import { createTypeOrmOptions, shouldRunMigrations } from './database.config';
import { runPendingMigrations } from './run-migrations';

/**
 * PostgreSQL connection for any app (api, bot, worker). Needs a global
 * ConfigModule in the app. Entities come from each module's
 * `TypeOrmModule.forFeature([...])`.
 *
 * Pending migrations run before the app starts (DB_MIGRATIONS_RUN, default
 * true), under an advisory lock so concurrent instances do not collide.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => ({
        ...createTypeOrmOptions(config),
        migrationsRun: shouldRunMigrations(config),
      }),
      dataSourceFactory: async (options) => {
        const { migrationsRun, ...rest } = options as DataSourceOptions;
        const dataSource = new DataSource({ ...rest, migrationsRun: false });
        // `npm run swagger:export` (manualInitialization) never connects.
        if ((options as TypeOrmModuleOptions).manualInitialization) return dataSource;
        await dataSource.initialize();
        if (migrationsRun) await runPendingMigrations(dataSource);
        return dataSource;
      },
    }),
  ],
})
export class DatabaseModule {}
