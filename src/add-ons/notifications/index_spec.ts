import { logging } from '@angular-devkit/core';
import { SchematicTestRunner, UnitTestTree } from '@angular-devkit/schematics/testing';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';
import { parseChannels } from './index';

const LIB = '/libs/common/src/notifications';
const CHANNELS = `${LIB}/notification-channels.ts`;
const ROUTES = '/apps/api/src/modules/notifications';
const JOB = '/apps/worker/src/jobs/notification-push-retry.job.ts';
const WORKER_MODULE = '/apps/worker/src/worker.module.ts';

interface RunResult {
  tree: UnitTestTree;
  logs: logging.LogEntry[];
}

async function run(runner: SchematicTestRunner, name: string, options: Record<string, unknown>, tree: UnitTestTree): Promise<RunResult> {
  const logs: logging.LogEntry[] = [];
  const sub = runner.logger.subscribe((entry) => logs.push(entry));
  try {
    return { tree: await runner.runSchematic(name, { skipInstall: true, ...options }, new UnitTestTree(tree.branch())), logs };
  } finally {
    sub.unsubscribe();
  }
}

function manifest(tree: UnitTestTree) {
  return JSON.parse(tree.readContent('/nest-schematics.json')).features as Record<string, { options?: Record<string, unknown> }>;
}

function migrationFile(tree: UnitTestTree): string {
  const files = tree.files.filter((f) => /^\/libs\/database\/src\/migrations\/\d{13}-notifications\.ts$/.test(f));
  expect(files.length).toBe(1);
  return files[0];
}

