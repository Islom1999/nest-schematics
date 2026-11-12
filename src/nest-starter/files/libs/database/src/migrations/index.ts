import { MigrationInterface } from 'typeorm';

/**
 * Migrations in run order. Listed explicitly (not a glob) so they work from the
 * webpack bundle too. `npm run migration:generate -- <name>` and
 * `migration:create` write a file here and register its class above the marker;
 * generators register theirs automatically.
 */
export const migrations: (new () => MigrationInterface)[] = [
  // @ns:migrations
];
