import { Module } from '@nestjs/common';
import { NavigationController } from './navigation.controller';
import { NavigationService } from './navigation.service';

/** Admin sidebar menu (`GET navigation`), filtered by permission. Entries: `navigation.registry.ts`. */
@Module({
  controllers: [NavigationController],
  providers: [NavigationService],
})
export class NavigationModule {}