describe('notifications add-on', () => {
  const runner = createRunner();
  let starter: UnitTestTree;
  /** starter + sms log + mail log + auth-client phone,email */
  let withAuth: UnitTestTree;
  let installed: RunResult;

  beforeAll(async () => {
    starter = await createStarterTree(runner);
    let tree = (await run(runner, 'sms', { provider: 'log' }, starter)).tree;
    tree = (await run(runner, 'mail', { provider: 'log' }, tree)).tree;
    withAuth = (await run(runner, 'auth-client', { methods: 'phone,email' }, tree)).tree;
    installed = await run(runner, 'notifications', {}, withAuth);
  });

  it('parses channels; fcm is always there', () => {
    expect(parseChannels(undefined)).toEqual(['fcm']);
    expect(parseChannels(' Email,telegram ')).toEqual(['fcm', 'telegram', 'email']);
    expect(() => parseChannels('fcm,sms')).toThrowError(/unknown channel\(s\) "sms"/);
  });

  it('needs auth-client, with the command to run', async () => {
    await expectAsync(run(runner, 'notifications', {}, starter)).toBeRejectedWithError(/"notifications" needs "auth-client" first:\n {2}npm run g -- auth-client/);
  });

  describe('default (fcm)', () => {
    let tree: UnitTestTree;
    beforeAll(() => (tree = installed.tree));

    it('adds the entities, a migration that matches them, and registers it', () => {
      const entities = tree.readContent('/libs/database/src/entities/index.ts');
      expect(entities).toContain("export * from './notification.entity';");
      expect(entities).toContain("export * from './notification-campaign.entity';");
      const entity = tree.readContent('/libs/database/src/entities/notification.entity.ts');
      for (const index of ['IDX_notifications_user_id_read_at', 'IDX_notifications_user_id_created_at', 'IDX_notifications_campaign_id']) {
        expect(entity).toContain(index);
      }
      expect(entity).toContain("foreignKeyConstraintName: 'FK_notifications_user_id'");
      expect(entity).toContain("@ManyToOne(() => User, { onDelete: 'CASCADE' })");

      const file = migrationFile(tree);
      const migration = tree.readContent(file);
      const ts = /(\d{13})/.exec(file)![1];
      expect(migration).toContain(`export class Notifications${ts} implements MigrationInterface`);
      expect(migration).not.toContain('<%');
      expect(migration).toContain('CREATE INDEX "IDX_notifications_user_id_read_at" ON "notifications" ("user_id", "read_at")');
      expect(migration).toContain('REFERENCES "users"("id") ON DELETE CASCADE');
      expect(migration).toMatch(/CONSTRAINT "PK_[0-9a-f]{27}" PRIMARY KEY/);
      expect(tree.readContent('/libs/database/src/migrations/index.ts')).toContain(`Notifications${ts},`);
    });

    it('adds the core, the routes and the api module import', () => {
      for (const f of ['notification.service.ts', 'fcm.sender.ts', 'notification.module.ts', 'push-token-store.ts', 'notifications.spec.ts']) {
        expect(tree.exists(`${LIB}/${f}`)).withContext(f).toBeTrue();
      }
      expect(tree.exists(`${LIB}/channels/telegram.channel.ts`)).toBeFalse();
      expect(tree.exists(`${LIB}/channels/email.channel.ts`)).toBeFalse();
      expect(tree.readContent(CHANNELS)).not.toContain('Channel,');
      expect(tree.readContent(`${ROUTES}/client-push-token.store.ts`)).toContain('this.sessions.setPushToken(sessionId, null, null)');
      expect(tree.readContent(`${ROUTES}/client-notifications.controller.ts`)).toContain("@Controller('client/notifications')");
      expect(tree.readContent(`${ROUTES}/admin-notifications.controller.ts`)).toContain(
        "@AdminResource('notifications', { read: ['notification.read'], write: ['notification.write'] })",
      );
      expect(tree.readContent('/apps/api/src/api.module.ts')).toContain(
        "import { NotificationsModule } from './modules/notifications/notifications.module';",
      );
      expect(tree.readContent('/libs/common/src/permissions.ts')).toContain("{ resource: 'notification', actions: ['read', 'write'] },");
    });

    it('takes FCM credentials from env only, lazily', () => {
      const env = tree.readContent('/.env.example');
      expect(env).toMatch(/^FIREBASE_SERVICE_ACCOUNT_JSON=$/m);
      expect(env).toMatch(/^NOTIFICATION_PUSH_MAX_ATTEMPTS=5$/m);
      expect(tree.readContent('/libs/common/src/config/env.validation.ts')).toContain('FIREBASE_SERVICE_ACCOUNT_JSON');
      const sender = tree.readContent(`${LIB}/fcm.sender.ts`);
      expect(sender).toContain("await import('firebase-admin/app')");
      expect(sender).toContain('isSwaggerExport()');
      expect(sender).not.toMatch(/^import [^t].*firebase-admin/m);
      expect(tree.files.some((f) => /service-account.*\.json$|firebase.*\.json$/i.test(f))).toBeFalse();
      expect(JSON.parse(tree.readContent('/package.json')).dependencies['firebase-admin']).toBe('^13.4.0');
    });

    it('records the feature and hints at the worker', () => {
      expect(manifest(tree)['notifications'].options).toEqual({ channels: ['fcm'] });
      expect(tree.exists(JOB)).toBeFalse();
      expect(installed.logs.some((l) => l.message.includes('npm run g -- worker'))).toBeTrue();
    });

    it('changes nothing when run again', async () => {
      const again = await run(runner, 'notifications', {}, tree);
      expect(snapshot(again.tree)).toEqual(snapshot(tree));
      expect(again.logs.filter((l) => l.level === 'warn').map((l) => l.message)).toEqual([]);
    });
  });

  describe('channels', () => {
    it('refuses telegram without Telegram sign-in', async () => {
      await expectAsync(run(runner, 'notifications', { channels: 'telegram' }, withAuth)).toBeRejectedWithError(
        /users\.telegram_id[\s\S]*auth-client --methods telegram/,
      );
    });

    it('refuses email without the mail add-on or an email column', async () => {
      const google = (await run(runner, 'auth-client', { methods: 'google' }, starter)).tree;
      await expectAsync(run(runner, 'notifications', { channels: 'email' }, google)).toBeRejectedWithError(/needs "mail" first/);

      let phoneOnly = (await run(runner, 'sms', { provider: 'log' }, starter)).tree;
      phoneOnly = (await run(runner, 'mail', { provider: 'log' }, phoneOnly)).tree;
      phoneOnly = (await run(runner, 'auth-client', { methods: 'phone' }, phoneOnly)).tree;
      await expectAsync(run(runner, 'notifications', { channels: 'email' }, phoneOnly)).toBeRejectedWithError(/users\.email/);
    });

    it('adds telegram, then email on a re-run, keeping both', async () => {
      let tree = (await run(runner, 'mail', { provider: 'log' }, starter)).tree;
      tree = (await run(runner, 'auth-client', { methods: 'telegram,email' }, tree)).tree;
      const telegram = await run(runner, 'notifications', { channels: 'telegram' }, tree);
      let registry = telegram.tree.readContent(CHANNELS);
      expect(registry).toContain('TelegramChannel,');
      expect(registry).toContain("import { TelegramChannel } from './channels/telegram.channel';");
      expect(registry).not.toContain('EmailChannel');
      expect(telegram.tree.readContent(`${LIB}/channels/telegram.channel.ts`)).toContain('api.telegram.org/bot');
      expect(telegram.tree.readContent('/.env.example')).toMatch(/^BOT_TOKEN=/m);

      const both = await run(runner, 'notifications', { channels: 'email' }, telegram.tree);
      registry = both.tree.readContent(CHANNELS);
      expect(registry).toContain('TelegramChannel,');
      expect(registry).toContain('EmailChannel,');
      expect(both.tree.readContent(`${LIB}/channels/email.channel.ts`)).toContain("from '../../mail'");
      expect(manifest(both.tree)['notifications'].options).toEqual({ channels: ['fcm', 'telegram', 'email'] });

      const again = await run(runner, 'notifications', {}, both.tree);
      expect(snapshot(again.tree)).toEqual(snapshot(both.tree));
    });
  });

  describe('worker', () => {
    it('registers the retry job in both install orders', async () => {
      const workerFirst = (await run(runner, 'notifications', {}, (await run(runner, 'worker', {}, withAuth)).tree)).tree;
      const workerLast = (await run(runner, 'worker', {}, installed.tree)).tree;

      for (const tree of [workerFirst, workerLast]) {
        const module = tree.readContent(WORKER_MODULE);
        expect(module).toContain('NotificationModule.forRoot({ channels: false })');
        expect(module).toContain("import { NotificationModule } from '@app/common/notifications';");
        expect(module).toContain('NotificationPushRetryJob,');
        expect(tree.readContent(JOB)).toContain('retryFailedPushes()');
      }
      expect(workerFirst.readContent(WORKER_MODULE)).toEqual(workerLast.readContent(WORKER_MODULE));

      const again = await run(runner, 'notifications', {}, workerFirst);
      expect(snapshot(again.tree)).toEqual(snapshot(workerFirst));
    });
  });
});
