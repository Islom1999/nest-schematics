import { Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { PERMISSION_CATALOG, RequirePermissions } from '@app/common';
import { AdminResource } from '../admin-resource.decorator';
import { PermissionGroupDto } from './role.dto';

/** `/api/admin/permissions` — the catalog the role editor offers. */
@AdminResource('permissions')
export class PermissionsController {
  @RequirePermissions('role.read')
  @Get()
  @ApiOperation({ summary: 'Permission catalog: resources and their actions (`<resource>.<action>`)' })
  @ApiOkResponse({ type: PermissionGroupDto, isArray: true })
  catalog(): PermissionGroupDto[] {
    return PERMISSION_CATALOG;
  }
}
