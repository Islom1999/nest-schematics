import { UnitTestTree } from '@angular-devkit/schematics/testing';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';

describe('bot add-on', () => {
  const runner = createRunner();
  let tree: UnitTestTree;

  beforeAll(async () => {
    tree = await runner.runSchematic('bot', { skipInstall: true }, await createStarterTree(runner));
  });

  it('creates apps/bot that stays off without BOT_TOKEN', () => {
    for (const file of ['tsconfig.app.json', 'src/main.ts', 'src/bot.module.ts', 'src/bot.service.ts']) {
      expect(tree.exists(`/apps/bot/${file}`)).withContext(file).toBeTrue();
    }
    const service = tree.readContent('/apps/bot/src/bot.service.ts');
    expect(service).toContain("this.config.get<string>('BOT_TOKEN')");
    expect(service).toContain('bot is disabled');
  });

  it('adds BOT_TOKEN (empty) to .env.example and env validation', () => {
    const example = tree.readContent('/.env.example');
    expect(example).toContain('# ── apps/bot (Telegram, telegraf)');
    expect(example).toMatch(/\nBOT_TOKEN=\n/);
    const validation = tree.readContent('/libs/common/src/config/env.validation.ts');
    expect(validation).toContain('  @IsOptional()\n  @IsString()\n  BOT_TOKEN?: string;');
  });

  it('declares the app, scripts and dependency, and records the feature', () => {
    expect(Object.keys(JSON.parse(tree.readContent('/nest-cli.json')).projects)).toEqual(['api', 'bot', 'common', 'database']);
    const pkg = JSON.parse(tree.readContent('/package.json'));
    expect(pkg.scripts.build).toBe('nest build api && nest build bot');
    expect(pkg.scripts['start:dev:bot']).toBe('nest start bot --watch');
    expect(pkg.dependencies['telegraf']).toBe('^4.16.3');
    expect(Object.keys(JSON.parse(tree.readContent('/nest-schematics.json')).features)).toEqual(['bot']);
  });

  it('changes nothing on a second run, even with a real .env', async () => {
    const copy = tree.branch();
    copy.create('/.env', 'BOT_TOKEN=123:abc\n');
    const before = snapshot(copy);
    const again = await runner.runSchematic('bot', { skipInstall: true }, copy);
    expect(snapshot(again)).toEqual(before);
  });

  it('keeps the worker and bot builds when both are added', async () => {
    const both = await runner.runSchematic('worker', { skipInstall: true }, tree.branch());
    expect(JSON.parse(both.readContent('/package.json')).scripts.build).toBe(
      'nest build api && nest build bot && nest build worker',
    );
  });
});
