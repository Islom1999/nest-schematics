import { NotificationPayload } from './notification.types';

/**
 * A delivery channel besides push (telegram, email). NotificationService calls
 * every channel of NOTIFICATION_CHANNELS after the rows are saved; a channel
 * picks the users it can reach (telegramId, email) and must not throw for one
 * failed recipient.
 */
export interface NotificationChannel {
  readonly name: string;
  deliver(userIds: string[], payload: NotificationPayload): Promise<void>;
}

/** Injection token: `NotificationChannel[]`. */
export const NOTIFICATION_CHANNELS = Symbol('NOTIFICATION_CHANNELS');

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Absolute http(s) links only: a relative app path means nothing outside the app. */
export function absoluteLink(link: string | null | undefined): string | null {
  return link && /^https?:\/\//i.test(link) ? link : null;
}
