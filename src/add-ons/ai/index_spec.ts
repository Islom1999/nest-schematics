import { UnitTestTree } from '@angular-devkit/schematics/testing';
import { createRunner, createStarterTree, snapshot } from '../../testing/starter-tree';
import { recordFeature } from '../../utils/ops';

const PROVIDERS = '/libs/common/src/ai/providers/index.ts';
const API_MODULE = '/apps/api/src/api.module.ts';
const CLIENT_AUTH = '/apps/api/src/client-auth/index.ts';

function migration(tree: UnitTestTree, name: string): { file: string; ts: string } {
  const re = new RegExp(`^/libs/database/src/migrations/(\\d{13})-${name}\\.ts$`);
  const files = tree.files.filter((f) => re.test(f));
  expect(files.length).withContext(name).toBe(1);
  return { file: files[0], ts: re.exec(files[0])![1] };
}

function manifest(tree: UnitTestTree) {
  return JSON.parse(tree.readContent('/nest-schematics.json')).features.ai;
}

/** The auth-client contract (N6) the chat imports: UserGuard, CurrentUser, UserPrincipal. */
async function withClientAuth(runner = createRunner()): Promise<UnitTestTree> {
  const tree = await createStarterTree(runner);
  tree.create(
    CLIENT_AUTH,
    [
      "import { CanActivate, createParamDecorator, Injectable } from '@nestjs/common';",
      'export interface UserPrincipal { id: string; sessionId: string }',
      '@Injectable() export class UserGuard implements CanActivate { canActivate() { return true; } }',
      'export const CurrentUser = createParamDecorator(() => undefined);',
      '',
    ].join('\n'),
  );
  recordFeature(tree, 'auth-client');
  return tree;
}

async function expectIdempotent(runner: ReturnType<typeof createRunner>, tree: UnitTestTree, options: Record<string, unknown>) {
  const before = snapshot(tree);
  const again = await runner.runSchematic('ai', { skipInstall: true, ...options }, tree.branch());
  expect(snapshot(again)).toEqual(before);
}

