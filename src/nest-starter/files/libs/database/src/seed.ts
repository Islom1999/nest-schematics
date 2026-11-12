import dataSource from './data-source';
import { seeders } from './seeds';
import { runSeeders } from './seeds/run-seeders';

/**
 * `npm run seed`            every seeder in seeds/index.ts
 * `npm run seed -- admin`   only the named seeder(s)
 *
 * Seeders must be idempotent. `devOnly` ones are skipped when NODE_ENV=production.
 * Run `npm run migration:run` first (or boot the api once) so the tables exist.
 */
async function main() {
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  await dataSource.initialize();
  try {
    const ran = await runSeeders(dataSource, seeders, {
      only,
      production: process.env.NODE_ENV === 'production',
      log: (message) => console.log(message),
    });
    console.log(ran.length ? `Done: ${ran.join(', ')}` : 'Nothing to seed.');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
