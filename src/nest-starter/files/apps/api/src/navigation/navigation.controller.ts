import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../auth/admin.guard';
import { AdminPrincipal } from '../auth/auth.types';
import { CurrentAdmin } from '../auth/current-admin.decorator';
import { NavigationDto } from './navigation.dto';
import { NavigationService } from './navigation.service';

/** `GET /api/navigation`: the sidebar of the signed-in admin. */
@ApiTags('navigation')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('navigation')
export class NavigationController {
  constructor(private readonly navigation: NavigationService) {}

  @Get()
  @ApiOperation({ summary: 'Sidebar menu, only the entries the admin has the permission for' })
  @ApiOkResponse({ type: NavigationDto })
  get(@CurrentAdmin() admin: AdminPrincipal): NavigationDto {
    return this.navigation.get(admin.permissions);
  }
}
