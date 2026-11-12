import { Rule, SchematicContext, Tree, apply, chain, filter, move, noop, url } from '@angular-devkit/schematics';
import {
  addBarrelExport,
  addEnv,
  addModuleImport,
  addNamedImports,
  addPackageJson,
  EnvVar,
  getProject,
  insertAtMarker,
  mergeSafe,
  recordFeature,
  scheduleInstall,
} from '../../utils/ops';
import { Schema } from './schema';

export const MAIL_PROVIDERS = ['resend', 'smtp', 'log'] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

const MAIL_DIR = 'libs/common/src/mail';
/** Files other runs extend at markers: created once, never overwritten. */
const CREATE_ONLY = [`${MAIL_DIR}/mail.transports.ts`, `${MAIL_DIR}/index.ts`];

interface ProviderSpec {
  file: string;
  className: string;
  env: EnvVar[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const PROVIDERS: Partial<Record<MailProvider, ProviderSpec>> = {
  resend: {
    file: 'resend-mail.transport',
    className: 'ResendMailTransport',
    env: [{ key: 'RESEND_API_KEY', value: '', comment: 'resend.com API key. Empty = emails go to the log (dev) / are off (production)' }],
  },
  smtp: {
    file: 'smtp-mail.transport',
    className: 'SmtpMailTransport',
    env: [
      { key: 'SMTP_HOST', value: '', comment: 'Empty = emails go to the log (dev) / are off (production)' },
      { key: 'SMTP_PORT', value: '587', type: 'number' },
      { key: 'SMTP_SECURE', value: 'false', type: 'boolean', comment: 'true for port 465 (TLS); 587 uses STARTTLS' },
      { key: 'SMTP_USER', value: '' },
      { key: 'SMTP_PASSWORD', value: '' },
    ],
    dependencies: { nodemailer: '^8.0.11' },
    devDependencies: { '@types/nodemailer': '^8.0.2' },
  },
};

/**
 * `npm run g -- mail resend|smtp|log`: `MailModule` (global) and
 * `MailService.send({ to, subject, html, text })` in libs/common/src/mail, plus
 * template functions (`codeMail`, `actionMail`). Transports register in
 * `mail.transports.ts`; MAIL_PROVIDER picks one at boot. Every key is optional.
 */
export function mail(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const root = options.root ?? '';
    const project = getProject(tree, root);
    const provider: MailProvider = options.provider ?? 'resend';
    const spec = PROVIDERS[provider];
    const prefix = root ? `${root}/` : '';
    const mailDir = `${prefix}${MAIL_DIR}`;
    const providerFiles = new Set(Object.values(PROVIDERS).map((p) => `${p.file}.ts`));

    const files = apply(url('./files'), [
      filter((path) => {
        const name = path.split('/').pop() ?? '';
        return !providerFiles.has(name) || name === `${spec?.file}.ts`;
      }),
      root ? move(root) : noop(),
    ]);

    const wire: Rule = (host: Tree) => {
      addBarrelExport(host, `${project.commonSrc}/index.ts`, 'mail');
      addModuleImport(host, project.apiModule, 'MailModule', '@app/common');

      if (spec) {
        insertAtMarker(
          host,
          `${mailDir}/mail.transports.ts`,
          '// @ns:mail-transports',
          `${provider}: (config) => ${spec.className}.fromConfig(config),`,
        );
        addNamedImports(host, `${mailDir}/mail.transports.ts`, [{ name: spec.className, from: `./${spec.file}` }]);
        addBarrelExport(host, `${mailDir}/index.ts`, spec.file);
        addPackageJson(host, { dependencies: spec.dependencies, devDependencies: spec.devDependencies }, root);
      }

      addEnv(
        host,
        {
          title: 'Email',
          vars: [
            {
              key: 'MAIL_PROVIDER',
              value: provider,
              type: 'enum',
              values: [...MAIL_PROVIDERS],
              comment: 'resend | smtp | log. log = emails go to the server log (refused in production)',
            },
            { key: 'MAIL_FROM', value: 'App <no-reply@example.com>', comment: 'Sender; its domain must be verified with the provider' },
            ...(spec?.env ?? []),
          ],
        },
        root,
      );

      recordFeature(host, 'mail', {}, provider, root);
      scheduleInstall(context, options.skipInstall, root);
      return host;
    };

    return chain([
      mergeSafe(files, options.force, CREATE_ONLY.map((p) => `${prefix}${p}`)),
      wire,
      (_host: Tree, ctx: SchematicContext) => {
        ctx.logger.info(
          'Mail: inject MailService from @app/common and call send({ to, subject, html, text }); ' +
            `templates in ${MAIL_DIR}/mail.templates.ts. ` +
            (provider === 'log' ? 'MAIL_PROVIDER=log writes emails to the server log (development only).' : `Set MAIL_PROVIDER=${provider} and its keys in .env.`),
        );
      },
    ]);
  };
}
