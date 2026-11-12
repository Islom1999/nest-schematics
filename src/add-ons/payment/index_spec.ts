import { UnitTestTree } from '@angular-devkit/schematics/testing';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';
import { mergeMode } from './index';

/** Schematics edit the tree they get: run on a copy to compare. */
const copy = (tree: UnitTestTree) => new UnitTestTree(tree.branch());

const API = '/apps/api/src/payments';
const ENTITIES = '/libs/database/src/entities';
const MIGRATIONS = '/libs/database/src/migrations';

const migrationFiles = (tree: UnitTestTree, name: string) =>
  tree.getDir(MIGRATIONS).subfiles.filter((f) => new RegExp(`^\\d{13}-${name}\\.ts$`).test(f));

describe('payment add-on', () => {
  const runner = createRunner();
  let withClients: UnitTestTree;

  beforeAll(async () => {
    const mail = await runner.runSchematic('mail', { provider: 'log', skipInstall: true }, await createStarterTree(runner));
    withClients = await runner.runSchematic('auth-client', { methods: 'email', skipInstall: true }, mail);
  });

  it('needs auth-client first', async () => {
    await expectAsync(runner.runSchematic('payment', { provider: 'payme', skipInstall: true }, await createStarterTree(runner))).toBeRejectedWithError(
      /npm run g -- auth-client/,
    );
  });

  it('needs a provider', async () => {
    await expectAsync(runner.runSchematic('payment', { skipInstall: true }, copy(withClients))).toBeRejectedWithError(/payme\|click\|uzum\|paynet\|inpay/);
  });

  describe('payme (default wallet mode)', () => {
    let tree: UnitTestTree;
    beforeAll(async () => {
      tree = await runner.runSchematic('payment', { provider: 'payme', skipInstall: true }, copy(withClients));
    });

    it('installs the core, the wallet and the payme webhook', () => {
      for (const f of [
        'payments.module',
        'payments.service',
        'payment-state',
        'payment-target',
        'payment-provider',
        'invoices.service',
        'client-payments.controller',
        'admin/admin-payments.controller',
        'wallet/wallet.service',
        'wallet/wallet.module',
        'wallet/wallet-topup.target',
        'payme/payme.service',
        'payme/payme.controller',
        'payme/payme.service.spec',
      ]) {
        expect(tree.exists(`${API}/${f}.ts`)).withContext(f).toBeTrue();
      }
      expect(tree.exists(`${API}/click/click.service.ts`)).toBeFalse();
      for (const f of ['payment.types', 'payment-invoice.entity', 'payment-transaction.entity', 'wallet.entity', 'wallet-transaction.entity']) {
        expect(tree.readContent(`${ENTITIES}/index.ts`)).withContext(f).toContain(`export * from './${f}';`);
      }
      expect(tree.readContent(`${ENTITIES}/payment.types.ts`)).toContain("PAYME = 'payme',\n  // @ns:payment-providers");
    });

    it('registers hand-written migrations, wallets after payments', () => {
      const [payments] = migrationFiles(tree, 'payments');
      const [wallets] = migrationFiles(tree, 'wallets');
      expect(payments).toBeDefined();
      expect(wallets).toBeDefined();
      expect(Number(wallets.slice(0, 13))).toBeGreaterThan(Number(payments.slice(0, 13)));
      const index = tree.readContent(`${MIGRATIONS}/index.ts`);
      expect(index.indexOf(`Payments${payments.slice(0, 13)},`)).toBeLessThan(index.indexOf(`Wallets${wallets.slice(0, 13)},`));
      const sql = tree.readContent(`${MIGRATIONS}/${payments}`);
      expect(sql).toContain('RESTART WITH 1000000000');
      expect(sql).not.toContain('<%');
      expect(tree.readContent(`${MIGRATIONS}/${wallets}`)).toContain('CHK_wallets_balance_non_negative');
    });

    it('wires modules, the webhook, permissions and env keys', () => {
      const apiModule = tree.readContent('/apps/api/src/api.module.ts');
      expect(apiModule).toMatch(/import \{[^}]*PaymentsModule[^}]*\} from '\.\/payments';/);
      expect(apiModule).toMatch(/imports: \[[\s\S]*PaymentsModule[\s\S]*WalletModule/);
      const module = tree.readContent(`${API}/payments.module.ts`);
      expect(module).toContain("import { PaymeController } from './payme/payme.controller';");
      expect(module).toMatch(/controllers: \[[^\]]*PaymeController/);
      expect(module).toMatch(/providers: \[[^\]]*PaymeService/);
      expect(tree.readContent(`${API}/index.ts`)).toContain("export * from './wallet/wallet.service';");
      expect(tree.readContent('/libs/common/src/permissions.ts')).toContain("{ resource: 'payment', actions: ['read', 'write'] },");

      const env = tree.readContent('/.env.example');
      for (const key of ['PAYMENT_MIN_AMOUNT=100000', 'PAYME_MERCHANT_ID=', 'PAYME_KEY=', 'PAYME_TEST_KEY=', 'PAYME_TEST_MODE=false', 'PAYME_ACCOUNT_FIELD=account']) {
        expect(env).toContain(key);
      }
      expect(env).not.toContain('CLICK_');
      expect(env).not.toMatch(/^PAYME_\w+=change-me/m);
      expect(tree.readContent('/libs/common/src/config/env.validation.ts')).toContain('PAYME_KEY?:');
    });

    it('admin routes: invoices, summary, CSV export and wallet reversal', () => {
      expect(tree.exists(`${API}/admin/payments-report.ts`)).toBeTrue();
      expect(tree.exists(`${API}/admin/payments-report.spec.ts`)).toBeTrue();
      const payments = tree.readContent(`${API}/admin/admin-payments.controller.ts`);
      const routes = [...payments.matchAll(/@(Get|Post)\('([^']+)'\)/g)].map((m) => `${m[1]} ${m[2]}`);
      expect(routes).toEqual([
        'Post pagination',
        'Get summary',
        'Get export',
        'Post invoices/pagination',
        'Get invoices/:id',
        'Get :id', // after the fixed paths, or `summary` would hit ParseUUIDPipe
        'Post :id/cancel',
      ]);
      expect(payments).toContain("@AdminResource('payments', { read: ['payment.read'], write: ['payment.write'] })");
      expect(payments).toContain('new StreamableFile(');
      const service = tree.readContent(`${API}/admin/admin-payments.service.ts`);
      expect(service).toContain(".addGroupBy(`${this.alias}.provider`)");
      expect(service).toContain('PAYMENT_EXPORT_MAX_ROWS');
      expect(tree.readContent(`${API}/admin/payments-report.ts`)).toContain('/^[=+\\-@\\t\\r]/');

      const wallets = tree.readContent(`${API}/wallet/admin-wallets.controller.ts`);
      expect(wallets).toMatch(/@AdminAccess\('write'\)\s+@HttpCode\(HttpStatus\.OK\)\s+@Post\('transactions\/:id\/reverse'\)/);
      const wallet = tree.readContent(`${API}/wallet/wallet.service.ts`);
      expect(wallet).toContain('async reverse(');
      expect(wallet).toContain("lock: { mode: 'pessimistic_write' }");
      expect(tree.readContent(`${ENTITIES}/wallet-transaction.entity.ts`)).toContain(
        "@Index('UQ_wallet_transactions_reversal_of_id', ['reversalOfId'], { unique: true })",
      );
      const [migration] = migrationFiles(tree, 'wallets');
      const sql = tree.readContent(`${MIGRATIONS}/${migration}`);
      expect(sql).toContain('"reversal_of_id" uuid,');
      expect(sql).toContain('CREATE UNIQUE INDEX "UQ_wallet_transactions_reversal_of_id"');
      expect(sql).toContain('DROP CONSTRAINT "FK_wallet_transactions_reversal_of_id"');
    });

    it('webhooks are public, unthrottled, out of Swagger and not logged without api-logs', () => {
      const controller = tree.readContent(`${API}/payme/payme.controller.ts`);
      for (const d of ['@Public()', '@SkipThrottle()', '@ApiExcludeController()', "@Controller('payments/payme')"]) expect(controller).toContain(d);
      expect(controller).not.toContain('@LogPayment(');
    });

    it('records the feature and changes nothing on a second run', async () => {
      const manifest = JSON.parse(tree.readContent('/nest-schematics.json'));
      expect(manifest.features.payment.items).toEqual(['payme']);
      expect(manifest.features.payment.options).toEqual({ mode: 'wallet' });
      const again = await runner.runSchematic('payment', { provider: 'payme', skipInstall: true }, copy(tree));
      expect(snapshot(again)).toEqual(snapshot(tree));
    });

    it('adds click later without installing the core twice', async () => {
      const both = await runner.runSchematic('payment', { provider: 'click', skipInstall: true }, copy(tree));
      expect(both.exists(`${API}/click/click.controller.ts`)).toBeTrue();
      expect(migrationFiles(both, 'payments')).toEqual(migrationFiles(tree, 'payments'));
      expect(migrationFiles(both, 'wallets')).toEqual(migrationFiles(tree, 'wallets'));
      const types = both.readContent(`${ENTITIES}/payment.types.ts`);
      expect(types).toContain("PAYME = 'payme',\n  CLICK = 'click',\n  // @ns:payment-providers");
      const module = both.readContent(`${API}/payments.module.ts`);
      expect(module).toMatch(/controllers: \[[^\]]*PaymeController[^\]]*ClickController/);
      expect(module.match(/\bPaymeService\b/g)?.length).toBe(2); // import + providers
      const index = both.readContent(`${MIGRATIONS}/index.ts`);
      expect(index.match(/Payments\d{13},/g)?.length).toBe(1);
      expect(both.readContent('/.env.example')).toContain('CLICK_SECRET_KEY=');
      expect(JSON.parse(both.readContent('/nest-schematics.json')).features.payment.items).toEqual(['click', 'payme']);

      const again = await runner.runSchematic('payment', { provider: 'payme', skipInstall: true }, copy(both));
      expect(snapshot(again)).toEqual(snapshot(both));
    });
  });

  describe('uzum, paynet and inpay', () => {
    const PROVIDERS = [
      {
        name: 'uzum',
        controller: 'UzumController',
        service: 'UzumService',
        enumMember: "UZUM = 'uzum',",
        route: "@Controller('payments/uzum')",
        env: ['UZUM_SERVICE_ID=', 'UZUM_LOGIN=', 'UZUM_PASSWORD=', 'UZUM_ACCOUNT_FIELD=account', 'UZUM_PAY_URL=', 'UZUM_ALLOWED_IPS='],
      },
      {
        name: 'paynet',
        controller: 'PaynetController',
        service: 'PaynetService',
        enumMember: "PAYNET = 'paynet',",
        route: "@Controller('payments/paynet')",
        env: ['PAYNET_LOGIN=', 'PAYNET_PASSWORD=', 'PAYNET_SERVICE_ID=', 'PAYNET_ACCOUNT_FIELD=account', 'PAYNET_PAY_URL=', 'PAYNET_ALLOWED_IPS='],
      },
      {
        name: 'inpay',
        controller: 'InpayController',
        service: 'InpayService',
        enumMember: "INPAY = 'inpay',",
        route: "@Controller('payments/inpay')",
        env: ['INPAY_MERCHANT_ID=', 'INPAY_MERCHANT_TOKEN=', 'INPAY_API_URL=', 'INPAY_CALLBACK_URL=', 'INPAY_PAYMENT_METHOD=', 'INPAY_ALLOWED_IPS='],
      },
    ];

    for (const p of PROVIDERS) {
      it(`${p.name}: installs the webhook, the enum member, env keys and changes nothing on a re-run`, async () => {
        const tree = await runner.runSchematic('payment', { provider: p.name, skipInstall: true }, copy(withClients));
        for (const f of ['service', 'controller', 'service.spec']) {
          expect(tree.exists(`${API}/${p.name}/${p.name}.${f}.ts`)).withContext(f).toBeTrue();
        }
        expect(tree.readContent(`${ENTITIES}/payment.types.ts`)).toContain(`${p.enumMember}\n  // @ns:payment-providers`);
        const module = tree.readContent(`${API}/payments.module.ts`);
        expect(module).toContain(`import { ${p.controller} } from './${p.name}/${p.name}.controller';`);
        expect(module).toMatch(new RegExp(`controllers: \\[[^\\]]*${p.controller}`));
        expect(module).toMatch(new RegExp(`providers: \\[[^\\]]*${p.service}`));

        const controller = tree.readContent(`${API}/${p.name}/${p.name}.controller.ts`);
        for (const d of ['@Public()', '@SkipThrottle()', '@ApiExcludeController()', '// @ns:payment-log', p.route]) {
          expect(controller).withContext(d).toContain(d);
        }
        const env = tree.readContent('/.env.example');
        for (const key of p.env) expect(env).withContext(key).toContain(key);
        expect(env).not.toContain('PAYME_');
        expect(tree.readContent('/libs/common/src/config/env.validation.ts')).toContain(`${p.env[0].replace('=', '')}?:`);
        expect(JSON.parse(tree.readContent('/nest-schematics.json')).features.payment.items).toEqual([p.name]);

        const again = await runner.runSchematic('payment', { provider: p.name, skipInstall: true }, copy(tree));
        expect(snapshot(again)).toEqual(snapshot(tree));
      });
    }

    it('all five providers share one core; api-logs logs every webhook once', async () => {
      let tree = copy(withClients);
      for (const name of ['payme', 'click', 'uzum', 'paynet', 'inpay']) {
        tree = await runner.runSchematic('payment', { provider: name, skipInstall: true }, tree);
      }
      expect(migrationFiles(tree, 'payments').length).toBe(1);
      expect(tree.readContent(`${ENTITIES}/payment.types.ts`)).toContain(
        "PAYME = 'payme',\n  CLICK = 'click',\n  UZUM = 'uzum',\n  PAYNET = 'paynet',\n  INPAY = 'inpay',\n  // @ns:payment-providers",
      );
      expect(JSON.parse(tree.readContent('/nest-schematics.json')).features.payment.items).toEqual(['click', 'inpay', 'payme', 'paynet', 'uzum']);

      const logged = await runner.runSchematic('api-logs', { skipInstall: true }, tree);
      for (const name of ['uzum', 'paynet', 'inpay']) {
        const controller = logged.readContent(`${API}/${name}/${name}.controller.ts`);
        expect(controller).withContext(name).toContain(`@LogPayment({ module: '${name}' })\n// @ns:payment-log`);
        expect(controller.match(/@LogPayment\(/g)?.length).toBe(1);
      }
      const again = await runner.runSchematic('payment', { provider: 'inpay', skipInstall: true }, copy(logged));
      expect(snapshot(again)).toEqual(snapshot(logged));
    });

    it('checkout awaits async pay URLs (inPAY creates the order first)', async () => {
      const tree = await runner.runSchematic('payment', { provider: 'inpay', skipInstall: true }, copy(withClients));
      expect(tree.readContent(`${API}/invoices.service.ts`)).toContain('payUrl: await adapter.payUrl(invoice),');
      expect(tree.readContent(`${API}/payment-provider.ts`)).toContain('payUrl(invoice: PaymentInvoice): string | Promise<string>;');
      expect(tree.readContent(`${API}/inpay/inpay.service.ts`)).toContain('await this.fetchState(orderId)');
    });
  });

  describe('modes', () => {
    it('order mode installs no wallet; adding wallet later makes it both', async () => {
      const order = await runner.runSchematic('payment', { provider: 'click', mode: 'order', skipInstall: true }, copy(withClients));
      expect(order.exists(`${API}/wallet/wallet.service.ts`)).toBeFalse();
      expect(migrationFiles(order, 'wallets')).toEqual([]);
      expect(order.readContent('/apps/api/src/api.module.ts')).not.toContain('WalletModule');
      expect(order.readContent(`${API}/payment-target.ts`)).toContain('class OrderPaymentTarget');

      // A provider added later without --mode keeps order mode.
      const stillOrder = await runner.runSchematic('payment', { provider: 'payme', skipInstall: true }, copy(order));
      expect(stillOrder.exists(`${API}/wallet/wallet.service.ts`)).toBeFalse();

      const both = await runner.runSchematic('payment', { provider: 'payme', mode: 'wallet', skipInstall: true }, copy(stillOrder));
      expect(both.exists(`${API}/wallet/wallet.service.ts`)).toBeTrue();
      expect(migrationFiles(both, 'wallets').length).toBe(1);
      expect(JSON.parse(both.readContent('/nest-schematics.json')).features.payment.options).toEqual({ mode: 'both' });
    });

    it('merges modes', () => {
      expect(mergeMode(undefined, undefined)).toBe('wallet');
      expect(mergeMode(undefined, 'order')).toBe('order');
      expect(mergeMode('order', undefined)).toBe('order');
      expect(mergeMode('order', 'wallet')).toBe('both');
      expect(mergeMode('both', 'order')).toBe('both');
      expect(mergeMode('wallet', 'wallet')).toBe('wallet');
    });
  });

  describe('@LogPayment() with api-logs', () => {
    const logged = (tree: UnitTestTree, provider: string) => tree.readContent(`${API}/${provider}/${provider}.controller.ts`);

    it('is added when api-logs comes first, and re-runs stay unchanged', async () => {
      const logs = await runner.runSchematic('api-logs', { skipInstall: true }, copy(withClients));
      const tree = await runner.runSchematic('payment', { provider: 'payme', skipInstall: true }, logs);
      expect(logged(tree, 'payme')).toContain("@LogPayment({ module: 'payme' })\n// @ns:payment-log");
      expect(logged(tree, 'payme')).toMatch(/import \{[^}]*LogPayment[^}]*\} from '@app\/common';/);
      const again = await runner.runSchematic('payment', { provider: 'payme', skipInstall: true }, copy(tree));
      expect(snapshot(again)).toEqual(snapshot(tree));
    });

    it('is added to installed webhooks when api-logs comes later (deferred), once', async () => {
      const payme = await runner.runSchematic('payment', { provider: 'payme', skipInstall: true }, copy(withClients));
      const clicked = await runner.runSchematic('payment', { provider: 'click', skipInstall: true }, payme);
      const tree = await runner.runSchematic('api-logs', { skipInstall: true }, clicked);
      expect(logged(tree, 'payme')).toContain("@LogPayment({ module: 'payme' })");
      expect(logged(tree, 'click')).toContain("@LogPayment({ module: 'click' })");
      expect(logged(tree, 'click').match(/@LogPayment\(/g)?.length).toBe(1);

      const logsAgain = await runner.runSchematic('api-logs', { skipInstall: true }, copy(tree));
      expect(snapshot(logsAgain)).toEqual(snapshot(tree));
      const paymentAgain = await runner.runSchematic('payment', { provider: 'click', skipInstall: true }, copy(tree));
      expect(snapshot(paymentAgain)).toEqual(snapshot(tree));
    });
  });
});
