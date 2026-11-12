export interface Schema {
  /** Comma separated: phone, email, google, apple, telegram. Default `phone`. */
  methods?: string;
  force?: boolean;
  skipInstall?: boolean;
  root?: string;
}
