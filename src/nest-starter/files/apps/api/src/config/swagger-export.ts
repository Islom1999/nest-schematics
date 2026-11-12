/**
 * `npm run swagger:export [-- <dir>]` → `openapi/<document>.json`, without a database.
 *
 * SWAGGER_EXPORT=1 makes the TypeORM DataSource lazy (`manualInitialization`),
 * the app is created but never initialised or started (no lifecycle hooks, no
 * port), and missing required `.env` keys get throwaway values. Keys are
 * sorted, so the files diff cleanly; commit them and regenerate clients with
 * `npm run api:generate`.
 */
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { findInlineEnums, prepareSwaggerExport } from '@app/common';

async function main(): Promise<void> {
  prepareSwaggerExport();
  // Imported after the env is prepared: ConfigModule validates `.env` on import.
  const { ApiModule } = await import('../api.module');
  const { API_PREFIX, createSwaggerDocuments } = await import('./swagger');

  const app = await NestFactory.create(ApiModule, { logger: ['error', 'warn'], abortOnError: false });
  app.setGlobalPrefix(API_PREFIX);
  const documents = createSwaggerDocuments(app);

  const outDir = resolve(process.argv[2] ?? 'openapi');
  mkdirSync(outDir, { recursive: true });
  for (const [name, document] of Object.entries(documents)) {
    const file = join(outDir, `${name}.json`);
    writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
    const count = Object.values(document.paths).reduce((n, item) => n + Object.keys(item).length, 0);
    const shown = relative(process.cwd(), file);
    console.log(`${shown.startsWith('..') ? file : shown}: ${count} operations`);
    const inline = findInlineEnums(document);
    if (inline.length) {
      console.warn(`  inline enums without enumName (use apiEnum()):\n    ${inline.join('\n    ')}`);
    }
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
