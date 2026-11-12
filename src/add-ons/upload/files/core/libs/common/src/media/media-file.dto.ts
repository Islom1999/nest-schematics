import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaKind, MediaStorage, MediaUploaderType } from '@app/database';

/** A media file as the API returns it (no storage path). */
export class MediaFileDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: MediaKind, enumName: 'MediaKind' })
  kind: MediaKind;

  @ApiProperty({ type: String, example: 'general' })
  usage: string;

  @ApiProperty({ enum: MediaStorage, enumName: 'MediaStorage' })
  storage: MediaStorage;

  @ApiProperty({ type: String, example: 'photo.png' })
  originalName: string;

  @ApiProperty({ type: String, example: 'image/png' })
  mime: string;

  @ApiProperty({ type: Number, description: 'Bytes' })
  size: number;

  @ApiPropertyOptional({ type: Number, nullable: true })
  width: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  height: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Seconds' })
  duration: number | null;

  @ApiProperty({ type: Boolean })
  used: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  ownerType: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  ownerId: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  uploadedById: string | null;

  @ApiPropertyOptional({ enum: MediaUploaderType, enumName: 'MediaUploaderType', nullable: true })
  uploadedByType: MediaUploaderType | null;

  @ApiProperty({ type: String, example: '/api/files/3f0c...', description: 'Where to download the file' })
  url: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Small webp for images (falls back to the image)' })
  thumbnailUrl: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}
