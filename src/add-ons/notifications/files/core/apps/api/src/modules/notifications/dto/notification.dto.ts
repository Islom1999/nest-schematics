import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { apiEnum, TableQueryDto } from '@app/common';
import { NotificationCampaign, NotificationTarget } from '@app/database';
import { PushPlatform } from '../../../client-auth/dto/client-auth.dto';

const toBoolean = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** `GET client/notifications` query. */
export class NotificationListQueryDto {
  @ApiPropertyOptional({ type: Number, example: 0, description: 'Offset (first row index)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  first?: number;

  @ApiPropertyOptional({ type: Number, example: 20, description: 'Rows per page (1..100), default 20' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  rows?: number;

  @ApiPropertyOptional({ type: Boolean, description: 'Only unread notifications' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unread?: boolean;
}

export class UnreadCountDto {
  @ApiProperty({ type: Number, example: 3 })
  count: number;
}

export class MarkedReadDto {
  @ApiProperty({ type: Number, example: 3, description: 'Notifications marked read by this call' })
  updated: number;
}

/** `POST admin/notifications/pagination`: the table query plus a user filter. */
export class NotificationTableQueryDto extends TableQueryDto {
  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'Only this user' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

/** `POST admin/notifications/broadcast`. */
export class BroadcastNotificationDto {
  @ApiProperty({ ...apiEnum(NotificationTarget, 'NotificationTarget'), description: 'all, users (userIds) or platform (platform)' })
  @IsEnum(NotificationTarget)
  target: NotificationTarget;

  @ApiPropertyOptional({ type: String, format: 'uuid', isArray: true, description: 'Required for target users (max 1000)' })
  @ValidateIf((dto: BroadcastNotificationDto) => dto.target === NotificationTarget.USERS)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsUUID(undefined, { each: true })
  userIds?: string[];

  @ApiPropertyOptional({ ...apiEnum(PushPlatform, 'PushPlatform'), description: 'Required for target platform' })
  @ValidateIf((dto: BroadcastNotificationDto) => dto.target === NotificationTarget.PLATFORM)
  @IsEnum(PushPlatform)
  platform?: PushPlatform;

  @ApiPropertyOptional({ type: String, example: 'promo', description: 'Default general' })
  @IsOptional()
  @Matches(/^[A-Za-z0-9_.-]{1,50}$/)
  type?: string;

  @ApiProperty({ type: String, example: 'Spring sale' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ type: String, example: 'Everything is 20% off until Sunday.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  @ApiPropertyOptional({ type: String, example: '/sale', description: 'Where the app opens on tap (path or URL)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  link?: string;

  @ApiPropertyOptional({ type: String, example: 'https://cdn.example.com/sale.png' })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(1000)
  image?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'Extra data for the app' })
  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}

/** Live counts of a campaign's notifications. */
export class NotificationCampaignStatsDto {
  @ApiProperty({ type: Number })
  total: number;

  @ApiProperty({ type: Number })
  read: number;

  @ApiProperty({ type: Number })
  pushPending: number;

  @ApiProperty({ type: Number })
  pushSent: number;

  @ApiProperty({ type: Number })
  pushFailed: number;

  @ApiProperty({ type: Number })
  pushSkipped: number;
}

export class NotificationCampaignDetailDto {
  @ApiProperty({ type: NotificationCampaign })
  campaign: NotificationCampaign;

  @ApiProperty({ type: NotificationCampaignStatsDto })
  stats: NotificationCampaignStatsDto;
}
