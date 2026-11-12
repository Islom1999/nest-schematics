import { HostTree } from '@angular-devkit/schematics';
import { UnitTestTree } from '@angular-devkit/schematics/testing';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';

/** Schematics edit the tree they get: run on a copy to compare. */
const copy = (tree: UnitTestTree) => new UnitTestTree(tree.branch());

const DIR = '/libs/common/src/sms';

describe('sms add-on', () => {
  const runner = createRunner();

  describe('eskiz', () => {
    let tree: UnitTestTree;
    beforeAll(async () => {
      tree = await runner.runSchematic('sms', { provider: 'eskiz', skipInstall: true }, await createStarterTree(runner));
    });

    it('adds the library with the eskiz transport registered', () => {
      for (const f of ['sms.module', 'sms.service', 'sms.types', 'sms.transports', 'log-sms.transport', 'eskiz-sms.transport', 'phone', 'index']) {
        expect(tree.exists(`${DIR}/${f}.ts`)).withContext(f).toBeTrue();
      }
      const registry = tree.readContent(`${DIR}/sms.transports.ts`);
      expect(registry).toContain("import { EskizSmsTransport } from './eskiz-sms.transport';");
      expect(registry).toContain('eskiz: (config) => EskizSmsTransport.fromConfig(config),\n  // @ns:sms-transports');
      expect(tree.readContent(`${DIR}/index.ts`)).toContain("export * from './eskiz-sms.transport';");
      expect(tree.readContent('/libs/common/src/index.ts')).toContain("export * from './sms';");
    });

    it('imports SmsModule into the api and records the feature', () => {
      const module = tree.readContent('/apps/api/src/api.module.ts');
      expect(module).toMatch(/import \{[^}]*SmsModule[^}]*\} from '@app\/common';/);
      expect(module).toMatch(/imports: \[[\s\S]*SmsModule/);
      const manifest = JSON.parse(tree.readContent('/nest-schematics.json'));
      expect(manifest.features.sms.items).toEqual(['eskiz']);
    });

    it('adds optional env keys with SMS_PROVIDER=eskiz', () => {
      const env = tree.readContent('/.env.example');
      expect(env).toContain('SMS_PROVIDER=eskiz');
      for (const key of ['ESKIZ_EMAIL=', 'ESKIZ_PASSWORD=', 'ESKIZ_FROM=4546']) expect(env).toContain(key);
      const validation = tree.readContent('/libs/common/src/config/env.validation.ts');
      expect(validation).toContain('SMS_PROVIDER?:');
      expect(validation).toContain('ESKIZ_EMAIL?:');
    });

    it('never logs codes outside the log transport and refuses log in production', () => {
      const service = tree.readContent(`${DIR}/sms.service.ts`);
      expect(service).toContain('production');
      expect(tree.readContent(`${DIR}/eskiz-sms.transport.ts`)).not.toMatch(/logger\.(log|debug|verbose)\([^)]*text/);
    });

    it('changes nothing on a second run', async () => {
      const again = await runner.runSchematic('sms', { provider: 'eskiz', skipInstall: true }, copy(tree));
      expect(snapshot(again)).toEqual(snapshot(tree));
    });
  });

  it('log provider skips the eskiz transport; adding eskiz later registers it', async () => {
    const log = await runner.runSchematic('sms', { provider: 'log', skipInstall: true }, await createStarterTree(runner));
    expect(log.exists(`${DIR}/eskiz-sms.transport.ts`)).toBeFalse();
    expect(log.readContent(`${DIR}/sms.transports.ts`)).not.toContain('eskiz');
    expect(log.readContent('/.env.example')).toContain('SMS_PROVIDER=log');
    expect(log.readContent('/.env.example')).not.toContain('ESKIZ_EMAIL');

    const both = await runner.runSchematic('sms', { provider: 'eskiz', skipInstall: true }, copy(log));
    expect(both.exists(`${DIR}/eskiz-sms.transport.ts`)).toBeTrue();
    expect(both.readContent(`${DIR}/sms.transports.ts`)).toContain('EskizSmsTransport.fromConfig');
    expect(JSON.parse(both.readContent('/nest-schematics.json')).features.sms.items).toEqual(['eskiz', 'log']);
    // The first provider stays the configured one.
    expect(both.readContent('/.env.example')).toContain('SMS_PROVIDER=log');
  });

  it('fails outside a project', async () => {
    await expectAsync(runner.runSchematic('sms', { skipInstall: true }, new UnitTestTree(new HostTree()))).toBeRejectedWithError(/nest-schematics new/);
  });
});
