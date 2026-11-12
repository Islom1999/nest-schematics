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
    await expectAsync(runner.runSchematic('payment', { skipInstall: true }, copy(withClients))).toBeRejectedWithError(/payme\|click/);
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
