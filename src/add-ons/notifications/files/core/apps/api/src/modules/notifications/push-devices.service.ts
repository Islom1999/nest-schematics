import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@app/database';
import { UserSessionsService } from '../../client-auth';
import { PushDeviceDto } from './dto/notification.dto';
import { maskToken } from './push-token-mask';

/** The push devices of one user (`admin/users/:id/push-devices`), for support. */
@Injectable()
export class PushDevicesService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly sessions: UserSessionsService,
  ) {}

  /** Live sessions that have a push token, most recently used first. Tokens are masked. */
  async list(userId: string): Promise<PushDeviceDto[]> {
    if (!(await this.users.exists({ where: { id: userId } }))) throw new NotFoundException('User not found');
    const [targets, active] = await Promise.all([this.sessions.activePushTokens([userId]), this.sessions.list(userId)]);
    const sessions = new Map(active.map((s) => [s.id, s]));
    return targets
      .map((t): PushDeviceDto => {
        const session = sessions.get(t.sessionId);
        return {
          sessionId: t.sessionId,
          tokenMasked: maskToken(t.token),
          platform: t.platform,
          deviceName: session?.deviceName ?? null,
          appVersion: session?.appVersion ?? null,
          lastSeenAt: session?.lastUsedAt ?? null,
        };
      })
      .sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0));
  }
}
