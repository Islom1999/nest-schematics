export interface Schema {
  /** Project name (e.g. shop-api). */
  name: string;
  /** Parent directory for the project. */
  directory?: string;
  /** Comma-separated apps: api (always), bot, worker. Default: all. */
  apps?: string;
  /** Do not run npm install. */
  skipInstall?: boolean;
}
