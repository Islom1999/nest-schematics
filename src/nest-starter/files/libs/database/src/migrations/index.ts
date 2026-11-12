import { MigrationInterface } from 'typeorm';
import { AdminAuth1700000000000 } from './1700000000000-admin-auth';

/**
 * Migrations in run order. Listed explicitly (not a glob) so they work from the
 * webpack bundle too. `npm run migration:generate -- <name>` and
 * `migration:create` write a file here and register its class above the marker;
 * generators register theirs automatically.
 */
export const migrations: (new () => MigrationInterface)[] = [
  AdminAuth1700000000000,
  // @ns:migrations
];
