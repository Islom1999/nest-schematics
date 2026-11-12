import { applyDecorators, Controller, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ADMIN_RESOURCE_KEY, AdminResourcePermissions } from '@app/common';
import { AdminGuard } from './admin.guard';

/**
 * Marks an admin CRUD controller: `admin/<path>` route prefix, AdminGuard,
 * Swagger tag + bearer auth, and the permission keys for the generic
 * read/write routes of BaseCrudController.
 *
 *   @AdminResource('product', { read: ['product.read'], write: ['product.write'] })
 */
export function AdminResource(path: string, permissions: AdminResourcePermissions = {}) {
  return applyDecorators(
    Controller(`admin/${path}`),
    UseGuards(AdminGuard),
    SetMetadata(ADMIN_RESOURCE_KEY, permissions),
    ApiTags(`admin/${path}`),
    ApiBearerAuth(),
  );
}
