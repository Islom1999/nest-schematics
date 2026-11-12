import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
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

/** FCM topic names: letters, digits and - _ . ~ % (1..100). */
export const TOPIC_RE = /^[A-Za-z0-9_.~%-]{1,100}$/;

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
  @ApiProperty({
    ...apiEnum(NotificationTarget, 'NotificationTarget'),
    description: 'all, users (userIds), platform (platform) or topic (topic: the users subscribed to it)',
  })
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

  @ApiPropertyOptional({ type: String, example: 'news', description: 'Required for target topic: letters, digits and - _ . ~ % (max 100)' })
  @ValidateIf((dto: BroadcastNotificationDto) => dto.target === NotificationTarget.TOPIC)
  @Matches(TOPIC_RE)
  topic?: string;

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

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-12-01T09:00:00Z',
    description:
      'Send later, at this time (must be in the future). The campaign has status scheduled until then; it needs the queue add-on (delayed job) ' +
      'or the worker (cron, every minute, push only). Cancel it with DELETE campaigns/:id',
  })
  @IsOptional()
  @IsDateString()
  sendAt?: string;
}

/** `GET client/notifications/topics` and `PUT client/notifications/topics/:topic`: one subscription. */
export class NotificationTopicDto {
  @ApiProperty({ type: String, example: 'news' })
  topic: string;

  @ApiProperty({ type: String, format: 'date-time' })
  subscribedAt: Date;
}

/** One push device (a live session with a push token) of a user, for support. */
export class PushDeviceDto {
  @ApiProperty({ type: String, format: 'uuid', description: 'The session the token belongs to' })
  sessionId: string;

  @ApiProperty({ type: String, example: 'fcm123…9xyz', description: 'First 6 and last 4 characters only; the full token is never returned' })
  tokenMasked: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'android', description: 'ios, android or web' })
  platform: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Pixel 8' })
  deviceName: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2.4.1' })
  appVersion: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'When the session was last used' })
  lastSeenAt: Date | null;
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
