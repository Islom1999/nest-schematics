import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiLog } from '@app/database';
import { AiAdminController } from './ai-admin.controller';
import { AiAdminService } from './ai-admin.service';

/** Admin routes over ai_logs (`npm run g -- ai`). AiService itself comes from the global AiModule. */
@Module({
  imports: [TypeOrmModule.forFeature([AiLog])],
  controllers: [AiAdminController],
  providers: [AiAdminService],
})
export class AiAdminModule {}
