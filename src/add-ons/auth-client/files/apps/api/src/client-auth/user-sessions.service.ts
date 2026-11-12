import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Not, Repository } from 'typeorm';
import { SessionManager } from '@app/common';
import { UserSession } from '@app/database';
import { CLIENT_AUTH_OPTIONS, ClientAuthOptions } from './client-auth.config';

/** A device that can receive pushes. */
export interface PushTarget {
  userId: string;
  sessionId: string;
  token: string;
  /** `ios`, `android`, `web` or null. */
  platform: string | null;
}

const CHUNK = 1000;

/**
 * Client sessions (`user_sessions`), tokens with `typ: 'user'`, plus the push
 * token of each device. Other add-ons (notifications) use
 * `activePushTokens()`: only live sessions count, so signing out or revoking a
 * device stops its pushes.
 */
@Injectable()
export class UserSessionsService extends SessionManager<UserSession> {
  constructor(
    @InjectRepository(UserSession) repository: Repository<UserSession>,
    jwt: JwtService,
    @Inject(CLIENT_AUTH_OPTIONS) options: ClientAuthOptions,
  ) {
    super(repository, jwt, {
      typ: 'user',
      ownerKey: 'userId',
      accessSecret: options.accessSecret,
      refreshSecret: options.refreshSecret,
      accessTtl: options.accessTtl,
      refreshTtl: options.refreshTtl,
      limit: options.sessionLimit,
    });
  }

  /**
   * Stores the push token of a session (null clears it). A token belongs to
   * one device, so it is removed from any other session first (another
   * account signed in on the same phone).
   */
  async setPushToken(sessionId: string, token: string | null, platform: string | null = null): Promise<void> {
    if (token) {
      await this.repository.update({ pushToken: token, id: Not(sessionId) }, { pushToken: null, pushPlatform: null });
    }
    await this.repository.update({ id: sessionId }, { pushToken: token, pushPlatform: token ? platform : null });
  }

  /** Forgets a token everywhere (e.g. FCM reported it as unregistered). */
  async clearPushToken(token: string): Promise<void> {
    await this.repository.update({ pushToken: token }, { pushToken: null, pushPlatform: null });
  }

  /** Push tokens of the live sessions of these users. */
  async activePushTokens(userIds: string[]): Promise<PushTarget[]> {
    const ids = [...new Set(userIds)];
    const targets: PushTarget[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const rows = await this.repository.find({
        select: { id: true, userId: true, pushToken: true, pushPlatform: true },
        where: {
          userId: In(ids.slice(i, i + CHUNK)),
          pushToken: Not(IsNull()),
          revokedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
        },
      });
      for (const row of rows) {
        if (row.pushToken) {
          targets.push({ userId: row.userId, sessionId: row.id, token: row.pushToken, platform: row.pushPlatform });
        }
      }
    }
    return targets;
  }
}
