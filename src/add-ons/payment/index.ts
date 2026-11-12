import {
  FileEntry,
  HostTree,
  Rule,
  SchematicContext,
  SchematicsException,
  Source,
  Tree,
  apply,
  applyTemplates,
  chain,
  forEach,
  move,
  noop,
  url,
} from '@angular-devkit/schematics';
import { createHash } from 'crypto';
import {
  addBarrelExport,
  addEnv,
  addMigration,
  addModuleController,
  addModuleImport,
  addModuleProvider,
  addPermissions,
  EnvVar,
  getProject,
  insertAtMarker,
  mergeSafe,
  readManifest,
  recordFeature,
  requireFeatures,
  scheduleInstall,
} from '../../utils/ops';
import { hasApiLogs } from '../api-logs/cleanup';
import { PAYMENT_WEBHOOK_CONTROLLERS, registerPaymentLogging } from './log';
import { Schema } from './schema';

export const PAYMENT_PROVIDERS = ['payme', 'click'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];
export type PaymentMode = 'wallet' | 'order' | 'both';

const MIGRATIONS_DIR = 'libs/database/src/migrations';
const PAYMENTS_MIGRATION_RE = /^(\d{13})-payments\.ts$/;
const WALLETS_MIGRATION_RE = /^(\d{13})-wallets\.ts$/;
const PAYMENTS_DIR = 'apps/api/src/payments';
const TYPES_FILE = 'libs/database/src/entities/payment.types.ts';
const PROVIDERS_MARKER = '// @ns:payment-providers';
/** Created once, then only extended through ops (providers, wallet exports). */
const CREATE_ONLY = [TYPES_FILE, `${PAYMENTS_DIR}/payments.module.ts`, `${PAYMENTS_DIR}/index.ts`];

function prefixed(root: string, path: string): string {
  return root ? `${root}/${path}` : path;
}

/** TypeORM's DefaultNamingStrategy names, so `migration:generate` sees no difference. */
function typeormName(prefix: 'PK_' | 'IDX_', table: string, columns: string[]): string {
  const key = `${table}_${[...columns].sort().join('_')}`;
  return prefix + createHash('sha1').update(key).digest('hex').slice(0, prefix === 'PK_' ? 27 : 26);
}

/** Timestamp of an existing migration (re-runs change nothing), else null. */
function existingTimestamp(tree: Tree, root: string, re: RegExp): string | null {
  for (const file of tree.getDir(prefixed(root, MIGRATIONS_DIR)).subfiles) {
    const match = re.exec(file);
    if (match) return match[1];
  }
  return null;
}

/** Modes add up: `order` then `wallet` = `both`. First run default: `wallet`. */
export function mergeMode(previous: PaymentMode | undefined, requested: PaymentMode | undefined): PaymentMode {
  if (!previous) return requested ?? 'wallet';
  if (!requested || requested === previous || previous === 'both') return previous;
  return 'both';
}

/** Providers recorded by earlier runs (manifest `features.payment.items`). */
export function installedPaymentProviders(tree: Tree, root = ''): string[] {
  return readManifest(tree, root)?.features['payment']?.items ?? [];
}

const PROVIDER_ENV: Record<PaymentProviderName, { title: string; vars: EnvVar[] }> = {
  payme: {
    title: 'Payme (payments)',
    vars: [
      {
        key: 'PAYME_MERCHANT_ID',
        value: '',
        comment: 'Cashbox id (Payme Business). Empty = Payme is off: checkout answers 503, webhooks are refused',
      },
      { key: 'PAYME_KEY', value: '', comment: 'Cashbox key: Payme calls POST /api/payments/payme with Basic Paycom:<key>' },
      { key: 'PAYME_TEST_KEY', value: '', comment: 'Test cashbox key (test.paycom.uz sandbox), accepted only with PAYME_TEST_MODE=true' },
      { key: 'PAYME_TEST_MODE', value: 'false', type: 'boolean', comment: 'true = accept PAYME_TEST_KEY and use the test checkout' },
      {
        key: 'PAYME_CHECKOUT_URL',
        value: '',
        comment: 'Default https://checkout.paycom.uz (https://checkout.test.paycom.uz in test mode)',
      },
      { key: 'PAYME_ACCOUNT_FIELD', value: 'account', comment: 'Account field name set in the cashbox (ac.<field>)' },
      { key: 'PAYME_ALLOWED_IPS', value: '', comment: 'Optional comma-separated IPs / IPv4 CIDRs Payme calls from (empty = any; behind a proxy set TRUST_PROXY)' },
    ],
  },
  click: {
    title: 'Click (payments)',
    vars: [
      {
        key: 'CLICK_SERVICE_ID',
        value: '',
        comment: 'Click merchant cabinet values. Empty = Click is off: checkout answers 503, webhooks answer -1',
      },
      { key: 'CLICK_MERCHANT_ID', value: '' },
      { key: 'CLICK_MERCHANT_USER_ID', value: '' },
      { key: 'CLICK_SECRET_KEY', value: '', comment: 'Signs prepare/complete requests (MD5 sign_string)' },
      { key: 'CLICK_PAY_URL', value: '', comment: 'Default https://my.click.uz/services/pay' },
      { key: 'CLICK_ALLOWED_IPS', value: '', comment: 'Optional comma-separated IPs / IPv4 CIDRs Click calls from (empty = any; behind a proxy set TRUST_PROXY)' },
    ],
  },
};

