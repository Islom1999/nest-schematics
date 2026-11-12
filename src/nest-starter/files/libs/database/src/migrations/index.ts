import { MigrationInterface } from 'typeorm';

/**
 * Migrations in run order. Listed explicitly (not a glob) so they work from the
 * webpack bundle too. `npm run migration:generate --name=x` writes a file here;
 * add its class below. Generators register theirs automatically.
 */
export const migrations: (new () => MigrationInterface)[] = [
  // @ns:migrations
];
