import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { AdminRole, SUPER_PERMISSION } from '../entities/admin-role.entity';
import { Admin, normalizeEmail } from '../entities/admin.entity';
import { Seeder } from './seeder';

export const SUPER_ROLE_NAME = 'Super admin';

export interface SuperAdminInput {
  email?: string;
  password?: string;
  name?: string;
}

export interface SuperAdminResult {
  status: 'created' | 'exists' | 'skipped';
  /** Why nothing was created. */
  reason?: string;
}

/** ADMIN_EMAIL / ADMIN_PASSWORD from the environment. */
export function superAdminFromEnv(env: NodeJS.ProcessEnv = process.env): SuperAdminInput {
  return { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD };
}

/**
 * Makes sure the super role (`*`) and an admin with `input.email` exist. An
 * existing admin is never changed (its password stays). With `onlyIfNoAdmins`
 * nothing happens once any admin exists — used on application start.
 */
export async function ensureSuperAdmin(
  dataSource: DataSource,
  input: SuperAdminInput,
  options: { onlyIfNoAdmins?: boolean } = {},
): Promise<SuperAdminResult> {
  if (options.onlyIfNoAdmins && (await dataSource.getRepository(Admin).count({ withDeleted: true }))) {
    return { status: 'exists' };
  }
  const email = input.email?.trim() ? normalizeEmail(input.email) : '';
  const password = input.password ?? '';
  if (!email || !password) return { status: 'skipped', reason: 'ADMIN_EMAIL / ADMIN_PASSWORD are not set' };
  if (password.length < 8) return { status: 'skipped', reason: 'ADMIN_PASSWORD must be at least 8 characters' };
  if (process.env.NODE_ENV === 'production' && password.startsWith('change-me')) {
    return { status: 'skipped', reason: 'ADMIN_PASSWORD still has the .env.example placeholder' };
  }

  return dataSource.transaction(async (manager) => {
    const admins = manager.getRepository(Admin);
    if (options.onlyIfNoAdmins && (await admins.count({ withDeleted: true }))) return { status: 'exists' };
    if (await admins.exists({ where: { email } })) return { status: 'exists' };

    const roles = manager.getRepository(AdminRole);
    let role = await roles.findOne({ where: { name: SUPER_ROLE_NAME } });
    if (!role) role = await roles.save(roles.create({ name: SUPER_ROLE_NAME, permissions: [SUPER_PERMISSION] }));

    await admins.save(
      admins.create({
        email,
        name: input.name?.trim() || 'Super admin',
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        roleId: role.id,
      }),
    );
    return { status: 'created' };
  });
}

/** `npm run seed -- super-admin`: the first super admin from ADMIN_EMAIL / ADMIN_PASSWORD. */
export const superAdminSeeder: Seeder = {
  name: 'super-admin',
  async run(dataSource: DataSource) {
    const result = await ensureSuperAdmin(dataSource, superAdminFromEnv());
    const detail = result.reason ? ` (${result.reason})` : '';
    console.log(`super-admin: ${result.status}${detail}`);
  },
};
