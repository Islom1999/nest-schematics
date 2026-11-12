export interface Schema {
  /** Storage driver to add. Default: the one recorded in nest-schematics.json, else `local`. */
  storage?: 'local' | 's3';
  /** Generate webp thumbnails for images with sharp (sticky once installed). */
  thumbnails?: boolean;
  /** Overwrite generated files that you have edited. */
  force?: boolean;
  /** Do not run npm install. */
  skipInstall?: boolean;
  /** Project directory relative to the current directory. */
  root?: string;
}
