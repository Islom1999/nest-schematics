export interface Schema {
  /** SMS gateway. Default `eskiz`; `log` writes messages to the server log (development). */
  provider?: 'eskiz' | 'log';
  /** Overwrite generated files that you have edited. */
  force?: boolean;
  /** Do not run npm install. */
  skipInstall?: boolean;
  /** Project directory relative to the current directory. */
  root?: string;
}
