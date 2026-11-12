import { Body, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AdminAccess, ApiPaginatedResponse, BaseCrudController } from '@app/common';
import { AppSetting } from '@app/database';
import { AdminResource } from '../../auth';
import { CreateSettingDto } from './dto/create-setting.dto';
import { PutSettingDto } from './dto/put-setting.dto';
import { QuerySettingDto } from './dto/query-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { SettingsAdminService } from './settings-admin.service';

/**
 * `/api/admin/settings` — routes in BaseCrudController (by id) plus
 * `GET|PUT key/:key` (by key). Permissions `setting.read` / `setting.write`.
 * Maintenance mode: `PUT key/maintenance` with `{ "value": { "enabled": true, "message": "..." } }`.
 */
@AdminResource('settings', {
  read: ['setting.read'],
  write: ['setting.write'],
})
export class SettingsAdminController extends BaseCrudController({
  entity: AppSetting,
  createDto: CreateSettingDto,
  updateDto: UpdateSettingDto,
}) {
  constructor(private readonly settingsAdmin: SettingsAdminService) {
    super(settingsAdmin);
  }

  // Typed body for Swagger; same behaviour as the base route.
  @AdminAccess('read')
  @HttpCode(HttpStatus.OK)
  @Post('pagination')
  @ApiPaginatedResponse(AppSetting)
  override findAllPagination(@Body() query: QuerySettingDto) {
    return super.findAllPagination(query);
  }

  @AdminAccess('read')
  @HttpCode(HttpStatus.OK)
  @Post('pagination/archive')
  @ApiPaginatedResponse(AppSetting)
  override findAllPaginationArchive(@Body() query: QuerySettingDto) {
    return super.findAllPaginationArchive(query);
  }

  @AdminAccess('read')
  @Get('key/:key')
  @ApiOperation({ summary: 'One setting by key' })
  @ApiOkResponse({ type: AppSetting })
  findByKey(@Param('key') key: string): Promise<AppSetting> {
    return this.settingsAdmin.findByKey(key);
  }

  @AdminAccess('write')
  @Put('key/:key')
  @ApiOperation({ summary: 'Create or replace a setting by key (omitted fields keep their value)' })
  @ApiOkResponse({ type: AppSetting })
  putByKey(@Param('key') key: string, @Body() dto: PutSettingDto): Promise<AppSetting> {
    return this.settingsAdmin.putByKey(key, dto);
  }
}
