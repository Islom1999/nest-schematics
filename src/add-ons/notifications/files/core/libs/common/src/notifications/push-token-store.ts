import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Not, Repository } from 'typeorm';
import { UserSession } from '@app/database';
import { PushTarget } from './notification.types';

/**
 * Where push tokens come from. They live on `user_sessions`, so a device that
 * signs out (or is revoked) stops getting pushes. The API binds this to
 * UserSessionsService (apps/api/src/modules/notifications/client-push-token.store.ts);
 * apps without client auth (the worker) use {@link SessionPushTokenStore}.
 */
export abstract class PushTokenStore {
  /** Push tokens of the live sessions of these users. */
  abstract activePushTokens(userIds: string[]): Promise<PushTarget[]>;

  /** Forgets the token of one session (FCM reported it as invalid or unregistered). */
  abstract clearPushToken(sessionId: string): Promise<void>;
}

const CHUNK = 1000;

/** Reads `user_sessions` directly, with the same rules as UserSessionsService. */
@Injectable()
export class SessionPushTokenStore extends PushTokenStore {
  constructor(@InjectRepository(UserSession) private readonly sessions: Repository<UserSession>) {
    super();
  }

  async activePushTokens(userIds: string[]): Promise<PushTarget[]> {
    const ids = [...new Set(userIds)];
    const targets: PushTarget[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const rows = await this.sessions.find({
        select: { id: true, userId: true, pushToken: true, pushPlatform: true },
        where: {
          userId: In(ids.slice(i, i + CHUNK)),
          pushToken: Not(IsNull()),
          revokedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
        },
      });
      for (const row of rows) {
        if (row.pushToken) targets.push({ userId: row.userId, sessionId: row.id, token: row.pushToken, platform: row.pushPlatform });
      }
    }
    return targets;
  }

  async clearPushToken(sessionId: string): Promise<void> {
    await this.sessions.update({ id: sessionId }, { pushToken: null, pushPlatform: null });
  }
}
