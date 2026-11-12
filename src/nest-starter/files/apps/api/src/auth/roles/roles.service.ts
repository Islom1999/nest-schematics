import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Not, Repository } from 'typeorm';
import { ALL_PERMISSIONS, BaseCrudService, TableQueryOptions } from '@app/common';
import { Admin, AdminRole, SUPER_PERMISSION } from '@app/database';
import { AuthService } from '../auth.service';
import { AdminPrincipal, hasPermissions, isSuper } from '../auth.types';
import { CreateRoleDto, UpdateRoleDto } from './role.dto';

/**
 * Admin roles (`admin/roles`). Permission keys must come from
 * PERMISSION_CATALOG (or be `*`); a non-super admin can only grant keys they
 * hold and cannot touch a super role. Permission changes apply to signed-in
 * admins at once in this process (the guard cache is cleared).
 */
@Injectable()
export class RolesService extends BaseCrudService<AdminRole, CreateRoleDto, UpdateRoleDto> {
  protected override alias = 'role';
  protected override tableOptions: TableQueryOptions = {
    searchFields: ['name'],
    defaultSort: { field: 'createdAt', order: 'DESC' },
  };
  protected override notFoundMessage = 'Role not found';

  constructor(
    @InjectRepository(AdminRole) repository: Repository<AdminRole>,
    @InjectRepository(Admin) private readonly admins: Repository<Admin>,
    private readonly auth: AuthService,
  ) {
    super(repository);
  }

  async createRole(dto: CreateRoleDto, actor: AdminPrincipal): Promise<unknown> {
    this.assertCanGrant(dto.permissions, actor);
    await this.assertNameFree(dto.name);
    return this.create(dto);
  }

  async updateRole(id: string, dto: UpdateRoleDto, actor: AdminPrincipal): Promise<unknown> {
    const role = await this.getRaw(id);
    this.assertCanEdit(role, actor);
    if (dto.permissions) this.assertCanGrant(dto.permissions, actor);
    if (dto.name && dto.name !== role.name) await this.assertNameFree(dto.name, id);
    const result = await this.update(id, dto);
    await this.auth.invalidateAll();
    return result;
  }

  async deleteRole(id: string, actor: AdminPrincipal) {
    const role = await this.getRaw(id);
    this.assertCanEdit(role, actor);
    const used = await this.admins.count({ where: { roleId: id } });
    if (used) throw new ConflictException(`The role is assigned to ${used} admin(s); reassign them first`);
    const result = await this.delete(id);
    await this.auth.invalidateAll();
    return result;
  }

  protected override beforeCreate(dto: CreateRoleDto): DeepPartial<AdminRole> {
    return { name: dto.name, permissions: dto.permissions };
  }

  private assertCanEdit(role: AdminRole, actor: AdminPrincipal): void {
    if (role.permissions.includes(SUPER_PERMISSION) && !isSuper(actor.permissions)) {
      throw new ForbiddenException('Only a super admin can change a super role');
    }
  }

  private assertCanGrant(permissions: string[], actor: AdminPrincipal): void {
    const known = new Set([SUPER_PERMISSION, ...ALL_PERMISSIONS]);
    const unknown = permissions.filter((p) => !known.has(p));
    if (unknown.length) {
      throw new BadRequestException(`Unknown permission(s): ${unknown.join(', ')} (see GET admin/permissions)`);
    }
    if (!hasPermissions(actor.permissions, permissions)) {
      throw new ForbiddenException('You cannot grant permissions you do not have');
    }
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const where = exceptId ? { name, id: Not(exceptId) } : { name };
    if (await this.repository.exists({ where })) {
      throw new ConflictException('A role with this name already exists');
    }
  }
}
