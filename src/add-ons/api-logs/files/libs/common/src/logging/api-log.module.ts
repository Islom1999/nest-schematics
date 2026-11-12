import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServerApiLog } from '@app/database';
import { ApiLogService } from './api-log.service';

/**
 * ApiLogService for any app (api, worker). Global, so feature modules can
 * inject it (`logCron`, `write`) without importing this module again.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ServerApiLog])],
  providers: [ApiLogService],
  exports: [ApiLogService],
})
export class ApiLogModule {}
