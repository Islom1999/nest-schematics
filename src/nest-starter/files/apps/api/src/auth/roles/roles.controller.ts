import { Body, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AdminAccess, DeleteResultDto, TableQueryDto } from '@app/common';
import { AdminRole } from '@app/database';
import { AdminResource } from '../admin-resource.decorator';
import { AdminPrincipal } from '../auth.types';
import { CurrentAdmin } from '../current-admin.decorator';
import { paginatedSchema } from '../dto/paginated';
import { CreateRoleDto, UpdateRoleDto } from './role.dto';
import { RolesService } from './roles.service';

/** `/api/admin/roles` — same table routes as BaseCrudController. */
@ApiExtraModels(AdminRole)
@AdminResource('roles', { read: ['role.read'], write: ['role.write'] })
export class RolesController {
  constructor(private readonly service: RolesService) {}

  @AdminAccess('read')
  @Get()
  @ApiOperation({ summary: 'All roles (unpaged)' })
  @ApiOkResponse({ type: AdminRole, isArray: true })
  findAll(@Query() where: Record<string, string>) {
    return this.service.findAll(where);
  }

  @AdminAccess('read')
  @HttpCode(HttpStatus.OK)
  @Post('pagination')
  @ApiOperation({ summary: 'Paged roles (PrimeNG lazy table)' })
  @ApiOkResponse({ schema: paginatedSchema(AdminRole) })
  findAllPagination(@Body() query: TableQueryDto) {
    return this.service.findAllPagination(query, true);
  }

  @AdminAccess('read')
  @HttpCode(HttpStatus.OK)
  @Post('pagination/archive')
  @ApiOperation({ summary: 'Paged deleted roles' })
  @ApiOkResponse({ schema: paginatedSchema(AdminRole) })
  findAllPaginationArchive(@Body() query: TableQueryDto) {
    return this.service.findAllPagination(query, false);
  }

  @AdminAccess('read')
  @Get('archive/:id')
  @ApiOperation({ summary: 'One deleted role' })
  @ApiOkResponse({ type: AdminRole })
  findOneArchive(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id, false);
  }

  @AdminAccess('write')
  @Get('repair/:id')
  @ApiOperation({ summary: 'Restore a deleted role' })
  @ApiOkResponse({ type: AdminRole })
  repair(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.repair(id);
  }

  @AdminAccess('read')
  @Get(':id')
  @ApiOperation({ summary: 'One role' })
  @ApiOkResponse({ type: AdminRole })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id, true);
  }

  @AdminAccess('write')
  @Post()
  @ApiOperation({ summary: 'Create a role' })
  @ApiOkResponse({ type: AdminRole })
  create(@Body() dto: CreateRoleDto, @CurrentAdmin() actor: AdminPrincipal) {
    return this.service.createRole(dto, actor);
  }

  @AdminAccess('write')
  @Put(':id')
  @ApiOperation({ summary: 'Update a role (applies to signed-in admins at once)' })
  @ApiOkResponse({ type: AdminRole })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto, @CurrentAdmin() actor: AdminPrincipal) {
    return this.service.updateRole(id, dto, actor);
  }

  @AdminAccess('write')
  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete (refused while admins have the role)' })
  @ApiOkResponse({ type: DeleteResultDto })
  delete(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: AdminPrincipal) {
    return this.service.deleteRole(id, actor);
  }
}
