import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MEDIA_USAGES } from '@app/common/media';
import { MediaKind } from '@app/database';

const toBoolean = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

/** Multipart body of the upload routes (field `files`, one or more). */
export class UploadFilesDto {
  @ApiProperty({ type: 'array', items: { type: 'string', format: 'binary' }, description: 'One or more files' })
  files: unknown[];
}

export class UploadQueryDto {
  @ApiPropertyOptional({ enum: [...MEDIA_USAGES], enumName: 'MediaUsage', default: 'general' })
  @IsOptional()
  @IsIn([...MEDIA_USAGES])
  usage?: string;
}

/** `GET admin/files` filters. */
export class MediaFileQueryDto {
  @ApiPropertyOptional({ example: 0, description: 'Offset (first row index)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  first?: number;

  @ApiPropertyOptional({ example: 20, description: 'Rows per page (1..100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  rows?: number;

  @ApiPropertyOptional({ enum: MediaKind, enumName: 'MediaKind' })
  @IsOptional()
  @IsEnum(MediaKind)
  kind?: MediaKind;

  @ApiPropertyOptional({ enum: [...MEDIA_USAGES], enumName: 'MediaUsage' })
  @IsOptional()
  @IsIn([...MEDIA_USAGES])
  usage?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  used?: boolean;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ownerType?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ownerId?: string;

  @ApiPropertyOptional({ type: String, description: 'Part of the original file name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class DeleteMediaFileQueryDto {
  @ApiPropertyOptional({ type: Boolean, description: 'Delete even when the file is marked used' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  force?: boolean;
}
