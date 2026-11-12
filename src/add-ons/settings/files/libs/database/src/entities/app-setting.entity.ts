import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

/** OpenAPI schema of a setting value: any JSON. */
export const SETTING_VALUE_SCHEMA = {
  oneOf: [
    { type: 'object', additionalProperties: true },
    { type: 'array', items: {} },
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
  ],
  nullable: true,
  description: 'Any JSON value (object, array, string, number, boolean)',
};

/**
 * One runtime setting (`npm run g -- settings`): a unique key with a JSON
 * value, read through SettingsService (short cache). `isPublic` rows are
 * served without auth at `GET /api/settings/public`.
 * Built in: `maintenance` = `{ enabled: boolean, message: string }`.
 * Schema: migration `*-app-settings.ts` (keep both in sync).
 */
@Entity({ name: 'app_settings' })
export class AppSetting extends BaseEntity {
  @ApiProperty({ type: String, maxLength: 100, example: 'maintenance' })
  @Index('UQ_app_settings_key', { unique: true, where: '"deleted_at" IS NULL' })
  @Column({ type: 'varchar', length: 100 })
  key: string;

  @ApiPropertyOptional({ ...SETTING_VALUE_SCHEMA, example: { enabled: false, message: '' } })
  @Column({ type: 'jsonb', nullable: true })
  value: unknown;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 255 })
  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @ApiProperty({ type: Boolean, default: false, description: 'Served by GET /api/settings/public' })
  @Column({ type: 'boolean', default: false })
  isPublic: boolean;
}
