export interface Schema {
  /** Resource name (e.g. product, sp-year). Route: admin/<dasherized-name>. */
  name: string;
  /** Monorepo app (apps/<app>). Default: api. */
  app?: string;
  /** Folder the resource folder is created in. Default: apps/<app>/src/modules. */
  path?: string;
  /** Field spec, e.g. "name:string:unique,price:decimal(12,2):default(0),category:relation(Category)". */
  fields?: string;
  /** Module file the new module is registered in. Default: apps/<app>/src/<app>.module.ts. */
  module?: string;
  /** Database library source folder. Default: libs/database/src. */
  dbLib?: string;
  /** Do not register the module in the app module. */
  skipImport?: boolean;
  /** Generate a CREATE TABLE migration (default true; `--no-migration`). */
  migration?: boolean;
  /** Generate a development seed with N rows. */
  seed?: number;
  /** Overwrite generated files that differ from the template. */
  force?: boolean;
  /** Passed by the Nest CLI (apps/<app>/src). */
  sourceRoot?: string;
  language?: string;
  spec?: boolean;
  flat?: boolean;
}
