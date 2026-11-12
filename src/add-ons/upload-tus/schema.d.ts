export interface Schema {
  /** tusd (docker service + hooks, default) or node (@tus/server in the api). Default: the one recorded in nest-schematics.json, else `tusd`. */
  engine?: 'tusd' | 'node';
  /** Overwrite generated files that you have edited. */
  force?: boolean;
  /** Do not run npm install. */
  skipInstall?: boolean;
  /** Project directory relative to the current directory. */
  root?: string;
}
