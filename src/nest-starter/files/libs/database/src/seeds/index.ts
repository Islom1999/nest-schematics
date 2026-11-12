import { Seeder } from './seeder';
import { superAdminSeeder } from './super-admin.seed';

export * from './seeder';

/** Seeds in run order. Generators register theirs automatically. */
export const seeders: Seeder[] = [
  superAdminSeeder,
  // @ns:seeds
];
