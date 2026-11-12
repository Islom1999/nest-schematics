import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, ValueTransformer } from 'typeorm';
import { BaseEntity } from '../base.entity';

/** What a file is, from its content (magic bytes), not from the client's name or MIME type. */
export enum MediaKind {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  PDF = 'pdf',
  OTHER = 'other',
}

/** Storage driver that holds the bytes (`path` is the key inside it). */
export enum MediaStorage {
  LOCAL = 'local',
  S3 = 's3',
}

/** Who uploaded the file. */
export enum MediaUploaderType {
  ADMIN = 'admin',
  USER = 'user',
}

/** bigint ↔ number: Postgres returns bigint columns as strings. */
const bigintNumber: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? value : Number(value)),
};

/**
 * One uploaded file (`npm run g -- upload`). The bytes live in a storage
 * driver (`storage` + `path`); this row is the metadata. `used` is set when a
 * record references the file (MediaFilesService.markUsed, or automatically for
 * entity relations to MediaFile) and cleared when it is replaced
 * (`release`); unused files older than UPLOAD_ORPHAN_HOURS are deleted by the
 * worker. Schema: migration `*-media-files.ts` (keep both in sync).
 */
@Entity({ name: 'media_files' })
@Index('IDX_media_files_used_created_at', ['used', 'createdAt'])
@Index('IDX_media_files_owner', ['ownerType', 'ownerId'])
export class MediaFile extends BaseEntity {
  @ApiProperty({ enum: MediaKind, enumName: 'MediaKind' })
  @Column({ type: 'varchar', length: 16 })
  kind: MediaKind;

  @ApiProperty({ type: String, example: 'general', description: 'One of MEDIA_USAGES (libs/common/src/media/media.constants.ts)' })
  @Column({ type: 'varchar', length: 64, default: 'general' })
  usage: string;

  @ApiProperty({ enum: MediaStorage, enumName: 'MediaStorage' })
  @Column({ type: 'varchar', length: 16 })
  storage: MediaStorage;

  @ApiProperty({ type: String, description: 'Key inside the storage: {kind}/{usage}/{yyyy}/{MM}/{dd}/{random}.{ext}' })
  @Column({ type: 'varchar', length: 512 })
  path: string;

  @ApiProperty({ type: String, example: 'photo.png' })
  @Column({ type: 'varchar', length: 255 })
  originalName: string;

  @ApiProperty({ type: String, example: 'image/png', description: 'Detected from the content' })
  @Column({ type: 'varchar', length: 127 })
  mime: string;

  @ApiProperty({ type: Number, description: 'Bytes' })
  @Column({ type: 'bigint', transformer: bigintNumber })
  size: number;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Pixels (images, with thumbnails enabled)' })
  @Column({ type: 'int', nullable: true })
  width: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Pixels (images, with thumbnails enabled)' })
  @Column({ type: 'int', nullable: true })
  height: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Seconds (audio/video, when known)' })
  @Column({ type: 'double precision', nullable: true })
  duration: number | null;

  @ApiProperty({ type: Boolean, description: 'Referenced by a record; unused files are cleaned up' })
  @Column({ type: 'boolean', default: false })
  used: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'product', description: 'Table or type of the record that uses the file' })
  @Column({ type: 'varchar', length: 64, nullable: true })
  ownerType: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  ownerId: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  uploadedById: string | null;

  @ApiPropertyOptional({ enum: MediaUploaderType, enumName: 'MediaUploaderType', nullable: true })
  @Column({ type: 'varchar', length: 16, nullable: true })
  uploadedByType: MediaUploaderType | null;
}
