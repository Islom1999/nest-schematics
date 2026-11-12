import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServerApiLog } from '@app/database';
import { ServerApiLogsController } from './server-api-logs.controller';
import { ServerApiLogsService } from './server-api-logs.service';

@Module({
  imports: [TypeOrmModule.forFeature([ServerApiLog])],
  controllers: [ServerApiLogsController],
  providers: [ServerApiLogsService],
})
export class ServerApiLogsModule {}
