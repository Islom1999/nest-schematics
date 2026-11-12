import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ServerApiLogType } from '@app/database';

export class ServerApiLogStatsQueryDto {
  @ApiPropertyOptional({ type: Number, example: 24, description: 'Window in hours (1..720)', default: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  hours?: number;
}

export class ServerApiLogTypeCountDto {
  @ApiProperty({ enum: ServerApiLogType, enumName: 'ServerApiLogType' })
  type: string;

  @ApiProperty({ type: Number })
  count: number;
}

export class ServerApiLogStatusCountDto {
  @ApiPropertyOptional({ type: Number, nullable: true })
  statusCode: number | null;

  @ApiProperty({ type: Number })
  count: number;
}

export class ServerApiLogStatsDto {
  @ApiProperty({ type: String, format: 'date-time' })
  since: string;

  @ApiProperty({ type: Number })
  total: number;

  @ApiProperty({ type: Number, description: 'Rows with status >= 500' })
  serverErrors: number;

  @ApiProperty({ type: Number, description: 'Rows with status 400..499' })
  clientErrors: number;

  @ApiPropertyOptional({ type: Number, nullable: true })
  avgDurationMs: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  maxDurationMs: number | null;

  @ApiProperty({ type: ServerApiLogTypeCountDto, isArray: true })
  byType: ServerApiLogTypeCountDto[];

  @ApiProperty({ type: ServerApiLogStatusCountDto, isArray: true })
  byStatus: ServerApiLogStatusCountDto[];
}
