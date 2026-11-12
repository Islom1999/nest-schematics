import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { assertSettingKey, BaseCrudService, SettingsService, TableQueryOptions, validateSettingValue } from '@app/common';
import { AppSetting } from '@app/database';
import { CreateSettingDto } from './dto/create-setting.dto';
import { PutSettingDto } from './dto/put-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';

/**
 * Admin CRUD of `app_settings`. Every change drops the settings cache
 * (SettingsService), so the new value is used at once (on every instance
 * with the redis add-on).
 */
@Injectable()
export class SettingsAdminService extends BaseCrudService<AppSetting, CreateSettingDto, UpdateSettingDto> {
  protected override optionLabel = 'key';
  protected override notFoundMessage = 'Setting not found';
  protected override tableOptions: TableQueryOptions = {
    searchFields: ['key', 'description'],
    defaultSort: { field: 'key', order: 'ASC' },
  };

  constructor(
    @InjectRepository(AppSetting) repository: Repository<AppSetting>,
    private readonly settings: SettingsService,
  ) {
    super(repository);
  }

  protected override beforeCreate(dto: CreateSettingDto): DeepPartial<AppSetting> {
    assertSettingKey(dto.key);
    validateSettingValue(dto.key, dto.value);
    return dto as DeepPartial<AppSetting>;
  }

  protected override beforeUpdate(entity: AppSetting, dto: UpdateSettingDto): DeepPartial<AppSetting> {
    const key = dto.key ?? entity.key;
    assertSettingKey(key);
    validateSettingValue(key, dto.value !== undefined ? dto.value : entity.value);
    return dto as DeepPartial<AppSetting>;
  }

  override async create(dto: CreateSettingDto): Promise<unknown> {
    const result = await super.create(dto);
    await this.settings.invalidate();
    return result;
  }

  override async update(id: string, dto: UpdateSettingDto): Promise<unknown> {
    const result = await super.update(id, dto);
    await this.settings.invalidate();
    return result;
  }

  override async delete(id: string): Promise<{ deleted: boolean; id: string }> {
    const result = await super.delete(id);
    await this.settings.invalidate();
    return result;
  }

  override async repair(id: string): Promise<unknown> {
    const result = await super.repair(id);
    await this.settings.invalidate();
    return result;
  }

  /** `GET admin/settings/key/:key` */
  async findByKey(key: string): Promise<AppSetting> {
    const row = await this.repository.findOne({ where: { key } });
    if (!row) throw new NotFoundException(this.notFoundMessage);
    return row;
  }

  /** `PUT admin/settings/key/:key`: create or replace the value (omitted fields stay). */
  putByKey(key: string, dto: PutSettingDto): Promise<AppSetting> {
    return this.settings.set(key, dto.value, { description: dto.description, isPublic: dto.isPublic });
  }
}
