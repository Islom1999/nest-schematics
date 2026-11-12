import { Injectable } from '@nestjs/common';
import { PushTarget, PushTokenStore } from '@app/common/notifications';
import { UserSessionsService } from '../../client-auth';

/**
 * Push tokens of the API: the auth-client's sessions (`PUT client/auth/push-token`
 * stores them). Only live sessions count; a dead token is cleared from its session.
 */
@Injectable()
export class ClientPushTokenStore extends PushTokenStore {
  constructor(private readonly sessions: UserSessionsService) {
    super();
  }

  activePushTokens(userIds: string[]): Promise<PushTarget[]> {
    return this.sessions.activePushTokens(userIds);
  }

  clearPushToken(sessionId: string): Promise<void> {
    return this.sessions.setPushToken(sessionId, null, null);
  }
}
