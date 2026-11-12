import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow, IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { SETTING_VALUE_SCHEMA } from '@app/database';

export class CreateSettingDto {
  @ApiProperty({ type: String, maxLength: 100, example: 'support_phone', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, { message: 'key may contain letters, digits, ".", "_" and "-"' })
  key: string;

  /** Any JSON; `maintenance` must be `{ enabled: boolean, message?: string }`. */
  @ApiPropertyOptional(SETTING_VALUE_SCHEMA)
  @Allow()
  value?: unknown;

  @ApiPropertyOptional({ type: String, maxLength: 255, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;

  @ApiPropertyOptional({ type: Boolean, default: false, description: 'Served by GET /api/settings/public' })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
