import { logging } from '@angular-devkit/core';
import { SchematicTestRunner, UnitTestTree } from '@angular-devkit/schematics/testing';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';
import { parseChannels } from './index';

const LIB = '/libs/common/src/notifications';
const CHANNELS = `${LIB}/notification-channels.ts`;
const ROUTES = '/apps/api/src/modules/notifications';
const JOB = '/apps/worker/src/jobs/notification-push-retry.job.ts';
const SCHEDULED_JOB = '/apps/worker/src/jobs/notification-scheduled.job.ts';
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

    it('adds topic subscriptions and scheduled campaigns in a migration of their own, matching the entities', () => {
      const topics = tree.readContent('/libs/database/src/entities/notification-topic.entity.ts');
      expect(tree.readContent('/libs/database/src/entities/index.ts')).toContain("export * from './notification-topic.entity';");
      expect(topics).toContain("@Index('UQ_notification_topics_user_id_topic', ['userId', 'topic'], { unique: true })");
      expect(topics).toContain("foreignKeyConstraintName: 'FK_notification_topics_user_id'");
      const campaign = tree.readContent('/libs/database/src/entities/notification-campaign.entity.ts');
      for (const part of ["TOPIC = 'topic'", 'sendAt: Date | null;', 'status: NotificationCampaignStatus;', 'meta: Record<string, unknown> | null;']) {
        expect(campaign).toContain(part);
      }

      const files = tree.files.filter((f) => /^\/libs\/database\/src\/migrations\/\d{13}-notifications-topics-schedule\.ts$/.test(f));
      expect(files.length).toBe(1);
      const migration = tree.readContent(files[0]);
      const ts = /(\d{13})/.exec(files[0])![1];
      const core = /(\d{13})/.exec(migrationFile(tree))![1];
      expect(Number(ts)).toBeGreaterThan(Number(core));
      expect(migration).toContain(`export class NotificationsTopicsSchedule${ts} implements MigrationInterface`);
      expect(migration).not.toContain('<%');
      expect(migration).toMatch(/CONSTRAINT "PK_[0-9a-f]{27}" PRIMARY KEY/);
      expect(migration).toContain('CREATE UNIQUE INDEX "UQ_notification_topics_user_id_topic" ON "notification_topics" ("user_id", "topic")');
      expect(migration).toContain(`ADD "status" character varying(16) NOT NULL DEFAULT 'sent'`);
      expect(migration).toContain('ADD "send_at" TIMESTAMP WITH TIME ZONE');
      expect(migration).toContain('CREATE INDEX "IDX_notification_campaigns_status_send_at" ON "notification_campaigns" ("status", "send_at")');
      expect(tree.readContent('/libs/database/src/migrations/index.ts')).toContain(`NotificationsTopicsSchedule${ts},`);
    });

    it('adds resend, delete, cancel, topic subscriptions and the push devices route', () => {
      const admin = tree.readContent(`${ROUTES}/admin-notifications.controller.ts`);
      for (const route of ["@Post(':id/resend')", "@Delete(':id')", "@Delete('campaigns/:id')"]) expect(admin).toContain(route);
      expect(admin.match(/@AdminAccess\('write'\)/g)?.length).toBe(4);
      const client = tree.readContent(`${ROUTES}/client-notifications.controller.ts`);
      for (const route of ["@Get('topics')", "@Put('topics/:topic')", "@Delete('topics/:topic')"]) expect(client).toContain(route);
      const push = tree.readContent(`${ROUTES}/users-push.controller.ts`);
      expect(push).toContain("@AdminResource('users', { read: ['notification.read'] })");
      expect(push).toContain("@Get(':id/push-devices')");
      expect(tree.readContent(`${ROUTES}/push-devices.service.ts`)).toContain('this.sessions.activePushTokens([userId])');
      expect(tree.readContent(`${ROUTES}/notifications.module.ts`)).toContain('UsersPushController');
      expect(tree.readContent(`${ROUTES}/dto/notification.dto.ts`)).toContain('sendAt?: string;');
      for (const spec of ['notification-admin.service.spec.ts', 'push-token-mask.spec.ts']) expect(tree.exists(`${ROUTES}/${spec}`)).withContext(spec).toBeTrue();
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
      expect(installed.logs.some((l) => l.message.includes('scheduled campaigns (sendAt) are not sent'))).toBeTrue();
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
        expect(module).toContain('NotificationScheduledJob,');
        expect(module).toContain("import { NotificationScheduledJob } from './jobs/notification-scheduled.job';");
        expect(tree.readContent(SCHEDULED_JOB)).toContain('dispatchDueCampaigns()');
      }
      expect(workerFirst.readContent(WORKER_MODULE)).toEqual(workerLast.readContent(WORKER_MODULE));

      const again = await run(runner, 'notifications', {}, workerFirst);
      expect(snapshot(again.tree)).toEqual(snapshot(workerFirst));
    });
  });
  describe('queue', () => {
    const API_MODULE = '/apps/api/src/api.module.ts';
    const JOBS_FILE = `${LIB}/notification-jobs.module.ts`;
    const JOBS_FROM = '@app/common/notifications/notification-jobs.module';

    /** Installs the add-ons in this order on top of starter + redis + auth. */
    async function install(order: string[]): Promise<UnitTestTree> {
      let tree = (await run(runner, 'redis', {}, withAuth)).tree;
      for (const name of order) tree = (await run(runner, name, {}, tree)).tree;
      return tree;
    }

    function workerImports(tree: UnitTestTree): string[] {
      const text = tree.readContent(WORKER_MODULE);
      return /imports: \[([\s\S]*?)\n {2}\]/.exec(text)![1].split('\n').map((l) => l.trim()).filter(Boolean).sort();
    }

    function expectJobsWired(tree: UnitTestTree, worker: boolean): void {
      const jobs = tree.readContent(JOBS_FILE);
      for (const name of ['notifications.channel', 'notifications.broadcast', 'notifications.push-retry', 'notifications.scheduled']) {
        expect(jobs).withContext(name).not.toContain(`'${name}'`); // names come from NOTIFICATION_JOB
      }
      expect(jobs).toContain('@JobHandler(NOTIFICATION_JOB.channel');
      expect(jobs).toContain('@JobHandler(NOTIFICATION_JOB.scheduled');
      expect(jobs).toContain('runBroadcast(data.payload, data.options, data.topic)');
      expect(jobs).toContain('{ provide: NOTIFICATION_JOBS, useExisting: JobsService }');
      expect(tree.readContent(`${LIB}/notification.types.ts`)).toContain("channel: 'notifications.channel'");
      expect(tree.readContent(`${LIB}/index.ts`)).not.toContain('notification-jobs');
      expect(tree.readContent(API_MODULE)).toContain(`import { NotificationJobsModule } from '${JOBS_FROM}';`);
      expect(manifest(tree)['queue']).toEqual(
        jasmine.objectContaining({ items: [`handlers:NotificationJobsModule|${JOBS_FROM}`] }),
      );
      if (!worker) return;
      const module = tree.readContent(WORKER_MODULE);
      expect(module).toContain(`import { NotificationJobsModule } from '${JOBS_FROM}';`);
      expect(module).toContain('NotificationModule.forRoot(),');
      expect(module).not.toContain('channels: false');
      expect(module).not.toContain('NotificationPushRetryJob');
      expect(module).not.toContain('NotificationScheduledJob');
      expect(tree.exists(JOB)).toBeFalse();
      expect(tree.exists(SCHEDULED_JOB)).toBeFalse();
    }

    const orders: { name: string; order: string[]; worker: boolean }[] = [
      { name: 'notifications, queue', order: ['notifications', 'queue'], worker: false },
      { name: 'queue, notifications', order: ['queue', 'notifications'], worker: false },
      { name: 'notifications, worker, queue', order: ['notifications', 'worker', 'queue'], worker: true },
      { name: 'worker, notifications, queue', order: ['worker', 'notifications', 'queue'], worker: true },
      { name: 'queue, notifications, worker', order: ['queue', 'notifications', 'worker'], worker: true },
      { name: 'queue, worker, notifications', order: ['queue', 'worker', 'notifications'], worker: true },
      { name: 'worker, queue, notifications', order: ['worker', 'queue', 'notifications'], worker: true },
      { name: 'notifications, queue, worker', order: ['notifications', 'queue', 'worker'], worker: true },
    ];
    const results = new Map<string, Promise<UnitTestTree>>();
    const installed_ = (o: { name: string; order: string[] }) => {
      if (!results.has(o.name)) results.set(o.name, install(o.order));
      return results.get(o.name)!;
    };

    for (const { name, order, worker } of orders) {
      it(`moves the work onto jobs: ${name}`, async () => {
        const tree = await installed_({ name, order });
        expectJobsWired(tree, worker);
        if (!worker) expect(tree.exists(WORKER_MODULE)).toBeFalse();
        // re-running either generator changes nothing
        for (const again of ['notifications', 'queue']) {
          expect(snapshot((await run(runner, again, {}, tree)).tree)).withContext(`re-run ${again}`).toEqual(snapshot(tree));
        }
      });
    }

    it('ends in the same project whatever the order (worker: same imports and files)', async () => {
      const withWorker = await Promise.all(orders.filter((o) => o.worker).map(installed_));
      const [first, ...rest] = withWorker;
      expect(first).toBeDefined();
      for (const tree of rest) {
        expect(workerImports(tree)).toEqual(workerImports(first));
        const files = (t: UnitTestTree) => [...snapshot(t).keys()].map((f) => f.replace(/\/\d{13}-/, '/<ts>-')).sort();
        expect(files(tree)).toEqual(files(first));
        expect(tree.readContent(JOBS_FILE)).toEqual(first.readContent(JOBS_FILE));
      }
      const noWorker = await Promise.all(orders.filter((o) => !o.worker).map(installed_));
      const lines = (t: UnitTestTree) => t.readContent(API_MODULE).split('\n').sort();
      expect(lines(noWorker[0])).toEqual(lines(noWorker[1]));
      expect(manifest(noWorker[0])['queue']).toEqual(manifest(noWorker[1])['queue']);
    });

    it('gives the worker the mail module for the email channel', async () => {
      const tree = (await run(runner, 'notifications', { channels: 'email' }, await install(['worker', 'queue']))).tree;
      expect(tree.readContent(WORKER_MODULE)).toContain('MailModule,');
      expect(tree.readContent(WORKER_MODULE)).toContain('NotificationModule.forRoot(),');
      expect(snapshot((await run(runner, 'notifications', { channels: 'email' }, tree)).tree)).toEqual(snapshot(tree));
    });

    it('replaces a jobs module from before scheduled campaigns', async () => {
      const tree = await install(['notifications', 'queue']);
      const old = tree.readContent(JOBS_FILE).replace(/\n {2}\/\*\* A campaign with[\s\S]*?\n {2}\}\n/, '\n').replace('@JobHandler(NOTIFICATION_JOB.scheduled', '@Removed(');
      const stale = new UnitTestTree(tree.branch());
      stale.overwrite(JOBS_FILE, old);
      expect(stale.readContent(JOBS_FILE)).not.toContain('NOTIFICATION_JOB.scheduled');
      const again = (await run(runner, 'notifications', {}, stale)).tree;
      expect(again.readContent(JOBS_FILE)).toContain('@JobHandler(NOTIFICATION_JOB.scheduled');
      expect(again.readContent(JOBS_FILE)).toEqual(tree.readContent(JOBS_FILE));
    });

    it('changes nothing without the queue: no jobs file, the cron retry job stays', async () => {
      const tree = await install(['notifications', 'worker']);
      expect(tree.exists(JOBS_FILE)).toBeFalse();
      expect(tree.readContent(WORKER_MODULE)).toContain('NotificationPushRetryJob,');
      expect(tree.readContent(WORKER_MODULE)).toContain('NotificationScheduledJob,');
      expect(tree.readContent(WORKER_MODULE)).toContain('NotificationModule.forRoot({ channels: false })');
      expect(tree.readContent(API_MODULE)).not.toContain('NotificationJobsModule');
    });
  });
});
