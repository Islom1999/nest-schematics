import {
  Rule,
  SchematicContext,
  SchematicsException,
  Source,
  Tree,
  apply,
  applyTemplates,
  chain,
  move,
  noop,
  url,
} from '@angular-devkit/schematics';
import { defaultIndexName, primaryKeyName } from '../../nest-crud/naming';
import {
  addBarrelExport,
  addEnv,
  addMigration,
  addModuleImport,
  addNamedImports,
  addPackageJson,
  addPermissions,
  getProject,
  hasFeature,
  insertAtMarker,
  mergeSafe,
  readManifest,
  recordFeature,
  requireFeatures,
  scheduleInstall,
} from '../../utils/ops';
import { registerNotificationRetry } from './retry';
import { Schema } from './schema';

export const NOTIFICATION_CHANNELS = ['fcm', 'telegram', 'email'] as const;
export type NotificationChannelName = (typeof NOTIFICATION_CHANNELS)[number];

const MIGRATIONS_DIR = 'libs/database/src/migrations';
const MIGRATION_RE = /^(\d{13})-notifications\.ts$/;
const CHANNELS_FILE = 'libs/common/src/notifications/notification-channels.ts';
const CHANNELS_MARKER = '// @ns:notification-channels';
/** Created once, then only extended at its marker. */
const CREATE_ONLY = [CHANNELS_FILE];

/** Extra channel → its provider class and file (relative to libs/common/src/notifications). */
const CHANNEL_PROVIDERS: Record<Exclude<NotificationChannelName, 'fcm'>, { className: string; from: string }> = {
  telegram: { className: 'TelegramChannel', from: './channels/telegram.channel' },
  email: { className: 'EmailChannel', from: './channels/email.channel' },
};

function prefixed(root: string, path: string): string {
  return root ? `${root}/${path}` : path;
}

export function parseChannels(value: string | undefined): NotificationChannelName[] {
  const list = (value ?? 'fcm')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  const unknown = list.filter((c) => !(NOTIFICATION_CHANNELS as readonly string[]).includes(c));
  if (unknown.length) {
    throw new SchematicsException(
      `notifications: unknown channel(s) ${unknown.map((c) => `"${c}"`).join(', ')}. Use any of: ${NOTIFICATION_CHANNELS.join(', ')}.`,
    );
  }
  // Push (fcm) is the core and always installed.
  return NOTIFICATION_CHANNELS.filter((c) => c === 'fcm' || list.includes(c));
}

/** Reuses the timestamp of an existing migration so re-runs change nothing. */
function migrationTimestamp(tree: Tree, root: string): string {
  for (const file of tree.getDir(prefixed(root, MIGRATIONS_DIR)).subfiles) {
    const match = MIGRATION_RE.exec(file);
    if (match) return match[1];
  }
  return String(Date.now());
}

/** Sign-in methods auth-client was installed with (they decide the `users` columns). */
function authClientMethods(tree: Tree, root: string): string[] {
  return (readManifest(tree, root)?.features['auth-client']?.options?.['methods'] as string[] | undefined) ?? [];
}

/**
 * `npm run g -- notifications [--channels fcm,telegram,email]`: `notifications`
 * and `notification_campaigns` + migration, NotificationService
 * (`@app/common/notifications`: save, then push through FCM; telegram and
 * email channels), `client/notifications` and `admin/notifications` routes,
 * and with the worker a push retry job. Needs auth-client (push tokens live on
 * its sessions). Re-run with more channels to add them.
 */
