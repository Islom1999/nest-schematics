import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Not, Repository } from 'typeorm';
import { BaseCrudService, escapeLike, hashPassword, isSwaggerExport } from '@app/common';
import { User } from '@app/database';
import { SessionDto } from '../../auth/dto/auth-response.dto';
import { ClientAuthService } from '../client-auth.service';
import { isUniqueViolation } from '../client-auth.types';
import { UserSessionsService } from '../user-sessions.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { USER_LIST_MAX } from './dto/user-list-query.dto';

/** Columns searched by the table's global filter, when the sign-in methods added them. */
const SEARCH_FIELDS = ['name', 'phone', 'email', 'accountNo'];

/** Columns that must stay unique among users that are not deleted (409 otherwise). */
const UNIQUE_FIELDS = ['phone', 'email'] as const;

/**
 * Client accounts for the admin panel (`admin/users`): list, detail, create,
 * edit, block, soft delete and the user's sessions. Users normally sign up
 * through the client sign-in flows; admins can also create and edit them.
 * Deleting or blocking a user ends all their sessions.
 */
@Injectable()
export class UsersService extends BaseCrudService<User, CreateUserDto, UpdateUserDto> {
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

  /** `GET /` - unpaged list for selects: `search` over the search fields, newest first, at most 1000 rows. */
  async list(search?: string, limit = 100): Promise<unknown[]> {
    const qb = this.createQuery().orderBy(`${this.alias}.createdAt`, 'DESC').addOrderBy(`${this.alias}.id`, 'ASC');
    qb.take(Math.min(Math.max(Math.trunc(limit) || 1, 1), USER_LIST_MAX));
    const term = search?.trim();
    const fields = this.tableOptions.searchFields ?? [];
    if (term && fields.length) {
      const any = fields.map((f) => `CAST(${this.alias}.${f} AS TEXT) ILIKE :term`).join(' OR ');
      qb.andWhere(`(${any})`, { term: `%${escapeLike(term)}%` });
    }
    return (await qb.getMany()).map((row) => this.toRow(row));
  }

  override async create(dto: CreateUserDto): Promise<unknown> {
    try {
      return await super.create(dto);
    } catch (error) {
      throw this.conflict(error);
    }
  }

  override async update(id: string, dto: UpdateUserDto): Promise<unknown> {
    let result: unknown;
    try {
      result = await super.update(id, dto);
    } catch (error) {
      throw this.conflict(error);
    }
    if (dto.isBlocked) await this.sessions.revokeAll(id, 'blocked');
    await this.auth.invalidateUser(id);
    return result;
  }

  /** Soft delete: the row moves to the archive, every session ends. */
  override async delete(id: string): Promise<{ deleted: boolean; id: string }> {
    const result = await super.delete(id);
    await this.sessions.revokeAll(id, 'deleted');
    await this.auth.invalidateUser(id);
    return result;
  }

  protected override async beforeCreate(dto: CreateUserDto): Promise<DeepPartial<User>> {
    return this.prepare(dto);
  }

  protected override async beforeUpdate(entity: User, dto: UpdateUserDto): Promise<DeepPartial<User>> {
    return this.prepare(dto, entity.id);
  }

  /** Unique checks (409) and the password hash; only fields that were sent are touched. */
  private async prepare(dto: CreateUserDto | UpdateUserDto, id?: string): Promise<DeepPartial<User>> {
    const data: Record<string, unknown> = { ...dto };
    const password = data['password'];
    delete data['password'];
    const meta = this.repository.metadata;
    for (const field of UNIQUE_FIELDS) {
      const value = data[field];
      if (typeof value !== 'string' || !meta.findColumnWithPropertyName(field)) continue;
      const taken = await this.repository.exists({ where: { [field]: value, ...(id ? { id: Not(id) } : {}) } });
      if (taken) throw new ConflictException(`A user with this ${field} already exists`);
    }
    // Only when a password was sent; argon2id like the sign-in flows.
    if (typeof password === 'string' && password && meta.findColumnWithPropertyName('passwordHash')) {
      data['passwordHash'] = await hashPassword(password);
    }
    return data;
  }

  private conflict(error: unknown): unknown {
    return isUniqueViolation(error) ? new ConflictException('A user with this phone or email already exists') : error;
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
