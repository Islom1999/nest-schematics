import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** The `AppNotification` of the admin UI bell. */
export class AdminNotificationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  description: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'heroicons_mini:star' })
  icon: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Router link of the admin app' })
  link: string | null;

  @ApiProperty({ type: String, format: 'date-time', description: 'When the notification was created' })
  time: Date;

  @ApiProperty()
  read: boolean;
}
