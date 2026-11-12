import { UnitTestTree } from '@angular-devkit/schematics/testing';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';

const JOB = '/apps/worker/src/jobs/api-log-cleanup.job.ts';
const WORKER_MODULE = '/apps/worker/src/worker.module.ts';

function migrationFile(tree: UnitTestTree): string {
  const files = tree.files.filter((f) => /^\/libs\/database\/src\/migrations\/\d{13}-server-api-logs\.ts$/.test(f));
  expect(files.length).toBe(1);
  return files[0];
}

describe('api-logs add-on', () => {
  const runner = createRunner();
  let tree: UnitTestTree;
  const info: string[] = [];

  beforeAll(async () => {
    const sub = runner.logger.subscribe((entry) => info.push(entry.message));
    tree = await runner.runSchematic('api-logs', { skipInstall: true }, await createStarterTree(runner));
    sub.unsubscribe();
  });

  it('adds the entity with indexes, exported from the barrel', () => {
    const entity = tree.readContent('/libs/database/src/entities/server-api-log.entity.ts');
    expect(entity).toContain("@Entity({ name: 'server_api_logs' })");
    expect(entity).toContain("@Index('IDX_server_api_logs_created_at', ['createdAt'])");
    for (const index of ['type', 'status_code', 'user_id']) expect(entity).toContain(`@Index('IDX_server_api_logs_${index}')`);
    expect(entity).toContain("@Column({ type: 'jsonb', nullable: true })\n  requestBody: unknown;");
    expect(entity).toContain('AUTH = \'AUTH\'');
    expect(tree.readContent('/libs/database/src/entities/index.ts')).toContain("export * from './server-api-log.entity';");
  });

  it('adds a registered migration that matches the entity', () => {
    const file = migrationFile(tree);
    const ts = /(\d{13})/.exec(file)![1];
    const migration = tree.readContent(file);
    expect(migration).toContain(`export class ServerApiLogs${ts} implements MigrationInterface`);
    expect(migration).toContain('"request_body" jsonb');
    expect(migration).toMatch(/CONSTRAINT "PK_[0-9a-f]{27}" PRIMARY KEY \("id"\)/);
    expect(migration).toContain('ON "server_api_logs" ("created_at")');
    expect(migration).not.toContain('<%');
    const index = tree.readContent('/libs/database/src/migrations/index.ts');
    expect(index).toContain(`import { ServerApiLogs${ts} } from './${ts}-server-api-logs';`);
    expect(index).toContain(`  ServerApiLogs${ts},\n  // @ns:migrations`);
  });

  it('adds the logging library to libs/common', () => {
    for (const f of ['api-log.interceptor', 'api-log.module', 'api-log.service', 'api-log.settings', 'log-payment.decorator', 'mask', 'request-id', 'index']) {
      expect(tree.exists(`/libs/common/src/logging/${f}.ts`)).withContext(f).toBeTrue();
    }
    expect(tree.readContent('/libs/common/src/index.ts')).toContain("export * from './logging';");
    const interceptor = tree.readContent('/libs/common/src/logging/api-log.interceptor.ts');
    expect(interceptor).not.toMatch(/jsonwebtoken|JwtService|jwt\.|\.decode\(|headers\.authorization/i);
    expect(interceptor).toContain('req.user');
  });

  it('registers the module, the global interceptor, admin routes and x-request-id', () => {
    const module = tree.readContent('/apps/api/src/api.module.ts');
    expect(module).toContain('{ provide: APP_INTERCEPTOR, useClass: ApiLogInterceptor }');
    expect(module).toContain("import { validateEnv, ApiLogModule, ApiLogInterceptor } from '@app/common';");
    expect(module).toContain("import { ServerApiLogsModule } from './modules/server-api-logs/server-api-logs.module';");
    expect(module).toMatch(/imports: \[[\s\S]*ApiLogModule,[\s\S]*ServerApiLogsModule/);
    const main = tree.readContent('/apps/api/src/main.ts');
    expect(main).toContain('  app.use(requestIdMiddleware);\n  // @ns:bootstrap');
    expect(main).toContain("import { AllExceptionsFilter, requestIdMiddleware } from '@app/common';");
    const controller = tree.readContent('/apps/api/src/modules/server-api-logs/server-api-logs.controller.ts');
    expect(controller).toContain("@AdminResource('server-api-logs', { read: ['server_api_log.read'], write: [] })");
    expect(controller).not.toMatch(/@(Put|Delete)\(/);
    expect(tree.readContent('/libs/common/src/permissions.ts')).toContain("{ resource: 'server_api_log', actions: ['read'] },");
  });

  it('adds optional env keys with defaults', () => {
    const example = tree.readContent('/.env.example');
    expect(example).toContain('# ── API logs (server_api_logs)');
    for (const line of ['API_LOG_MODE=errors', 'API_LOG_SLOW_MS=1000', 'API_LOG_MAX_BODY=8192', 'API_LOG_MASK_KEYS=', 'API_LOG_RETENTION_DAYS=30']) {
      expect(example).toContain(`\n${line}\n`);
    }
    const validation = tree.readContent('/libs/common/src/config/env.validation.ts');
    expect(validation).toContain("@IsIn(['errors', 'slow', 'all'])\n  API_LOG_MODE?: string;");
    expect(validation).toContain('@IsInt()\n  API_LOG_RETENTION_DAYS?: number;');
  });

  it('records the feature and, without a worker, only hints at the cleanup job', () => {
    expect(Object.keys(JSON.parse(tree.readContent('/nest-schematics.json')).features)).toEqual(['api-logs']);
    expect(tree.exists(JOB)).toBeFalse();
    expect(info.some((m) => m.includes('npm run g -- worker'))).toBeTrue();
  });

  it('changes nothing on a second run (same migration file)', async () => {
    const before = snapshot(tree);
    const again = await runner.runSchematic('api-logs', { skipInstall: true }, tree.branch());
    expect(snapshot(again)).toEqual(before);
  });

  describe('with the worker', () => {
    let workerFirst: UnitTestTree;
    let logsFirst: UnitTestTree;

    beforeAll(async () => {
      const a = await runner.runSchematic('worker', { skipInstall: true }, await createStarterTree(runner));
      workerFirst = await runner.runSchematic('api-logs', { skipInstall: true }, a);
      logsFirst = await runner.runSchematic('worker', { skipInstall: true }, tree.branch());
    });

    it('registers the daily cleanup job (worker, then api-logs)', () => {
      expect(workerFirst.exists(JOB)).toBeTrue();
      const module = workerFirst.readContent(WORKER_MODULE);
      expect(module).toContain('    WorkerService,\n    ApiLogCleanupJob,\n    // @ns:worker-jobs');
      expect(module).toContain("import { ApiLogCleanupJob } from './jobs/api-log-cleanup.job';");
      expect(module).toContain("import { validateEnv, ApiLogModule } from '@app/common';");
      expect(module).toMatch(/DatabaseModule,\n\s+ApiLogModule,/);
      const job = workerFirst.readContent(JOB);
      expect(job).toContain("@Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'api-log-cleanup' })");
      expect(job).toContain('this.apiLogs.purgeExpired()');
    });

    it('registers the same job when the worker comes second (api-logs, then worker)', () => {
      expect(logsFirst.exists(JOB)).toBeTrue();
      expect(logsFirst.readContent(WORKER_MODULE)).toBe(workerFirst.readContent(WORKER_MODULE));
      expect(logsFirst.readContent(JOB)).toBe(workerFirst.readContent(JOB));
    });

    it('ends with the same project in both orders, apart from the migration timestamp', () => {
      const norm = (t: UnitTestTree) => {
        const ts = /(\d{13})/.exec(migrationFile(t))![1];
        const out = new Map<string, string>();
        snapshot(t).forEach((content, path) => out.set(path.split(ts).join('<ts>'), content.split(ts).join('<ts>')));
        return out;
      };
      expect(norm(logsFirst)).toEqual(norm(workerFirst));
    });

    it('is idempotent in both orders', async () => {
      for (const t of [workerFirst, logsFirst]) {
        const before = snapshot(t);
        let again = await runner.runSchematic('api-logs', { skipInstall: true }, t.branch());
        again = await runner.runSchematic('worker', { skipInstall: true }, again);
        expect(snapshot(again)).toEqual(before);
      }
    });
  });
});
