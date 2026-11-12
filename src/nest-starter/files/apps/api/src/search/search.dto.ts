import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { SEARCH_QUERY_MAX } from './search.types';

export class SearchDto {
  @ApiProperty({ example: 'john', maxLength: SEARCH_QUERY_MAX })
  @IsString()
  @MaxLength(SEARCH_QUERY_MAX)
  query: string;
}

export class SearchResultDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: '/admins/3f2a...' })
  link: string;

  @ApiProperty({ description: 'Text for the search box when the hit is picked' })
  value: string;

  @ApiPropertyOptional()
  title?: string;
}

export class SearchResultSetDto {
  @ApiProperty({ example: 'admins' })
  id: string;

  @ApiProperty({ example: 'Admins' })
  label: string;

  @ApiProperty({ type: [SearchResultDto] })
  results: SearchResultDto[];
}
