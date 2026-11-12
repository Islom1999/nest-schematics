import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { isSwaggerExport } from '@app/common/swagger/export-mode';
import { migrations } from './migrations';
import { SnakeNamingStrategy } from './snake-naming.strategy';

const isTrue = (value: string | undefined) => ['true', '1'].includes((value ?? '').trim());

/**
 * Entities are picked up from each module's `TypeOrmModule.forFeature`
 * (autoLoadEntities), so every app only loads the entities it uses.
 * The schema is managed by migrations (`migrations/index.ts`); they run on boot
 * unless DB_MIGRATIONS_RUN=false (see database.module.ts). DB_SYNCHRONIZE is
 * for throwaway local databases only and is refused in production.
 * Properties stay camelCase in code/JSON; columns are snake_case in the DB.
 */
export function createTypeOrmOptions(config: ConfigService): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: config.get<string>('DB_HOST', 'localhost'),
    port: Number(config.get('DB_PORT', 5432)),
    username: config.get<string>('DB_USERNAME', 'postgres'),
    password: config.get<string>('DB_PASSWORD', 'postgres'),
    database: config.get<string>('DB_DATABASE'),
    autoLoadEntities: true,
    namingStrategy: new SnakeNamingStrategy(),
    migrations,
    synchronize: isTrue(config.get<string>('DB_SYNCHRONIZE')),
    logging: isTrue(config.get<string>('DB_LOGGING')),
    // `npm run swagger:export` builds the docs without a database.
    manualInitialization: isSwaggerExport(),
  };
}

/** DB_MIGRATIONS_RUN, default true. */
export function shouldRunMigrations(config: ConfigService): boolean {
  const value = config.get<string>('DB_MIGRATIONS_RUN');
  return value === undefined || value.trim() === '' || isTrue(value);
}
