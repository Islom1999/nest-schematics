import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BaseCrudService, isSwaggerExport } from '@app/common';
import { User } from '@app/database';
import { SessionDto } from '../../auth/dto/auth-response.dto';
import { ClientAuthService } from '../client-auth.service';
import { UserSessionsService } from '../user-sessions.service';

/** Columns searched by the table's global filter, when the sign-in methods added them. */
const SEARCH_FIELDS = ['name', 'phone', 'email', 'accountNo'];

/**
 * Client accounts for the admin panel (`admin/users`): list, detail, block,
 * and the user's sessions. Accounts are created by the client sign-in flows,
 * not by admins.
 */
@Injectable()
export class UsersService extends BaseCrudService<User> {
  protected override alias = 'user';
  protected override notFoundMessage = 'User not found';

  constructor(
    @InjectRepository(User) repository: Repository<User>,
    private readonly sessions: UserSessionsService,
    private readonly auth: ClientAuthService,
  ) {
    super(repository);
    this.tableOptions = {
      // Entity metadata is not built during `swagger:export` (no DataSource).
      searchFields: isSwaggerExport() ? [] : SEARCH_FIELDS.filter((f) => repository.metadata.findColumnWithPropertyName(f)),
      defaultSort: { field: 'createdAt', order: 'DESC' },
    };
  }

  /** Block (ends every session at once) or unblock. */
  async setBlocked(id: string, isBlocked: boolean): Promise<unknown> {
    await this.getRaw(id);
    await this.repository.update(id, { isBlocked });
    if (isBlocked) await this.sessions.revokeAll(id, 'blocked');
    await this.auth.invalidateUser(id);
    return this.findOne(id);
  }

  async listSessions(id: string): Promise<SessionDto[]> {
    await this.getRaw(id);
    return this.auth.listSessions(id);
  }

  async revokeSession(id: string, sessionId: string): Promise<void> {
    await this.getRaw(id);
    await this.auth.revokeSession(id, sessionId, 'revoked_by_admin');
  }

  async revokeAllSessions(id: string): Promise<number> {
    await this.getRaw(id);
    return this.sessions.revokeAll(id, 'revoked_by_admin');
  }
}