describe('ai add-on', () => {
  const runner = createRunner();

  describe('openrouter', () => {
    let tree: UnitTestTree;
    const info: string[] = [];

    beforeAll(async () => {
      const sub = runner.logger.subscribe((entry) => info.push(entry.message));
      tree = await runner.runSchematic('ai', { provider: 'openrouter', skipInstall: true }, await createStarterTree(runner));
      sub.unsubscribe();
    });

    it('adds the AI library with the provider registered', () => {
      for (const f of ['ai.service', 'ai.module', 'ai-http', 'ai-http.spec', 'ai.service.spec', 'ai-log.service', 'json-schema', 'ai-pricing', 'index']) {
        expect(tree.exists(`/libs/common/src/ai/${f}.ts`)).withContext(f).toBeTrue();
      }
      expect(tree.exists('/libs/common/src/ai/providers/openrouter.provider.ts')).toBeTrue();
      expect(tree.exists('/libs/common/src/ai/providers/openrouter.provider.spec.ts')).toBeTrue();
      expect(tree.exists('/libs/common/src/ai/providers/gemini.provider.ts')).toBeFalse();
      const providers = tree.readContent(PROVIDERS);
      expect(providers).toContain('  OpenRouterProvider,\n  // @ns:ai-providers');
      expect(providers).toContain("import { OpenRouterProvider } from './openrouter.provider';");
      expect(tree.readContent('/libs/common/src/index.ts')).toContain("export * from './ai';");
    });

    it('uses fetch only: no SDK dependency and no API key in URLs', () => {
      const pkg = JSON.parse(tree.readContent('/package.json'));
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      expect(deps.filter((d) => /openai|openrouter|google|genai/i.test(d))).toEqual([]);
      const provider = tree.readContent('/libs/common/src/ai/providers/openrouter.provider.ts');
      expect(provider).toContain("'HTTP-Referer'");
      expect(provider).toContain("'X-Title'");
    });

    it('adds ai_logs with a matching registered migration', () => {
      const entity = tree.readContent('/libs/database/src/entities/ai-log.entity.ts');
      expect(entity).toContain("@Entity({ name: 'ai_logs' })");
      expect(entity).toContain("type: 'numeric'");
      expect(tree.readContent('/libs/database/src/entities/index.ts')).toContain("export * from './ai-log.entity';");
      const { file, ts } = migration(tree, 'ai-logs');
      const text = tree.readContent(file);
      expect(text).toContain(`export class AiLogs${ts} implements MigrationInterface`);
      expect(text).toMatch(/CONSTRAINT "PK_[0-9a-f]{27}" PRIMARY KEY \("id"\)/);
      expect(text).not.toContain('<%');
      expect(tree.readContent('/libs/database/src/migrations/index.ts')).toContain(`import { AiLogs${ts} } from './${ts}-ai-logs';`);
    });

    it('wires the modules, admin routes and permissions', () => {
      const module = tree.readContent(API_MODULE);
      expect(module).toMatch(/import \{[^}]*\bAiModule\b[^}]*\} from '@app\/common';/);
      expect(module).toContain("import { AiAdminModule } from './modules/ai/ai-admin.module';");
      expect(module).not.toContain('AiChatModule');
      const controller = tree.readContent('/apps/api/src/modules/ai/ai-admin.controller.ts');
      expect(controller).toContain("@AdminResource('ai', { read: ['ai.read'], write: ['ai.write'] })");
      expect(controller).toContain('@ApiPaginatedResponse(AiLog)');
      expect(tree.readContent('/libs/common/src/permissions.ts')).toContain("{ resource: 'ai', actions: ['read', 'write'] },");
    });

    it('stats take from/to days and return a zero-filled cost per day, without a new migration', () => {
      const dto = tree.readContent('/apps/api/src/modules/ai/dto/ai-stats.dto.ts');
      for (const field of ['from?: string;', 'to?: string;', 'costByDay: AiStatsCostDayDto[];', 'days?: number;']) expect(dto).toContain(field);
      expect(tree.readContent('/apps/api/src/modules/ai/ai-admin.controller.ts')).toContain('this.service.stats(query)');
      expect(tree.readContent('/apps/api/src/modules/ai/ai-days.ts')).toContain('export const MAX_RANGE_DAYS = 366;');
      expect(tree.exists('/apps/api/src/modules/ai/ai-days.spec.ts')).toBeTrue();
      expect(tree.files.filter((f) => /migrations\/\d{13}-ai-/.test(f)).length).toBe(1);
    });

    it('adds optional env keys (empty API key) with validation', () => {
      const example = tree.readContent('/.env.example');
      for (const line of ['AI_PROVIDER=openrouter', 'AI_TIMEOUT_MS=60000', 'AI_LOG_BODIES=false', 'OPENROUTER_API_KEY=', 'OPENROUTER_MODEL=google/gemini-2.5-flash-lite', 'OPENROUTER_BASE_URL=https://openrouter.ai/api/v1', 'APP_URL=', 'APP_NAME=']) {
        expect(example).toContain(`\n${line}\n`);
      }
      expect(example).not.toContain('GEMINI_API_KEY');
      expect(example).not.toContain('AI_DAILY_MESSAGES');
      const validation = tree.readContent('/libs/common/src/config/env.validation.ts');
      expect(validation).toContain('AI_TIMEOUT_MS?: number;');
      expect(validation).toContain('OPENROUTER_API_KEY?: string;');
    });

    it('records the feature and prints the next steps', () => {
      expect(manifest(tree)).toEqual(jasmine.objectContaining({ items: ['openrouter'] }));
      expect(manifest(tree).options).toBeUndefined();
      expect(info.some((m) => m.includes('OPENROUTER_API_KEY') && m.includes('/api/admin/ai/stats'))).toBeTrue();
    });

    it('changes nothing on a second run', async () => {
      await expectIdempotent(runner, tree, { provider: 'openrouter' });
      await expectIdempotent(runner, tree, {});
    });

    describe('then gemini', () => {
      let both: UnitTestTree;

      beforeAll(async () => {
        both = await runner.runSchematic('ai', { provider: 'gemini', skipInstall: true }, tree.branch());
      });

      it('adds the second provider alongside the first', () => {
        expect(both.exists('/libs/common/src/ai/providers/openrouter.provider.ts')).toBeTrue();
        expect(both.exists('/libs/common/src/ai/providers/gemini.provider.ts')).toBeTrue();
        const providers = both.readContent(PROVIDERS);
        expect(providers).toContain('  OpenRouterProvider,\n  GeminiProvider,\n  // @ns:ai-providers');
        expect(providers).toContain("import { GeminiProvider } from './gemini.provider';");
        expect(manifest(both).items).toEqual(['gemini', 'openrouter']);
      });

      it('keeps the default provider and the single migration', () => {
        const example = both.readContent('/.env.example');
        expect(example).toContain('\nAI_PROVIDER=openrouter\n');
        expect(example).toContain('\nGEMINI_API_KEY=\n');
        expect(migration(both, 'ai-logs').ts).toBe(migration(tree, 'ai-logs').ts);
        expect(both.readContent(API_MODULE).match(/AiAdminModule,/g)?.length).toBe(1);
      });

      it('is idempotent with both providers', async () => {
        await expectIdempotent(runner, both, { provider: 'gemini' });
        await expectIdempotent(runner, both, { provider: 'openrouter' });
      });
    });
  });

  describe('gemini', () => {
    let tree: UnitTestTree;

    beforeAll(async () => {
      tree = await runner.runSchematic('ai', { provider: 'gemini', skipInstall: true }, await createStarterTree(runner));
    });

    it('installs only gemini, with the key in a header', () => {
      expect(tree.exists('/libs/common/src/ai/providers/gemini.provider.ts')).toBeTrue();
      expect(tree.exists('/libs/common/src/ai/providers/openrouter.provider.ts')).toBeFalse();
      expect(tree.readContent(PROVIDERS)).toContain('  GeminiProvider,\n  // @ns:ai-providers');
      expect(tree.readContent('/libs/common/src/ai/providers/gemini.provider.ts')).toContain("'x-goog-api-key'");
      const example = tree.readContent('/.env.example');
      expect(example).toContain('\nAI_PROVIDER=gemini\n');
      expect(example).toContain('\nGEMINI_MODEL=gemini-2.5-flash-lite\n');
      expect(example).not.toContain('OPENROUTER_API_KEY');
      expect(manifest(tree).items).toEqual(['gemini']);
    });

    it('is idempotent', async () => {
      await expectIdempotent(runner, tree, { provider: 'gemini' });
    });
  });

  describe('--chat and --quota', () => {
    it('--chat needs auth-client', async () => {
      await expectAsync(
        runner.runSchematic('ai', { provider: 'openrouter', chat: true, skipInstall: true }, await createStarterTree(runner)),
      ).toBeRejectedWithError(/"ai --chat" needs "auth-client" first/);
    });

    it('--quota needs the chat', async () => {
      await expectAsync(
        runner.runSchematic('ai', { provider: 'openrouter', quota: true, skipInstall: true }, await withClientAuth(runner)),
      ).toBeRejectedWithError(/--quota/);
    });

    describe('with auth-client', () => {
      let chat: UnitTestTree;
      let quota: UnitTestTree;

      beforeAll(async () => {
        chat = await runner.runSchematic('ai', { provider: 'openrouter', chat: true, skipInstall: true }, await withClientAuth(runner));
        quota = await runner.runSchematic('ai', { quota: true, skipInstall: true }, chat.branch());
      });

      it('adds the chat module, entities, migration and prompts', () => {
        for (const f of ['ai-chat.controller', 'ai-chat.service', 'ai-chat.module', 'ai-prompts.service', 'ai-chat.quota', 'dto/ai-chat.dto']) {
          expect(chat.exists(`/apps/api/src/modules/ai/chat/${f}.ts`)).withContext(f).toBeTrue();
        }
        expect(chat.exists('/apps/api/src/modules/ai/chat/prompts/default.md')).toBeTrue();
        const controller = chat.readContent('/apps/api/src/modules/ai/chat/ai-chat.controller.ts');
        expect(controller).toContain("from '../../../client-auth';");
        expect(controller).toContain("@ApiProduces('text/event-stream')");
        expect(chat.readContent(API_MODULE)).toContain("import { AiChatModule } from './modules/ai/chat/ai-chat.module';");
        const entities = chat.readContent('/libs/database/src/entities/index.ts');
        expect(entities).toContain("export * from './ai-chat-session.entity';");
        expect(entities).toContain("export * from './ai-chat-message.entity';");
        const { file, ts } = migration(chat, 'ai-chat');
        expect(chat.readContent(file)).toContain(`export class AiChat${ts} implements MigrationInterface`);
        expect(Number(ts)).toBeGreaterThan(Number(migration(chat, 'ai-logs').ts));
        const cli = JSON.parse(chat.readContent('/nest-cli.json'));
        expect(cli.projects.api.compilerOptions.assets).toContain({ include: 'modules/ai/chat/prompts/*.md', watchAssets: true });
        expect(chat.readContent('/.env.example')).toContain('\nAI_CHAT_HISTORY=20\n');
        expect(manifest(chat).options).toEqual({ chat: true });
        expect(chat.exists('/apps/api/src/modules/ai/quota/ai-quota.service.ts')).toBeFalse();
      });

      it('adds the quota to an installed chat', () => {
        for (const f of ['ai-quota.service', 'ai-quota.module', 'ai-usage.controller', 'ai-usage.dto']) {
          expect(quota.exists(`/apps/api/src/modules/ai/quota/${f}.ts`)).withContext(f).toBeTrue();
        }
        expect(quota.readContent(API_MODULE)).toContain("import { AiQuotaModule } from './modules/ai/quota/ai-quota.module';");
        expect(quota.readContent('/apps/api/src/modules/ai/quota/ai-quota.module.ts')).toContain('provide: AI_CHAT_QUOTA');
        const { file, ts } = migration(quota, 'ai-quota');
        expect(quota.readContent(file)).toContain(`export class AiQuota${ts} implements MigrationInterface`);
        const example = quota.readContent('/.env.example');
        expect(example).toContain('\nAI_DAILY_MESSAGES=50\n');
        expect(example).toContain('\nAI_MONTHLY_TOKENS=500000\n');
        expect(manifest(quota).options).toEqual({ chat: true, quota: true });
        expect(migration(quota, 'ai-chat').ts).toBe(migration(chat, 'ai-chat').ts);
      });

      it('adds the admin usage route (ai.read) over the quota tables, without a new migration', () => {
        const dir = '/apps/api/src/modules/ai/quota';
        const controller = quota.readContent(`${dir}/ai-usage-admin.controller.ts`);
        expect(controller).toContain("@AdminResource('ai', { read: ['ai.read'] })");
        expect(controller).toContain("@Get('usage')");
        expect(controller).not.toContain('@Post');
        expect(quota.readContent(`${dir}/ai-quota.module.ts`)).toMatch(/controllers: \[AiUsageController, AiAdminQuotaController\]/);
        expect(quota.readContent(`${dir}/ai-usage-admin.service.ts`)).toContain('this.quota.usage(query.userId)');
        expect(quota.exists(`${dir}/ai-usage-admin.service.spec.ts`)).toBeTrue();
        expect(chat.exists(`${dir}/ai-usage-admin.controller.ts`)).toBeFalse();
        const migrations = (t: UnitTestTree) => t.files.filter((f) => /migrations\/\d{13}-ai-/.test(f)).length;
        expect(migrations(quota)).toBe(migrations(chat) + 1); // ai-quota only: the usage route reads existing tables
      });

      it('installs chat and quota in one run like in two', async () => {
        const once = await runner.runSchematic('ai', { provider: 'openrouter', chat: true, quota: true, skipInstall: true }, await withClientAuth(runner));
        const norm = (t: UnitTestTree) => {
          const out = new Map<string, string>();
          snapshot(t).forEach((content, path) => out.set(path.replace(/\d{13}/g, '<ts>'), content.replace(/\d{13}/g, '<ts>')));
          return out;
        };
        expect(norm(once)).toEqual(norm(quota));
      });

      it('is idempotent', async () => {
        await expectIdempotent(runner, chat, { chat: true });
        await expectIdempotent(runner, quota, { chat: true, quota: true });
        await expectIdempotent(runner, quota, { provider: 'openrouter' });
      });

      it('adds gemini to a project with chat and quota', async () => {
        const both = await runner.runSchematic('ai', { provider: 'gemini', skipInstall: true }, quota.branch());
        expect(both.readContent(PROVIDERS)).toContain('  OpenRouterProvider,\n  GeminiProvider,\n  // @ns:ai-providers');
        expect(manifest(both)).toEqual(jasmine.objectContaining({ options: { chat: true, quota: true }, items: ['gemini', 'openrouter'] }));
        await expectIdempotent(runner, both, { provider: 'gemini', chat: true, quota: true });
      });
    });
  });
});
