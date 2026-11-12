import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from './snake-naming.strategy';

/**
 * Entities are picked up from each module's `TypeOrmModule.forFeature`
 * (autoLoadEntities), so every app only loads the entities it uses.
 * Migrations run through the TypeORM CLI (data-source.ts), not on boot.
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
    synchronize: config.get<string>('DB_SYNCHRONIZE') === 'true',
    logging: config.get<string>('DB_LOGGING') === 'true',
  };
}
