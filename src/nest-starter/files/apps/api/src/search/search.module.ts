import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Admin, AdminRole } from '@app/database';
import { AdminsSearchProvider } from './providers/admins-search.provider';
import { RolesSearchProvider } from './providers/roles-search.provider';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/** Global admin search (`POST search`). Add-ons register providers at the marker below. */
@Module({
  imports: [TypeOrmModule.forFeature([Admin, AdminRole])],
  controllers: [SearchController],
  providers: [
    SearchService,
    AdminsSearchProvider,
    RolesSearchProvider,
    // @ns:search-providers
  ],
})
export class SearchModule {}
