export interface Schema {
  /** Seed name (e.g. categories, demo-products). File: libs/database/src/seeds/<name>.seed.ts. */
  name: string;
  /** Demo data: skipped when NODE_ENV=production. */
  devOnly?: boolean;
  /** Overwrite the seed file if it differs from the template. */
  force?: boolean;
  /** Accepted for consistency; this generator installs nothing. */
  skipInstall?: boolean;
}