const PROVIDER_CLASSES: Record<PaymentProviderName, { controller: string; service: string; enumMember: string }> = {
  payme: { controller: 'PaymeController', service: 'PaymeService', enumMember: "PAYME = 'payme'," },
  click: { controller: 'ClickController', service: 'ClickService', enumMember: "CLICK = 'click'," },
};

/**
 * `npm run g -- payment payme|click [--mode wallet|order|both]` (needs
 * auth-client). The first run installs the core (payment_invoices,
 * payment_transactions, the state machine, `client/payments/checkout`,
 * `admin/payments`, PaymentTargetRegistry); every run adds a provider
 * webhook. `wallet` mode (default) adds wallets + ledger, WalletService and
 * top-ups; `order` mode is the PaymentTarget contract only. With api-logs,
 * webhooks get `@LogPayment()` (also when api-logs comes later).
 */
export function payment(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const root = options.root ?? '';
    const project = getProject(tree, root);
    requireFeatures(tree, 'payment', ['auth-client'], root);
    const provider = options.provider;
    if (!provider || !PAYMENT_PROVIDERS.includes(provider)) {
      throw new SchematicsException(`Name a provider: npm run g -- payment ${PAYMENT_PROVIDERS.join('|')} [--mode wallet|order|both]`);
    }

    const previousMode = readManifest(tree, root)?.features['payment']?.options?.['mode'] as PaymentMode | undefined;
    const mode = mergeMode(previousMode, options.mode);
    const wallet = mode !== 'order';
    const timestamp = existingTimestamp(tree, root, PAYMENTS_MIGRATION_RE) ?? String(Date.now());
    const walletTimestamp = existingTimestamp(tree, root, WALLETS_MIGRATION_RE) ?? String(Math.max(Date.now(), Number(timestamp) + 1));
    const logging = hasApiLogs(tree, root);

    const paymentsDir = prefixed(root, PAYMENTS_DIR);
    const paymentsModule = `${paymentsDir}/payments.module.ts`;
    const typesFile = prefixed(root, TYPES_FILE);

    const source = (dir: string, templates: Record<string, unknown> = {}): Source =>
      apply(url(dir), [
        applyTemplates(templates),
        // Webhook controllers carry @LogPayment() when api-logs is installed, so re-runs compare equal.
        logging ? forEach(withPaymentLogging) : noop(),
        root ? move(root) : noop(),
      ]);

    const sources = [
      source('./files/core', {
        timestamp,
        invoicesPk: typeormName('PK_', 'payment_invoices', ['id']),
        invoicesDeletedAt: typeormName('IDX_', 'payment_invoices', ['deleted_at']),
        transactionsPk: typeormName('PK_', 'payment_transactions', ['id']),
        transactionsDeletedAt: typeormName('IDX_', 'payment_transactions', ['deleted_at']),
      }),
      ...(wallet
        ? [
            source('./files/wallet', {
              walletTimestamp,
              walletsPk: typeormName('PK_', 'wallets', ['id']),
              walletsDeletedAt: typeormName('IDX_', 'wallets', ['deleted_at']),
              ledgerPk: typeormName('PK_', 'wallet_transactions', ['id']),
              ledgerDeletedAt: typeormName('IDX_', 'wallet_transactions', ['deleted_at']),
            }),
          ]
        : []),
      source(`./files/${provider}`),
    ];
    const createOnly = CREATE_ONLY.map((p) => prefixed(root, p));

    const wire: Rule = (host: Tree) => {
      // Core
      for (const entity of ['payment.types', 'payment-invoice.entity', 'payment-transaction.entity']) {
        addBarrelExport(host, `${project.entitiesDir}/index.ts`, entity);
      }
      addMigration(host, `Payments${timestamp}`, `${MIGRATIONS_DIR}/${timestamp}-payments`, root);
      addPermissions(host, 'payment', ['read', 'write'], root);
      addModuleImport(host, project.apiModule, 'PaymentsModule', './payments');
      addEnv(
        host,
        {
          title: 'Payments',
          vars: [
            { key: 'PAYMENT_MIN_AMOUNT', value: '100000', type: 'number', comment: 'Smallest top-up, tiyin (1 sum = 100 tiyin)' },
            { key: 'PAYMENT_MAX_AMOUNT', value: '1000000000', type: 'number', comment: 'Largest top-up, tiyin' },
            { key: 'PAYMENT_INVOICE_TTL_MINUTES', value: '1440', type: 'number', comment: 'How long a checkout invoice can be paid' },
            { key: 'PAYMENT_RETURN_URL', value: '', comment: 'Where the pay page sends the user back (optional)' },
          ],
        },
        root,
      );

      // Wallet mode
      if (wallet) {
        for (const entity of ['wallet.entity', 'wallet-transaction.entity']) {
          addBarrelExport(host, `${project.entitiesDir}/index.ts`, entity);
        }
        addMigration(host, `Wallets${walletTimestamp}`, `${MIGRATIONS_DIR}/${walletTimestamp}-wallets`, root);
        addBarrelExport(host, `${paymentsDir}/index.ts`, 'wallet/wallet.module');
        addBarrelExport(host, `${paymentsDir}/index.ts`, 'wallet/wallet.service');
        addModuleImport(host, project.apiModule, 'WalletModule', './payments');
      }

      // Provider
      const classes = PROVIDER_CLASSES[provider];
      insertAtMarker(host, typesFile, PROVIDERS_MARKER, classes.enumMember);
      addModuleController(host, paymentsModule, {
        expression: classes.controller,
        imports: [{ name: classes.controller, from: `./${provider}/${provider}.controller` }],
      });
      addModuleProvider(host, paymentsModule, {
        expression: classes.service,
        imports: [{ name: classes.service, from: `./${provider}/${provider}.service` }],
      });
      addEnv(host, PROVIDER_ENV[provider], root);

      if (logging) registerPaymentLogging(host, root);
      recordFeature(host, 'payment', { mode }, provider, root);
      scheduleInstall(context, options.skipInstall, root);
      return host;
    };

    return chain([
      ...sources.map((s) => mergeSafe(s, options.force, createOnly)),
      wire,
      (_host: Tree, ctx: SchematicContext) => {
        const installed = [...new Set([...installedPaymentProviders(_host, root), provider])].sort().join(', ');
        ctx.logger.info(
          `Payments (${installed}, mode ${mode}): run "npm run migration:run", fill the ${provider.toUpperCase()}_* keys in .env. ` +
            `Webhook: ${provider === 'payme' ? 'POST /api/payments/payme' : 'POST /api/payments/click/prepare and /complete'}. ` +
            'Checkout: POST /api/client/payments/checkout.' +
            (wallet ? ' Wallet: WalletService (credit/debit/balance) from apps/api/src/payments.' : '') +
            (mode !== 'wallet' ? ' Orders: implement PaymentTarget and register it (example in payments/payment-target.ts).' : ''),
        );
      },
    ]);
  };
}

/** Applies registerPaymentLogging to a webhook controller template (before it is merged). */
function withPaymentLogging(entry: FileEntry): FileEntry {
  const file = Object.values(PAYMENT_WEBHOOK_CONTROLLERS).find((f) => entry.path === `/${f}`);
  if (!file) return entry;
  const scratch = new HostTree();
  scratch.create(file, entry.content);
  registerPaymentLogging(scratch);
  const content = scratch.read(file) ?? entry.content;
  return { path: entry.path, content } as FileEntry;
}
