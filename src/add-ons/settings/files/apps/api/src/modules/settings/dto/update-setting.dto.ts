import { PartialType } from '@nestjs/swagger';
import { CreateSettingDto } from './create-setting.dto';

/** Every create field, all optional (validation rules kept). */
export class UpdateSettingDto extends PartialType(CreateSettingDto) {}
