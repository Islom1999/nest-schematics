import { Body, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { AdminAccess, ApiPaginatedResponse, DeleteResultDto, OptionDto, OptionsQueryDto, TableQueryDto } from '@app/common';
import { User } from '@app/database';
import { AdminResource } from '../../auth/admin-resource.decorator';
import { RevokedCountDto, SessionDto, SuccessDto } from '../../auth/dto/auth-response.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserListQueryDto } from './dto/user-list-query.dto';
import { UsersService } from './users.service';

export class SetUserBlockedDto {
  @ApiProperty({ description: 'true blocks the user and ends all their sessions' })
  @IsBoolean()
  isBlocked: boolean;
}

/**
 * `/api/admin/users`: client accounts (read: `user.read`; create, edit, delete,
 * block and session control: `user.write`). Table routes match the CRUD ones
 * (PrimeNG lazy table).
 */
@AdminResource('users', { read: ['user.read'], write: ['user.write'] })
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @AdminAccess('read')
  @Get()
  @ApiOperation({ summary: 'Unpaged users for selects (?search=&limit=, at most 1000)' })
  @ApiOkResponse({ type: User, isArray: true })
  list(@Query() query: UserListQueryDto) {
    return this.service.list(query.search, query.limit);
  }

  @AdminAccess('write')
  @Post()
  @ApiOperation({ summary: 'Create a user (409 when the phone or email is taken)' })
  @ApiCreatedResponse({ type: User })
  create(@Body() dto: CreateUserDto) {
    return this.service.create(dto);
  }

  @AdminAccess('write')
  @Patch(':id')
  @ApiOperation({ summary: 'Edit a user (409 when the phone or email is taken)' })
  @ApiOkResponse({ type: User })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.service.update(id, dto);
  }

  @AdminAccess('write')
  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a user; ends all their sessions' })
  @ApiOkResponse({ type: DeleteResultDto })
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.delete(id);
  }

  @AdminAccess('read')
  @HttpCode(HttpStatus.OK)
  @Post('pagination')
  @ApiOperation({ summary: 'Paged users (PrimeNG lazy table)' })
  @ApiPaginatedResponse(User)
  findAllPagination(@Body() query: TableQueryDto) {
    return this.service.findAllPagination(query, true);
  }

  @AdminAccess('read')
  @Get('options')
  @ApiOperation({ summary: 'Id/label pairs for user selects (?search=&ids=&limit=&label=)' })
  @ApiOkResponse({ type: OptionDto, isArray: true })
  options(@Query() query: OptionsQueryDto) {
    return this.service.options(query);
  }

  @AdminAccess('read')
  @Get(':id')
  @ApiOperation({ summary: 'One user' })
  @ApiOkResponse({ type: User })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id, true);
  }

  @AdminAccess('write')
  @Put(':id/block')
  @ApiOperation({ summary: 'Block (ends all sessions) or unblock' })
  @ApiOkResponse({ type: User })
  setBlocked(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetUserBlockedDto) {
    return this.service.setBlocked(id, dto.isBlocked);
  }

  @AdminAccess('read')
  @Get(':id/sessions')
  @ApiOperation({ summary: 'Active sessions (devices) of a user' })
  @ApiOkResponse({ type: SessionDto, isArray: true })
  sessions(@Param('id', ParseUUIDPipe) id: string): Promise<SessionDto[]> {
    return this.service.listSessions(id);
  }

  @AdminAccess('write')
  @Delete(':id/sessions')
  @ApiOperation({ summary: 'End every session of a user' })
  @ApiOkResponse({ type: RevokedCountDto })
  async revokeAllSessions(@Param('id', ParseUUIDPipe) id: string): Promise<RevokedCountDto> {
    return { revoked: await this.service.revokeAllSessions(id) };
  }

  @AdminAccess('write')
  @Delete(':id/sessions/:sessionId')
  @ApiOperation({ summary: 'End one session of a user' })
  @ApiOkResponse({ type: SuccessDto })
  async revokeSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<SuccessDto> {
    await this.service.revokeSession(id, sessionId);
    return { success: true };
  }
}

/**
 * `/api/admin/user/options`: where `npm run g -- crud ... --fields
 * "owner:relation(User)"` points its select (CRUD routes are singular).
 */
@AdminResource('user', { read: ['user.read'], write: ['user.write'] })
export class UserOptionsController {
  constructor(private readonly service: UsersService) {}

  @AdminAccess('read')
  @Get('options')
  @ApiOperation({ summary: 'Id/label pairs for user selects (?search=&ids=&limit=&label=)' })
  @ApiOkResponse({ type: OptionDto, isArray: true })
  options(@Query() query: OptionsQueryDto) {
    return this.service.options(query);
  }
}
