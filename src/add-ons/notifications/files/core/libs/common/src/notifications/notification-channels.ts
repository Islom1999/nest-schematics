import { Type } from '@nestjs/common';
import { NotificationChannel } from './notification-channel';

/**
 * Channels besides push. `npm run g -- notifications --channels telegram,email`
 * adds them above the marker (keep it).
 */
export const NOTIFICATION_EXTRA_CHANNELS: Type<NotificationChannel>[] = [
  // @ns:notification-channels
];
