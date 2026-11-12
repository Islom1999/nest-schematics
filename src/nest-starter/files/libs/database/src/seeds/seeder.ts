import { DataSource } from 'typeorm';

/** Initial or demo data. `run` must be idempotent: seeds can be run many times. */
export interface Seeder {
  /** Name used by `npm run seed -- <name>`. */
  name: string;
  /** Development-only data (demo rows); skipped when NODE_ENV=production. */
  devOnly?: boolean;
  run(dataSource: DataSource): Promise<void>;
}
