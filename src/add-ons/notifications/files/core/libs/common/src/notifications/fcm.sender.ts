import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Messaging, MulticastMessage } from 'firebase-admin/messaging';
import { isSwaggerExport } from '../swagger/export-mode';
import { parseServiceAccount } from './firebase-credentials';
import { PushMessage, PushTokenResult } from './notification.types';

/** FCM accepts at most 500 tokens per multicast. */
export const FCM_MULTICAST_LIMIT = 500;

/** Error codes that mean the token itself is dead: it is removed from its session. */
const INVALID_TOKEN_CODES = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

const APP_NAME = 'notifications';

/** Why push is off, or null when it works. */
export type PushDisabledReason = string | null;

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/**
 * Firebase Cloud Messaging through firebase-admin (`sendEachForMulticast`, 500
 * tokens per call). Credentials come only from FIREBASE_SERVICE_ACCOUNT_JSON
 * (the service account JSON, raw or base64); never commit the JSON file.
 *
 * Without it the app still boots: push is off, notifications are saved with
 * push status `skipped`, and one warning is logged. firebase-admin is loaded
 * lazily on the first push, and never during `swagger:export`.
 */
@Injectable()
export class FcmSender implements OnApplicationBootstrap {
  private readonly logger = new Logger('Push');
  private messaging?: Promise<Messaging | null>;
  private disabled: PushDisabledReason = null;

  constructor(private readonly config: ConfigService) {}

  onApplicationBootstrap(): void {
    // Only checks that the key is there (the warning shows at boot); firebase-admin loads on the first push.
    if (!this.rawCredentials()) void this.client();
  }

  /** null when push works, otherwise why it is off. */
  async disabledReason(): Promise<PushDisabledReason> {
    await this.client();
    return this.disabled;
  }

  /**
   * Sends one message to many tokens, in chunks of {@link FCM_MULTICAST_LIMIT}.
   * Returns one result per token (in order), or null when push is off.
   */
  async sendMulticast(tokens: string[], message: PushMessage): Promise<PushTokenResult[] | null> {
    const messaging = await this.client();
    if (!messaging) return null;
    const results: PushTokenResult[] = [];
    for (let i = 0; i < tokens.length; i += FCM_MULTICAST_LIMIT) {
      const chunk = tokens.slice(i, i + FCM_MULTICAST_LIMIT);
      try {
        const response = await messaging.sendEachForMulticast(this.toMulticast(chunk, message));
        response.responses.forEach((r, j) => {
          const code = r.error?.code ?? '';
          results.push({
            token: chunk[j],
            ok: r.success,
            invalid: !r.success && INVALID_TOKEN_CODES.has(code),
            ...(r.success ? {} : { error: (r.error ? `${code}: ${r.error.message}` : 'unknown error').slice(0, 500) }),
          });
        });
      } catch (error) {
        // The whole call failed (network, quota, credentials): every token of the chunk can be retried.
        const text = errorMessage(error);
        this.logger.error(`FCM multicast of ${chunk.length} token(s) failed: ${text}`);
        for (const token of chunk) results.push({ token, ok: false, invalid: false, error: text });
      }
    }
    return results;
  }

  private toMulticast(tokens: string[], message: PushMessage): MulticastMessage {
    const image = message.image && /^https?:\/\//i.test(message.image) ? message.image : undefined;
    const link = message.data['link'];
    return {
      tokens,
      notification: { title: message.title, body: message.body, ...(image ? { imageUrl: image } : {}) },
      data: message.data,
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
      ...(link && /^https:\/\//i.test(link) ? { webpush: { fcmOptions: { link } } } : {}),
    };
  }

  private rawCredentials(): string {
    return this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON')?.trim() ?? '';
  }

  private client(): Promise<Messaging | null> {
    this.messaging ??= this.init();
    return this.messaging;
  }

  private async init(): Promise<Messaging | null> {
    if (isSwaggerExport()) {
      this.disabled = 'Push is off during swagger:export';
      return null;
    }
    const raw = this.rawCredentials();
    if (!raw) {
      this.disabled = 'Push is not configured (FIREBASE_SERVICE_ACCOUNT_JSON)';
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT_JSON is not set: push notifications are off (notifications are still saved).');
      return null;
    }
    try {
      const account = parseServiceAccount(raw);
      const { cert, getApps, initializeApp } = await import('firebase-admin/app');
      const { getMessaging } = await import('firebase-admin/messaging');
      const app =
        getApps().find((a) => a.name === APP_NAME) ??
        initializeApp({ credential: cert(account), projectId: account.projectId }, APP_NAME);
      this.logger.log(`FCM ready (project ${account.projectId})`);
      return getMessaging(app);
    } catch (error) {
      // The message never contains the credentials (parseServiceAccount hides the value).
      this.disabled = 'FIREBASE_SERVICE_ACCOUNT_JSON is invalid';
      this.logger.error(`FIREBASE_SERVICE_ACCOUNT_JSON is invalid, push notifications are off: ${errorMessage(error)}`);
      return null;
    }
  }
}
