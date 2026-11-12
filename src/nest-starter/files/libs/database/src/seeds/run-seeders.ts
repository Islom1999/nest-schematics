import { DataSource } from 'typeorm';
import { Seeder } from './seeder';

export interface RunSeedersOptions {
  /** Run only these seeders (by `name`), in registry order. Empty = all. */
  only?: string[];
  /** Skip `devOnly` seeders (NODE_ENV=production). */
  production?: boolean;
  log?: (message: string) => void;
}

/**
 * Runs seeders in registry order. Unknown names fail before anything runs;
 * `devOnly` seeders are skipped in production, even when named.
 *
 * @returns the names of the seeders that ran.
 */
export async function runSeeders(
  dataSource: DataSource,
  seeders: Seeder[],
  { only = [], production = false, log = () => undefined }: RunSeedersOptions = {},
): Promise<string[]> {
  const unknown = only.filter((name) => !seeders.some((s) => s.name === name));
  if (unknown.length) {
    const known = seeders.map((s) => s.name).join(', ') || '(none registered)';
    throw new Error(`Unknown seeder(s): ${unknown.join(', ')}. Available: ${known}`);
  }

  const ran: string[] = [];
  for (const seeder of seeders) {
    if (only.length && !only.includes(seeder.name)) continue;
    if (seeder.devOnly && production) {
      log(`skip ${seeder.name} (devOnly, NODE_ENV=production)`);
      continue;
    }
    log(`seed ${seeder.name}`);
    await seeder.run(dataSource);
    ran.push(seeder.name);
  }
  return ran;
}
