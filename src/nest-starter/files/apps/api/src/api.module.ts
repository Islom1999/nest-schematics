import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '@app/common';
import { DatabaseModule } from '@app/database';
import { ApiController } from './api.controller';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    AuthModule,
  ],
  controllers: [ApiController],
})
export class ApiModule {}
