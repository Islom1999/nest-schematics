import { Rule, SchematicContext, Tree, apply, chain, filter, move, noop, url } from '@angular-devkit/schematics';
import {
  addBarrelExport,
  addEnv,
  addModuleImport,
  addNamedImports,
  getProject,
  insertAtMarker,
  mergeSafe,
  readManifest,
  recordFeature,
  scheduleInstall,
} from '../../utils/ops';
import { Schema } from './schema';

export const SMS_PROVIDERS = ['eskiz', 'log'] as const;
export type SmsProvider = (typeof SMS_PROVIDERS)[number];

const SMS_DIR = 'libs/common/src/sms';
/** Files other runs extend at markers: created once, never overwritten. */
const CREATE_ONLY = [`${SMS_DIR}/sms.transports.ts`, `${SMS_DIR}/index.ts`];
/** Files that belong to one provider only. */
const PROVIDER_FILES: Record<string, SmsProvider> = { 'eskiz-sms.transport.ts': 'eskiz' };

/** Providers recorded by earlier runs (manifest `features.sms.items`). */
export function installedSmsProviders(tree: Tree, root = ''): string[] {
  return readManifest(tree, root)?.features['sms']?.items ?? [];
}

/**
 * `npm run g -- sms eskiz|log`: `SmsModule` (global) and `SmsService.send(phone, text)`
 * in libs/common/src/sms, so the api, worker and bot can all send SMS.
 * Transports register in `sms.transports.ts`; SMS_PROVIDER picks one at boot.
 * Every key is optional: unconfigured outside production = messages go to
 * the server log; in production nothing is sent (503).
 */
export function sms(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const root = options.root ?? '';
    const project = getProject(tree, root);
    const provider: SmsProvider = options.provider ?? 'eskiz';
    const prefix = root ? `${root}/` : '';
    const smsDir = `${prefix}${SMS_DIR}`;

    const files = apply(url('./files'), [
      filter((path) => {
        const owner = PROVIDER_FILES[path.split('/').pop() ?? ''];
        return !owner || owner === provider;
      }),
      root ? move(root) : noop(),
    ]);

    const wire: Rule = (host: Tree) => {
      addBarrelExport(host, `${project.commonSrc}/index.ts`, 'sms');
      addModuleImport(host, project.apiModule, 'SmsModule', '@app/common');

      if (provider === 'eskiz') {
        insertAtMarker(
          host,
          `${smsDir}/sms.transports.ts`,
          '// @ns:sms-transports',
          'eskiz: (config) => EskizSmsTransport.fromConfig(config),',
        );
        addNamedImports(host, `${smsDir}/sms.transports.ts`, [{ name: 'EskizSmsTransport', from: './eskiz-sms.transport' }]);
        addBarrelExport(host, `${smsDir}/index.ts`, 'eskiz-sms.transport');
      }

      addEnv(
        host,
        {
          title: 'SMS',
          vars: [
            {
              key: 'SMS_PROVIDER',
              value: provider,
              type: 'enum',
              values: [...SMS_PROVIDERS],
              comment: 'eskiz | log. log = messages go to the server log (refused in production)',
            },
          ],
        },
        root,
      );
      if (provider === 'eskiz') {
        addEnv(
          host,
          {
            title: 'SMS',
            vars: [
              { key: 'ESKIZ_EMAIL', value: '', comment: 'Eskiz.uz cabinet login. Empty = SMS goes to the log (dev) / is off (production)' },
              { key: 'ESKIZ_PASSWORD', value: '' },
              { key: 'ESKIZ_FROM', value: '4546', comment: 'Approved sender name (4546 = Eskiz test sender)' },
              { key: 'ESKIZ_CALLBACK_URL', value: '', comment: 'Optional delivery report URL' },
            ],
          },
          root,
        );
      }

      recordFeature(host, 'sms', {}, provider, root);
      scheduleInstall(context, options.skipInstall, root);
      return host;
    };

    return chain([
      mergeSafe(files, options.force, CREATE_ONLY.map((p) => `${prefix}${p}`)),
      wire,
      (_host: Tree, ctx: SchematicContext) => {
        const installed = [...new Set([...installedSmsProviders(_host, root), provider])].join(', ');
        ctx.logger.info(
          `SMS (${installed}): inject SmsService from @app/common and call send(phone, text). ` +
            (provider === 'eskiz'
              ? 'Set ESKIZ_EMAIL / ESKIZ_PASSWORD and SMS_PROVIDER=eskiz in .env.'
              : 'SMS_PROVIDER=log writes messages to the server log (development only).'),
        );
      },
    ]);
  };
}
