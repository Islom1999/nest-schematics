import { OmitType } from '@nestjs/swagger';
import { CreateSettingDto } from './create-setting.dto';

/** Body of `PUT admin/settings/key/:key` (creates the key when missing; omitted fields stay). */
export class PutSettingDto extends OmitType(CreateSettingDto, ['key'] as const) {}
