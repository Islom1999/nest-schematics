import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

/**
 * The object the Telegram Login Widget passes to `data-onauth` (or the query
 * of `data-auth-url`), posted as is (field names are Telegram's). Numbers may
 * arrive as strings.
 */
export class TelegramWidgetDto {
  @ApiProperty({ example: 123456789 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  first_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  last_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  username?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  photo_url?: string;

  @ApiProperty({ example: 1700000000, description: 'Unix time of the Telegram sign-in' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  auth_date: number;

  @ApiProperty({ description: 'HMAC-SHA256 (hex) of the other fields' })
  @Matches(/^[0-9a-f]{64}$/)
  hash: string;
}

/** `Telegram.WebApp.initData` of a Mini App, the raw query string. */
export class TelegramWebAppDto {
  @ApiProperty({ example: 'query_id=...&user=%7B%22id%22...&auth_date=1700000000&hash=...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  initData: string;
}