export function notifications(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const root = options.root ?? '';
    const project = getProject(tree, root);
    requireFeatures(tree, 'notifications', ['auth-client'], root);

    const recorded = (readManifest(tree, root)?.features['notifications']?.options?.['channels'] as string[] | undefined) ?? [];
    const requested = parseChannels(options.channels);
    const channels = NOTIFICATION_CHANNELS.filter((c) => requested.includes(c) || recorded.includes(c));
    const methods = authClientMethods(tree, root);

    if (requested.includes('telegram') && !methods.includes('telegram')) {
      throw new SchematicsException(
        '"notifications --channels telegram" sends to users.telegram_id, which only exists with Telegram sign-in:\n' +
          '  npm run g -- auth-client --methods telegram',
      );
    }
    if (requested.includes('email')) {
      requireFeatures(tree, 'notifications --channels email', ['mail'], root);
      if (!methods.some((m) => ['email', 'google', 'apple'].includes(m))) {
        throw new SchematicsException(
          '"notifications --channels email" sends to users.email, which only exists with email, Google or Apple sign-in:\n' +
            '  npm run g -- auth-client --methods email',
        );
      }
    }

    const timestamp = migrationTimestamp(tree, root);
    const source = (dir: string, templates: Record<string, unknown> = {}): Source =>
      apply(url(dir), [applyTemplates(templates), root ? move(root) : noop()]);
    const sources: Source[] = [
      source('./files/core', {
        timestamp,
        campaignsPrimaryKey: primaryKeyName('notification_campaigns', ['id']),
        campaignsDeletedAtIndex: defaultIndexName('notification_campaigns', ['deleted_at']),
        notificationsPrimaryKey: primaryKeyName('notifications', ['id']),
        notificationsDeletedAtIndex: defaultIndexName('notifications', ['deleted_at']),
      }),
      ...channels.filter((c) => c !== 'fcm').map((c) => source(`./files/${c}`)),
    ];

    const wire: Rule = (host: Tree) => {
      const entities = `${project.entitiesDir}/index.ts`;
      addBarrelExport(host, entities, 'notification-campaign.entity');
      addBarrelExport(host, entities, 'notification.entity');
      addMigration(host, `Notifications${timestamp}`, `${MIGRATIONS_DIR}/${timestamp}-notifications`, root);
      addPermissions(host, 'notification', ['read', 'write'], root);
      addModuleImport(host, project.apiModule, 'NotificationsModule', './modules/notifications/notifications.module');
      addPackageJson(host, { dependencies: { 'firebase-admin': '^13.4.0' } }, root);

      addEnv(
        host,
        {
          title: 'Notifications (push)',
          vars: [
            {
              key: 'FIREBASE_SERVICE_ACCOUNT_JSON',
              value: '',
              comment:
                'Firebase service account JSON (raw or base64, one line). Never commit the JSON file. Empty = push off, notifications are still saved',
            },
            {
              key: 'NOTIFICATION_PUSH_MAX_ATTEMPTS',
              value: '5',
              type: 'number',
              comment: 'Push attempts per notification; the worker retries failed ones with backoff',
            },
          ],
        },
        root,
      );

      const channelsFile = prefixed(root, CHANNELS_FILE);
      for (const c of channels) {
        if (c === 'fcm') continue;
        const provider = CHANNEL_PROVIDERS[c];
        insertAtMarker(host, channelsFile, CHANNELS_MARKER, `${provider.className},`);
        addNamedImports(host, channelsFile, [{ name: provider.className, from: provider.from }]);
      }
      if (channels.includes('telegram')) {
        addEnv(
          host,
          { title: 'Notifications (push)', vars: [{ key: 'BOT_TOKEN', value: '', comment: 'From @BotFather. Empty = Telegram notifications off' }] },
          root,
        );
      }

      registerNotificationRetry(host, context.logger, root);
      recordFeature(host, 'notifications', { channels }, undefined, root);
      scheduleInstall(context, options.skipInstall, root);
      return host;
    };

    return chain([
      ...sources.map((s) => mergeSafe(s, options.force, CREATE_ONLY.map((p) => prefixed(root, p)))),
      wire,
      (_host: Tree, ctx: SchematicContext) => {
        ctx.logger.info(
          `Notifications (${channels.join(', ')}): inject NotificationService from '@app/common/notifications'; ` +
            'routes under /api/client/notifications and /api/admin/notifications (notification.read / notification.write). ' +
            'Set FIREBASE_SERVICE_ACCOUNT_JSON for push and run npm run migration:run.' +
            (hasFeature(_host, 'worker', root) ? '' : ' Without the worker, failed pushes are not retried.'),
        );
      },
    ]);
  };
}
