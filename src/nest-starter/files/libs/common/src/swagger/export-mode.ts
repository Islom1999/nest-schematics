import { randomBytes } from 'crypto';

/** Set by `npm run swagger:export`. */
export const SWAGGER_EXPORT_ENV = 'SWAGGER_EXPORT';

/**
 * True while `npm run swagger:export` builds the OpenAPI files. The app is
 * created but never initialised or started, and there is no database:
 * - the TypeORM DataSource is created with `manualInitialization` (no connection);
 * - `onModuleInit` / `onApplicationBootstrap` hooks do not run;
 * - providers and async factories that open connections (Redis, queues, SDK
 *   clients that call out on creation) must check this and skip that work.
 *
 * Import it by its own path (`@app/common/swagger/export-mode`) from
 * libs/database, so the lib does not load the whole `@app/common` barrel.
 */
export function isSwaggerExport(): boolean {
  const value = process.env[SWAGGER_EXPORT_ENV];
  return value === '1' || value === 'true';
}

/**
 * Required `.env` keys get throwaway values when they are missing, so the
 * export also runs in CI without a `.env`. Nothing connects anywhere with them.
 */
export function swaggerExportEnvDefaults(): Record<string, string> {
  return {
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_USERNAME: 'swagger_export',
    DB_PASSWORD: 'swagger_export',
    DB_DATABASE: 'swagger_export',
    ADMIN_JWT_SECRET: randomBytes(32).toString('hex'),
    ADMIN_REFRESH_SECRET: randomBytes(32).toString('hex'),
  };
}

/**
 * Turns on export mode: loads `.env` (if any), sets SWAGGER_EXPORT=1 and fills
 * the missing required keys. Call it before the app module is imported.
 */
export function prepareSwaggerExport(defaults: Record<string, string> = swaggerExportEnvDefaults()): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config();
  } catch {
    // dotenv is optional here: the defaults below are enough.
  }
  process.env[SWAGGER_EXPORT_ENV] = '1';
  for (const [key, value] of Object.entries(defaults)) {
    if (!process.env[key]) process.env[key] = value;
  }
}
