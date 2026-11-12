import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Not, Repository } from 'typeorm';
import { BaseCrudService, hashPassword, TableQueryOptions } from '@app/common';
import { Admin, AdminRole, SUPER_PERMISSION } from '@app/database';
import { AdminSessionsService } from '../admin-sessions.service';
import { AuthService } from '../auth.service';
import { AdminPrincipal, hasPermissions, isSuper } from '../auth.types';
import { SessionDto } from '../dto/auth-response.dto';
import { CreateAdminDto, UpdateAdminDto } from './admin.dto';

/**
 * Admin accounts (`admin/admins`). Guard rails against privilege escalation:
 * only a super admin may manage a super admin, nobody can hand out a role with
 * permissions they do not hold themselves, and nobody can block, delete or
 * re-role their own account.
 */
@Injectable()
export class AdminsService extends BaseCrudService<Admin, CreateAdminDto, UpdateAdminDto> {
  protected override alias = 'admin';
  protected override relations = ['role'];
  protected override tableOptions: TableQueryOptions = {
    searchFields: ['email', 'name', 'role.name'],
    defaultSort: { field: 'createdAt', order: 'DESC' },
  };
  protected override notFoundMessage = 'Admin not found';

  constructor(
    @InjectRepository(Admin) repository: Repository<Admin>,
    @InjectRepository(AdminRole) private readonly roles: Repository<AdminRole>,
    private readonly sessions: AdminSessionsService,
    private readonly auth: AuthService,
  ) {
    super(repository);
  }

  async createAdmin(dto: CreateAdminDto, actor: AdminPrincipal): Promise<unknown> {
    await this.assertEmailFree(dto.email);
    await this.assertCanAssignRole(dto.roleId ?? null, actor);
    return this.create(dto);
  }

  async updateAdmin(id: string, dto: UpdateAdminDto, actor: AdminPrincipal): Promise<unknown> {
    const target = await this.target(id, actor);
    if (dto.email && dto.email !== target.email) await this.assertEmailFree(dto.email, id);
    if (dto.roleId !== undefined && dto.roleId !== target.roleId) {
      this.assertNotSelf(target, actor, 'change your own role');
      await this.assertCanAssignRole(dto.roleId, actor);
    }
    const result = await this.update(id, dto);
    await this.auth.invalidateAdmin(id);
    return result;
  }

  async deleteAdmin(id: string, actor: AdminPrincipal) {
    const target = await this.target(id, actor);
    this.assertNotSelf(target, actor, 'delete your own account');
    const result = await this.delete(id);
    await this.sessions.revokeAll(id, 'deleted');
    await this.auth.invalidateAdmin(id);
    return result;
  }

  async setBlocked(id: string, isBlocked: boolean, actor: AdminPrincipal): Promise<unknown> {
    const target = await this.target(id, actor);
    this.assertNotSelf(target, actor, 'block your own account');
    await this.repository.update(id, { isBlocked });
    if (isBlocked) await this.sessions.revokeAll(id, 'blocked');
    await this.auth.invalidateAdmin(id);
    return this.findOne(id);
  }

  async setRole(id: string, roleId: string | null, actor: AdminPrincipal): Promise<unknown> {
    const target = await this.target(id, actor);
    this.assertNotSelf(target, actor, 'change your own role');
    await this.assertCanAssignRole(roleId, actor);
    await this.repository.update(id, { roleId });
    await this.auth.invalidateAdmin(id);
    return this.findOne(id);
  }

  /** Sets a new password and ends the admin's sessions (except the caller's own current one). */
  async resetPassword(id: string, password: string, actor: AdminPrincipal): Promise<void> {
    await this.target(id, actor);
    await this.repository.update(id, { passwordHash: await hashPassword(password) });
    await this.sessions.revokeAll(id, 'password_changed', id === actor.id ? actor.sessionId : undefined);
  }

  async listSessions(id: string): Promise<SessionDto[]> {
    await this.getRaw(id);
    return this.auth.listSessions(id);
  }

  async revokeSession(id: string, sessionId: string, actor: AdminPrincipal): Promise<void> {
    await this.target(id, actor);
    await this.auth.revokeSession(id, sessionId, 'revoked_by_admin');
  }

  async revokeAllSessions(id: string, actor: AdminPrincipal): Promise<number> {
    await this.target(id, actor);
    return this.sessions.revokeAll(id, 'revoked_by_admin', id === actor.id ? actor.sessionId : undefined);
  }

  protected override async beforeCreate(dto: CreateAdminDto): Promise<DeepPartial<Admin>> {
    return {
      email: dto.email,
      name: dto.name,
      roleId: dto.roleId ?? null,
      passwordHash: await hashPassword(dto.password),
    };
  }

  // ── guard rails ──────────────────────────────────────────────────────

  /** The admin to change; a super admin can only be changed by a super admin. */
  private async target(id: string, actor: AdminPrincipal): Promise<Admin> {
    const admin = await this.repository.findOne({ where: { id }, relations: { role: true } });
    if (!admin) throw new NotFoundException(this.notFoundMessage);
    const targetIsSuper = !!admin.role && !admin.role.deletedAt && admin.role.permissions.includes(SUPER_PERMISSION);
    if (targetIsSuper && !isSuper(actor.permissions)) {
      throw new ForbiddenException('Only a super admin can change a super admin');
    }
    return admin;
  }

  private assertNotSelf(target: Admin, actor: AdminPrincipal, action: string): void {
    if (target.id === actor.id) throw new BadRequestException(`You cannot ${action}`);
  }

  private async assertCanAssignRole(roleId: string | null, actor: AdminPrincipal): Promise<void> {
    if (!roleId) return;
    const role = await this.roles.findOne({ where: { id: roleId } });
    if (!role) throw new BadRequestException('Role not found');
    if (!hasPermissions(actor.permissions, role.permissions)) {
      throw new ForbiddenException('You cannot assign a role with permissions you do not have');
    }
  }

  private async assertEmailFree(email: string, exceptId?: string): Promise<void> {
    const where = exceptId ? { email, id: Not(exceptId) } : { email };
    if (await this.repository.exists({ where })) {
      throw new ConflictException('An admin with this email already exists');
    }
  }
}
