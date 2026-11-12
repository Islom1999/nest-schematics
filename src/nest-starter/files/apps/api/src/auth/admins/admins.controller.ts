import { Body, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AdminAccess, DeleteResultDto, TableQueryDto } from '@app/common';
import { Admin } from '@app/database';
import { AdminResource } from '../admin-resource.decorator';
import { AdminPrincipal } from '../auth.types';
import { CurrentAdmin } from '../current-admin.decorator';
import { RevokedCountDto, SessionDto, SuccessDto } from '../dto/auth-response.dto';
import { paginatedSchema } from '../dto/paginated';
import { CreateAdminDto, ResetAdminPasswordDto, SetAdminBlockedDto, SetAdminRoleDto, UpdateAdminDto } from './admin.dto';
import { AdminsService } from './admins.service';

/**
 * `/api/admin/admins` — same table routes as BaseCrudController (Fuse
 * `BaseCrudService`) plus block, role, password and session management.
 */
@ApiExtraModels(Admin)
@AdminResource('admins', { read: ['admin.read'], write: ['admin.write'] })
export class AdminsController {
  constructor(private readonly service: AdminsService) {}

  @AdminAccess('read')
  @Get()
  @ApiOperation({ summary: 'All admins (unpaged)' })
  @ApiOkResponse({ type: Admin, isArray: true })
  findAll(@Query() where: Record<string, string>) {
    return this.service.findAll(where);
  }

  @AdminAccess('read')
  @HttpCode(HttpStatus.OK)
  @Post('pagination')
  @ApiOperation({ summary: 'Paged admins (PrimeNG lazy table)' })
  @ApiOkResponse({ schema: paginatedSchema(Admin) })
  findAllPagination(@Body() query: TableQueryDto) {
    return this.service.findAllPagination(query, true);
  }

  @AdminAccess('read')
  @HttpCode(HttpStatus.OK)
  @Post('pagination/archive')
  @ApiOperation({ summary: 'Paged deleted admins' })
  @ApiOkResponse({ schema: paginatedSchema(Admin) })
  findAllPaginationArchive(@Body() query: TableQueryDto) {
    return this.service.findAllPagination(query, false);
  }

  @AdminAccess('read')
  @Get('archive/:id')
  @ApiOperation({ summary: 'One deleted admin' })
  @ApiOkResponse({ type: Admin })
  findOneArchive(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id, false);
  }

  @AdminAccess('write')
  @Get('repair/:id')
  @ApiOperation({ summary: 'Restore a deleted admin' })
  @ApiOkResponse({ type: Admin })
  repair(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.repair(id);
  }

  @AdminAccess('read')
  @Get(':id')
  @ApiOperation({ summary: 'One admin' })
  @ApiOkResponse({ type: Admin })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id, true);
  }

  @AdminAccess('write')
  @Post()
  @ApiOperation({ summary: 'Create an admin' })
  @ApiOkResponse({ type: Admin })
  create(@Body() dto: CreateAdminDto, @CurrentAdmin() actor: AdminPrincipal) {
    return this.service.createAdmin(dto, actor);
  }

  @AdminAccess('write')
  @Put(':id')
  @ApiOperation({ summary: 'Update email, name or role' })
  @ApiOkResponse({ type: Admin })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdminDto, @CurrentAdmin() actor: AdminPrincipal) {
    return this.service.updateAdmin(id, dto, actor);
  }

  @AdminAccess('write')
  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete (archive) and end all sessions' })
  @ApiOkResponse({ type: DeleteResultDto })
  delete(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: AdminPrincipal) {
    return this.service.deleteAdmin(id, actor);
  }

  @AdminAccess('write')
  @Put(':id/block')
  @ApiOperation({ summary: 'Block (ends all sessions) or unblock' })
  @ApiOkResponse({ type: Admin })
  setBlocked(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAdminBlockedDto,
    @CurrentAdmin() actor: AdminPrincipal,
  ) {
    return this.service.setBlocked(id, dto.isBlocked, actor);
  }

  @AdminAccess('write')
  @Put(':id/role')
  @ApiOperation({ summary: 'Set (or clear) the role' })
  @ApiOkResponse({ type: Admin })
  setRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetAdminRoleDto, @CurrentAdmin() actor: AdminPrincipal) {
    return this.service.setRole(id, dto.roleId, actor);
  }

  @AdminAccess('write')
  @Put(':id/password')
  @ApiOperation({ summary: 'Set a new password; ends the admin\'s sessions' })
  @ApiOkResponse({ type: SuccessDto })
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetAdminPasswordDto,
    @CurrentAdmin() actor: AdminPrincipal,
  ): Promise<SuccessDto> {
    await this.service.resetPassword(id, dto.password, actor);
    return { success: true };
  }

  @AdminAccess('read')
  @Get(':id/sessions')
  @ApiOperation({ summary: 'Active sessions (devices) of an admin' })
  @ApiOkResponse({ type: SessionDto, isArray: true })
  sessions(@Param('id', ParseUUIDPipe) id: string): Promise<SessionDto[]> {
    return this.service.listSessions(id);
  }

  @AdminAccess('write')
  @Delete(':id/sessions')
  @ApiOperation({ summary: 'End every session of an admin' })
  @ApiOkResponse({ type: RevokedCountDto })
  async revokeAllSessions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() actor: AdminPrincipal,
  ): Promise<RevokedCountDto> {
    return { revoked: await this.service.revokeAllSessions(id, actor) };
  }

  @AdminAccess('write')
  @Delete(':id/sessions/:sessionId')
  @ApiOperation({ summary: 'End one session of an admin' })
  @ApiOkResponse({ type: SuccessDto })
  async revokeSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentAdmin() actor: AdminPrincipal,
  ): Promise<SuccessDto> {
    await this.service.revokeSession(id, sessionId, actor);
    return { success: true };
  }
}
