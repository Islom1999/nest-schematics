import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createTypeOrmOptions } from './database.config';

/**
 * PostgreSQL connection for any app (api, bot, worker). Needs a global
 * ConfigModule in the app. Entities come from each module's
 * `TypeOrmModule.forFeature([...])`.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createTypeOrmOptions,
    }),
  ],
})
export class DatabaseModule {}
