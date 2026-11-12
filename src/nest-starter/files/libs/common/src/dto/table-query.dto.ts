import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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

  @ApiPropertyOptional({ example: 'createdAt', description: 'Column to sort; empty = default sort' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sortField?: string | null;

  @ApiPropertyOptional({ example: -1, description: '1 = ASC, anything else = DESC' })
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

  @ApiPropertyOptional({ example: 'search', description: 'Global search over the service searchFields' })
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

export class DeleteResultDto {
  @ApiProperty()
  deleted: boolean;

  @ApiProperty({ format: 'uuid' })
  id: string;
}
