import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Postgres advisory lock id shared by every app of the project (any constant). */
const MIGRATIONS_LOCK_ID = 727_001;

/**
 * Runs pending migrations while holding an advisory lock, so several instances
 * (api replicas, worker) booting at once apply each migration exactly once.
 *
 * @returns the names of the migrations that were applied.
 */
export async function runPendingMigrations(
  dataSource: DataSource,
  logger: Pick<Logger, 'log'> = new Logger('Migrations'),
): Promise<string[]> {
  const lock = dataSource.createQueryRunner();
  await lock.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [MIGRATIONS_LOCK_ID]);
    const applied = await dataSource.runMigrations();
    for (const migration of applied) logger.log(`Applied ${migration.name}`);
    return applied.map((m) => m.name);
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [MIGRATIONS_LOCK_ID]).catch(() => undefined);
    await lock.release();
  }
}
