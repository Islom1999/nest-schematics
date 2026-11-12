import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../auth/admin.guard';
import { AdminPrincipal } from '../auth/auth.types';
import { CurrentAdmin } from '../auth/current-admin.decorator';
import { SearchDto, SearchResultSetDto } from './search.dto';
import { SearchService } from './search.service';

/** `POST /api/search`: one box over every area the admin may read. */
@ApiTags('search')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @HttpCode(HttpStatus.OK)
  @Post()
  @ApiOperation({ summary: 'Global search, grouped by area; areas the admin has no permission for are left out' })
  @ApiOkResponse({ type: SearchResultSetDto, isArray: true })
  find(@CurrentAdmin() admin: AdminPrincipal, @Body() dto: SearchDto): Promise<SearchResultSetDto[]> {
    return this.search.search(admin.permissions, dto.query);
  }
}
