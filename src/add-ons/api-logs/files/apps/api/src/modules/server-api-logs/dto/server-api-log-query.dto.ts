import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { TableFilterRule, TableQueryDto } from '@app/common';
import { ServerApiLogType } from '@app/database';

/** Most rows one CSV export returns (`limit` is capped to this). */
export const EXPORT_MAX_ROWS = 20_000;
export const EXPORT_DEFAULT_ROWS = 5_000;

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

/**
 * Body of `POST admin/server-api-logs/pagination`: the usual table query
 * (`filters`, `globalFilter`, sort, paging) plus typed shortcut filters.
 * Every shortcut is AND-ed with `filters`; an empty value is ignored.
 */
export class ServerApiLogQueryDto extends TableQueryDto {
  @ApiPropertyOptional({ enum: ServerApiLogType, enumName: 'ServerApiLogType' })
  @IsOptional()
  @IsEnum(ServerApiLogType)
  type?: ServerApiLogType;

  @ApiPropertyOptional({ type: String, example: 'POST', description: 'HTTP method (equals)' })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @MaxLength(10)
  method?: string;

  @ApiPropertyOptional({ type: Number, example: 500, description: 'HTTP status code (equals)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(599)
  statusCode?: number;

  @ApiPropertyOptional({ type: String, example: '/api/admin/product', description: 'Part of the path (case-insensitive)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  path?: string;

  @ApiPropertyOptional({ type: String, description: 'User id from the token (equals)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'createdAt from (inclusive)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'createdAt up to (inclusive)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ type: Number, minimum: 0, description: 'durationMs at least' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minDurationMs?: number;

  @ApiPropertyOptional({ type: Number, minimum: 0, description: 'durationMs at most' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxDurationMs?: number;
}

/** Query of `GET admin/server-api-logs/export`: the same filters as the pagination body, as query parameters. */
export class ServerApiLogExportQueryDto extends ServerApiLogQueryDto {
  @ApiPropertyOptional({
    type: String,
    example: '{"statusCode":{"value":500,"matchMode":"gte"}}',
    description: 'The `filters` of the table query, as JSON (or as `filters[field][value]=...&filters[field][matchMode]=...`)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value; // a string is not an object: @IsObject answers 400
    }
  })
  override filters?: Record<string, TableFilterRule | TableFilterRule[]> = undefined;

  @ApiPropertyOptional({
    type: Number,
    default: EXPORT_DEFAULT_ROWS,
    minimum: 1,
    maximum: EXPORT_MAX_ROWS,
    description: 'Most rows to export, newest first',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EXPORT_MAX_ROWS)
  limit?: number;
}
