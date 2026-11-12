export interface Schema {
  /** Project name (e.g. shop-api). */
  name: string;
  /** Parent directory for the project. */
  directory?: string;
  /** Comma-separated apps: api (always), bot, worker (add-ons). Default: api. */
  apps?: string;
  /** Do not run npm install. */
  skipInstall?: boolean;
}
