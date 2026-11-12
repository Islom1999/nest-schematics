import { UnitTestTree } from '@angular-devkit/schematics/testing';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';

/** Schematics edit the tree they get: run on a copy to compare. */
const copy = (tree: UnitTestTree) => new UnitTestTree(tree.branch());

const DIR = '/libs/common/src/mail';

describe('mail add-on', () => {
  const runner = createRunner();

  describe('resend', () => {
    let tree: UnitTestTree;
    beforeAll(async () => {
      tree = await runner.runSchematic('mail', { provider: 'resend', skipInstall: true }, await createStarterTree(runner));
    });

    it('adds the library with the resend transport and templates', () => {
      for (const f of ['mail.module', 'mail.service', 'mail.types', 'mail.transports', 'mail.templates', 'log-mail.transport', 'resend-mail.transport', 'index']) {
        expect(tree.exists(`${DIR}/${f}.ts`)).withContext(f).toBeTrue();
      }
      expect(tree.exists(`${DIR}/smtp-mail.transport.ts`)).toBeFalse();
      const registry = tree.readContent(`${DIR}/mail.transports.ts`);
      expect(registry).toContain('resend: (config) => ResendMailTransport.fromConfig(config),');
      expect(tree.readContent('/libs/common/src/index.ts')).toContain("export * from './mail';");
      expect(tree.readContent(`${DIR}/mail.templates.ts`)).toContain('export function codeMail(');
    });

    it('wires MailModule, env and the manifest; no extra dependency for resend', () => {
      expect(tree.readContent('/apps/api/src/api.module.ts')).toMatch(/imports: \[[\s\S]*MailModule/);
      const env = tree.readContent('/.env.example');
      expect(env).toContain('MAIL_PROVIDER=resend');
      expect(env).toContain('RESEND_API_KEY=');
      expect(env).toContain('MAIL_FROM=');
      expect(JSON.parse(tree.readContent('/package.json')).dependencies.nodemailer).toBeUndefined();
      expect(JSON.parse(tree.readContent('/nest-schematics.json')).features.mail.items).toEqual(['resend']);
    });

    it('changes nothing on a second run', async () => {
      const again = await runner.runSchematic('mail', { provider: 'resend', skipInstall: true }, copy(tree));
      expect(snapshot(again)).toEqual(snapshot(tree));
    });

    it('adds smtp later with nodemailer, keeping resend', async () => {
      const both = await runner.runSchematic('mail', { provider: 'smtp', skipInstall: true }, copy(tree));
      expect(both.exists(`${DIR}/smtp-mail.transport.ts`)).toBeTrue();
      const registry = both.readContent(`${DIR}/mail.transports.ts`);
      expect(registry).toContain('ResendMailTransport.fromConfig');
      expect(registry).toContain('SmtpMailTransport.fromConfig');
      const pkg = JSON.parse(both.readContent('/package.json'));
      expect(pkg.dependencies.nodemailer).toBeDefined();
      expect(pkg.devDependencies['@types/nodemailer']).toBeDefined();
      for (const key of ['SMTP_HOST=', 'SMTP_PORT=587', 'SMTP_SECURE=false']) expect(both.readContent('/.env.example')).toContain(key);
    });
  });

  it('log provider has no provider transport', async () => {
    const tree = await runner.runSchematic('mail', { provider: 'log', skipInstall: true }, await createStarterTree(runner));
    expect(tree.exists(`${DIR}/resend-mail.transport.ts`)).toBeFalse();
    expect(tree.exists(`${DIR}/smtp-mail.transport.ts`)).toBeFalse();
    expect(tree.readContent('/.env.example')).toContain('MAIL_PROVIDER=log');
  });
});
