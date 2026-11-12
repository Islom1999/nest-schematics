export interface Schema {
  /** Email provider. Default `resend`; `log` writes emails to the server log (development). */
  provider?: 'resend' | 'smtp' | 'log';
  /** Overwrite generated files that you have edited. */
  force?: boolean;
  /** Do not run npm install. */
  skipInstall?: boolean;
  /** Project directory relative to the current directory. */
  root?: string;
}
