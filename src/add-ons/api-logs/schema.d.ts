export interface Schema {
  /** Initial API_LOG_MODE. Default `errors`. */
  mode?: 'errors' | 'slow' | 'all';
  /** Initial API_LOG_RETENTION_DAYS (0 = keep forever). Default 30. */
  retentionDays?: number;
  /** Overwrite generated files that you have edited. */
  force?: boolean;
  /** Do not run npm install. */
  skipInstall?: boolean;
  /** Project directory relative to the current directory. */
  root?: string;
}
