export interface Schema {
  /** Overwrite generated files that you have edited. */
  force?: boolean;
  /** Do not run npm install (nothing to install; kept for a uniform CLI). */
  skipInstall?: boolean;
  /** Project directory relative to the current directory. */
  root?: string;
}
