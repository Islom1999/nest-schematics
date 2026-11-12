import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const MATCH_MODES = [
  'startsWith',
  'contains',
  'notContains',
  'endsWith',
  'equals',
  'notEquals',
  'in',
  'lt',
  'lte',
  'gt',
  'gte',
  'between',
  'dateIs',
  'dateIsNot',
  'dateBefore',
  'dateAfter',
] as const;

export type MatchMode = (typeof MATCH_MODES)[number];

/** One PrimeNG filter rule; `operator` comes with menu-style column filters. */
export interface TableFilterRule {
  value: unknown;
  matchMode?: MatchMode;
  operator?: 'and' | 'or';
}

/**
 * Body of `POST admin/<resource>/pagination[/archive]` — the same
 * `TableQueryDTO` the Angular `BaseCrudService.getAllPagination()` sends.
 */
export class TableQueryDto {
  @ApiPropertyOptional({ example: 0, description: 'Offset (first row index)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  first?: number;

  @ApiPropertyOptional({ example: 10, description: 'Rows per page (1..100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  rows?: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'createdAt',
    description: 'Column to sort; empty = default sort',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sortField?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: -1,
    description: '1 = ASC, anything else = DESC',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { name: { value: 'abc', matchMode: 'contains' } },
    description:
      'PrimeNG filters: { field: { value, matchMode } } or { field: [{ value, matchMode, operator }] }. ' +
      `matchMode: ${MATCH_MODES.join(', ')}. Joined relations: "category.name".`,
  })
  @IsOptional()
  @IsObject()
  filters?: Record<string, TableFilterRule | TableFilterRule[]>;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'search',
    description: 'Global search over the service searchFields',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  globalFilter?: string | null;
}

/** Response of the pagination endpoints — Angular `IPagination<T>`. */
export interface PaginatedResult<T> {
  count: number;
  data: T[];
}

/**
 * Query of `GET admin/<resource>/options` — id/label pairs for relation
 * selects (fuse-schematics p-select / p-multiselect, see `x-relation`).
 */
export class OptionsQueryDto {
  @ApiPropertyOptional({ type: String, description: 'Case-insensitive search in the label' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    isArray: true,
    description: 'Only these ids (comma-separated or repeated), e.g. to show the selected values of a form',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  ids?: string[];

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ type: String, description: 'Label column; default: the resource label field (name, title or id)' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z_][A-Za-z0-9_]*$/)
  label?: string;
}

/** One `GET options` row. */
export class OptionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String })
  label: string;
}

export class DeleteResultDto {
  @ApiProperty()
  deleted: boolean;

  @ApiProperty({ format: 'uuid' })
  id: string;
}
