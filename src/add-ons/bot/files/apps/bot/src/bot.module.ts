import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '@app/common';
import { DatabaseModule } from '@app/database';
import { BotService } from './bot.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    // TypeOrmModule.forFeature([SomeEntity]) for the entities the bot uses
  ],
  providers: [BotService],
})
export class BotModule {}
