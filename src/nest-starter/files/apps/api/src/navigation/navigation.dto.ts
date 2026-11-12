import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { apiEnum } from '@app/common';

export enum NavigationItemType {
  Basic = 'basic',
  Collapsable = 'collapsable',
}

export class NavigationItemDto {
  @ApiProperty({ example: 'admins' })
  id: string;

  @ApiProperty({ example: 'Admins' })
  title: string;

  @ApiProperty({ ...apiEnum(NavigationItemType, 'NavigationItemType') })
  type: NavigationItemType;

  @ApiProperty({ example: 'heroicons_outline:users' })
  icon: string;

  @ApiProperty({ example: '/admins' })
  link: string;

  @ApiPropertyOptional({ type: () => [NavigationItemDto] })
  children?: NavigationItemDto[];
}

/** The four layout variants of the admin UI; every one holds the same entries. */
export class NavigationDto {
  @ApiProperty({ type: [NavigationItemDto] })
  default: NavigationItemDto[];

  @ApiProperty({ type: [NavigationItemDto] })
  compact: NavigationItemDto[];

  @ApiProperty({ type: [NavigationItemDto] })
  futuristic: NavigationItemDto[];

  @ApiProperty({ type: [NavigationItemDto] })
  horizontal: NavigationItemDto[];
}
