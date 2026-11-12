/** What a notification says. Saved on every recipient's `notifications` row. */
export interface NotificationPayload {
  /** Free-form kind the app can switch on. Default `general`. */
  type?: string;
  title: string;
  body?: string;
  /** Where the app opens on tap (a path or a URL). */
  link?: string | null;
  /** Image URL; shown in the push when it is http(s). */
  image?: string | null;
  /** Extra data for the app (stored as jsonb, not sent in the push). */
  meta?: Record<string, unknown> | null;
}

export interface SendNotificationOptions {
  /** Admin broadcast the rows belong to. */
  campaignId?: string | null;
  /** Only users with a signed-in device of this platform (`ios`, `android`, `web`), and only those devices get the push. */
  platform?: string | null;
  /** false = in-app only: rows are saved with push status `skipped`. Default true. */
  push?: boolean;
}

/** Totals of one `NotificationService.send()`. */
export interface SendNotificationResult {
  /** Notifications saved (one per recipient). */
  created: number;
  pushSent: number;
  pushFailed: number;
  pushSkipped: number;
}

/** A device that can receive pushes (one live `user_sessions` row with a push token). */
export interface PushTarget {
  userId: string;
  sessionId: string;
  token: string;
  /** `ios`, `android`, `web` or null. */
  platform: string | null;
}

/** One push, the same for every device it goes to. */
export interface PushMessage {
  title: string;
  body: string;
  image?: string | null;
  /** String values only (FCM `data`). */
  data: Record<string, string>;
}

/** Result for one token of a multicast. */
export interface PushTokenResult {
  token: string;
  ok: boolean;
  /** The token is dead (unregistered or malformed): forget it. */
  invalid: boolean;
  error?: string;
}
