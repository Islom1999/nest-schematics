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
  /**
   * true when the broadcast (`'all'`) was handed to the job queue: nothing is
   * counted yet, the job stores the totals on its campaign when it is done.
   */
  queued?: boolean;
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

/** Injection token of the job queue; only provided when the queue add-on is installed. */
export const NOTIFICATION_JOBS = Symbol('NOTIFICATION_JOBS');

/** The part of the queue's `JobsService` that notifications use. */
export interface NotificationJobQueue {
  enqueue(
    name: string,
    data: unknown,
    opts?: { queue?: string; attempts?: number; delay?: number; backoff?: { type: 'exponential' | 'fixed'; delay: number } },
  ): Promise<unknown>;
}

/** Queue and job names used when the queue add-on is installed. */
export const NOTIFICATION_QUEUE = 'notifications';
export const NOTIFICATION_JOB = {
  /** One batch of users for one extra channel (telegram, email). */
  channel: 'notifications.channel',
  /** `send('all', ...)`: saves and pushes to every user in batches. */
  broadcast: 'notifications.broadcast',
  /** Pushes failed rows again; fails while some still fail, so the queue retries with backoff. */
  pushRetry: 'notifications.push-retry',
} as const;

export interface ChannelJobData {
  channel: string;
  userIds: string[];
  payload: NotificationPayload;
}

export interface BroadcastJobData {
  payload: NotificationPayload;
  options: SendNotificationOptions;
}

export interface PushRetryJobData {
  ids: string[];
}
