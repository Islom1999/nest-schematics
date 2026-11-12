export interface Schema {
  /** Comma-separated channels: fcm (always), telegram, email. Default `fcm`. */
  channels?: string;
  /** Overwrite generated files that you have edited. */
  force?: boolean;
  /** Do not run npm install. */
  skipInstall?: boolean;
  /** Project directory relative to the current directory. */
  root?: string;
}
