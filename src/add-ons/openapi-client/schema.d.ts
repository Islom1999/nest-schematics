export type OpenapiGenerator = 'typescript-angular' | 'dart-dio' | 'typescript-fetch';

export interface Schema {
  /** Target name: script `api:generate:<name>` and the openapitools.json generator key. */
  name: string;
  /** OpenAPI document (`openapi/<doc>.json`). Default: admin for `--name admin`, otherwise client. */
  doc?: string;
  /** openapi-generator generator. Default: typescript-angular. */
  generator?: OpenapiGenerator;
  /** Output folder of the generated client, relative to the project. */
  target: string;
  /** dart-dio only: Dart package name. Default: `<project>_<name>_api`. */
  pubName?: string;
  /** Do not run npm install. */
  skipInstall?: boolean;
  /** Replace an existing target with the same name. */
  force?: boolean;
}
