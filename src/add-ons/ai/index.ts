import {
  apply,
  applyTemplates,
  chain,
  move,
  noop,
  Rule,
  SchematicContext,
  SchematicsException,
  Tree,
  url,
} from '@angular-devkit/schematics';
import { createHash } from 'crypto';
import {
  addBarrelExport,
  addEnv,
  addMigration,
  addModuleImport,
  addNamedImports,
  addNestAssets,
  addPermissions,
  EnvSection,
  getProject,
  insertAtMarker,
  mergeSafe,
  readManifest,
  recordFeature,
  requireFeatures,
  scheduleInstall,
} from '../../utils/ops';
import { AiProviderName, Schema } from './schema';

const MIGRATIONS_DIR = 'libs/database/src/migrations';
const PROVIDERS_INDEX = 'libs/common/src/ai/providers/index.ts';
export const AI_PROVIDERS_MARKER = '// @ns:ai-providers';
const PROMPTS_ASSET = 'modules/ai/chat/prompts/*.md';

interface ProviderSpec {
  className: string;
  file: string;
  env: EnvSection;
}

export const AI_PROVIDERS: Record<AiProviderName, ProviderSpec> = {
  openrouter: {
    className: 'OpenRouterProvider',
    file: './openrouter.provider',
    env: {
      title: 'AI: OpenRouter',
      vars: [
        { key: 'OPENROUTER_API_KEY', value: '', comment: 'https://openrouter.ai/keys (empty = AI calls answer 503 AI_NOT_CONFIGURED)' },
        { key: 'OPENROUTER_MODEL', value: 'google/gemini-2.5-flash-lite', comment: 'Default model (https://openrouter.ai/models)' },
        { key: 'OPENROUTER_IMAGE_MODEL', value: 'google/gemini-2.5-flash-image', comment: 'Model for AiService.image()' },
        { key: 'OPENROUTER_BASE_URL', value: 'https://openrouter.ai/api/v1' },
        { key: 'APP_URL', value: '', comment: 'Sent to OpenRouter as HTTP-Referer (app attribution); optional' },
        { key: 'APP_NAME', value: '', comment: 'Sent to OpenRouter as X-Title; optional' },
      ],
    },
  },
  gemini: {
    className: 'GeminiProvider',
    file: './gemini.provider',
    env: {
      title: 'AI: Gemini',
      vars: [
        { key: 'GEMINI_API_KEY', value: '', comment: 'https://aistudio.google.com/apikey (empty = AI calls answer 503 AI_NOT_CONFIGURED)' },
        { key: 'GEMINI_MODEL', value: 'gemini-2.5-flash-lite', comment: 'Default model' },
        { key: 'GEMINI_IMAGE_MODEL', value: 'gemini-2.5-flash-image', comment: 'Model for AiService.image()' },
        { key: 'GEMINI_BASE_URL', value: 'https://generativelanguage.googleapis.com/v1beta' },
      ],
    },
  },
};

/** TypeORM's DefaultNamingStrategy names, so `migration:generate` sees no difference. */
function typeormName(prefix: 'PK_' | 'IDX_', table: string, columns: string[]): string {
  const key = `${table}_${[...columns].sort().join('_')}`;
  return prefix + createHash('sha1').update(key).digest('hex').slice(0, prefix === 'PK_' ? 27 : 26);
}

/** Reuses the timestamp of an existing `<ts>-<name>.ts` migration so re-runs change nothing. */
function migrationTimestamp(tree: Tree, root: string, name: string, fallback: number): string {
  const re = new RegExp(`^(\\d{13})-${name}\\.ts$`);
  const dir = tree.getDir(root ? `${root}/${MIGRATIONS_DIR}` : MIGRATIONS_DIR);
  for (const file of dir.subfiles) {
    const match = re.exec(file);
    if (match) return match[1];
  }
  return String(fallback);
}

function templates(dir: string, root: string, vars: Record<string, unknown>, force?: boolean): Rule {
  return mergeSafe(apply(url(`./files/${dir}`), [applyTemplates(vars), root ? move(root) : noop()]), force);
}

/**
 * `npm run g -- ai openrouter|gemini [--chat] [--quota]`: AiService (generate,
 * stream, vision, json, image) over fetch-based providers with retries and
 * timeouts, `ai_logs` with tokens and cost, admin stats/logs (`ai.read`);
 * `--chat`: client chat sessions with SSE streaming (needs auth-client);
 * `--quota`: per-user daily message and monthly token limits.
 */
export function ai(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const root = options.root ?? '';
    const project = getProject(tree, root);
    const recorded = readManifest(tree, root)?.features['ai'];
    const provider = (options.provider ?? (recorded?.items?.[0] as AiProviderName | undefined) ?? 'openrouter') as AiProviderName;
    const spec = AI_PROVIDERS[provider];
    if (!spec) {
      throw new SchematicsException(`Unknown AI provider "${provider}". Use one of: ${Object.keys(AI_PROVIDERS).join(', ')}.`);
    }
    const chat = !!options.chat;
    const quota = !!options.quota;
    if (chat) requireFeatures(tree, 'ai --chat', ['auth-client'], root);
    if (quota && !chat && recorded?.options?.['chat'] !== true) {
      throw new SchematicsException(
        '"ai --quota" limits the AI chat: add it together with the chat ("npm run g -- ai --chat --quota", needs auth-client).',
      );
    }

    const now = Date.now();
    const ts = {
      logs: migrationTimestamp(tree, root, 'ai-logs', now),
      chat: migrationTimestamp(tree, root, 'ai-chat', now + 1),
      quota: migrationTimestamp(tree, root, 'ai-quota', now + 2),
    };
    const pk = (table: string) => typeormName('PK_', table, ['id']);
    const deleted = (table: string) => typeormName('IDX_', table, ['deleted_at']);

    const rules: Rule[] = [
      templates('core', root, { timestamp: ts.logs, pk: { aiLogs: pk('ai_logs') }, deletedIdx: { aiLogs: deleted('ai_logs') } }, options.force),
      templates(provider, root, {}, options.force),
    ];
    if (chat) {
      rules.push(
        templates(
          'chat',
          root,
          {
            timestamp: ts.chat,
            pk: { sessions: pk('ai_chat_sessions'), messages: pk('ai_chat_messages') },
            deletedIdx: { sessions: deleted('ai_chat_sessions'), messages: deleted('ai_chat_messages') },
          },
          options.force,
        ),
      );
    }
    if (quota) {
      rules.push(
        templates(
          'quota',
          root,
          {
            timestamp: ts.quota,
            pk: { daily: pk('ai_usage_daily'), monthly: pk('ai_usage_monthly') },
            deletedIdx: { daily: deleted('ai_usage_daily'), monthly: deleted('ai_usage_monthly') },
          },
          options.force,
        ),
      );
    }

    const wire: Rule = (host: Tree) => {
      const prefix = root ? `${root}/` : '';
      const entities = `${project.entitiesDir}/index.ts`;

      // Core: AiModule (global AiService), ai_logs, admin routes.
      addBarrelExport(host, entities, 'ai-log.entity');
      addBarrelExport(host, `${project.commonSrc}/index.ts`, 'ai');
      addMigration(host, `AiLogs${ts.logs}`, `${MIGRATIONS_DIR}/${ts.logs}-ai-logs`, root);
      addPermissions(host, 'ai', ['read', 'write'], root);
      addModuleImport(host, project.apiModule, 'AiModule', '@app/common');
      addModuleImport(host, project.apiModule, 'AiAdminModule', './modules/ai/ai-admin.module');
      addEnv(
        host,
        {
          title: 'AI',
          vars: [
            { key: 'AI_PROVIDER', value: provider, comment: 'Default provider of AiService calls (installed: see libs/common/src/ai/providers)' },
            { key: 'AI_TIMEOUT_MS', value: '60000', type: 'number', comment: 'Per attempt; for streams, the longest silence between chunks' },
            { key: 'AI_MAX_RETRIES', value: '2', type: 'number', comment: 'Extra attempts on 429 / 5xx / network errors (exponential backoff, Retry-After)' },
            { key: 'AI_LOG_BODIES', value: 'false', type: 'boolean', comment: 'Store prompts and answers in ai_logs (API keys are never stored)' },
            { key: 'AI_LOG_MAX_BODY', value: '16384', type: 'number', comment: 'Max stored body size (characters of JSON)' },
          ],
        },
        root,
      );

      // Provider.
      insertAtMarker(host, `${prefix}${PROVIDERS_INDEX}`, AI_PROVIDERS_MARKER, `${spec.className},`);
      addNamedImports(host, `${prefix}${PROVIDERS_INDEX}`, [{ name: spec.className, from: spec.file }]);
      addEnv(host, spec.env, root);

      if (chat) {
        addBarrelExport(host, entities, 'ai-chat-session.entity');
        addBarrelExport(host, entities, 'ai-chat-message.entity');
        addMigration(host, `AiChat${ts.chat}`, `${MIGRATIONS_DIR}/${ts.chat}-ai-chat`, root);
        addModuleImport(host, project.apiModule, 'AiChatModule', './modules/ai/chat/ai-chat.module');
        addNestAssets(host, 'api', { include: PROMPTS_ASSET, watchAssets: true }, root);
        addEnv(
          host,
          {
            title: 'AI chat',
            vars: [
              { key: 'AI_CHAT_PROVIDER', value: '', comment: 'Empty = AI_PROVIDER' },
              { key: 'AI_CHAT_MODEL', value: '', comment: "Empty = the provider's default model" },
              { key: 'AI_CHAT_HISTORY', value: '20', type: 'number', comment: 'Previous messages sent as context' },
              { key: 'AI_CHAT_MAX_TOKENS', value: '1024', type: 'number', comment: 'Max answer length (tokens)' },
              { key: 'AI_PROMPTS_DIR', value: '', comment: 'System prompts directory (default: modules/ai/chat/prompts, copied by nest build)' },
            ],
          },
          root,
        );
      }

      if (quota) {
        addBarrelExport(host, entities, 'ai-usage-daily.entity');
        addBarrelExport(host, entities, 'ai-usage-monthly.entity');
        addMigration(host, `AiQuota${ts.quota}`, `${MIGRATIONS_DIR}/${ts.quota}-ai-quota`, root);
        addModuleImport(host, project.apiModule, 'AiQuotaModule', './modules/ai/quota/ai-quota.module');
        addEnv(
          host,
          {
            title: 'AI quota',
            vars: [
              { key: 'AI_DAILY_MESSAGES', value: '50', type: 'number', comment: 'Chat messages per user per UTC day (0 = no limit)' },
              { key: 'AI_MONTHLY_TOKENS', value: '500000', type: 'number', comment: 'Tokens per user per UTC month (0 = no limit)' },
            ],
          },
          root,
        );
      }

      recordFeature(host, 'ai', { ...(chat ? { chat: true } : {}), ...(quota ? { quota: true } : {}) }, provider, root);
      scheduleInstall(context, options.skipInstall, root);
      return host;
    };

    return chain([
      ...rules,
      wire,
      (_host: Tree, ctx: SchematicContext) => {
        const key = spec.env.vars[0].key;
        ctx.logger.info(
          `AI (${provider}): set ${key} in .env, then "npm run migration:run". ` +
            'Admin: /api/admin/ai/stats, /api/admin/ai/logs/pagination (permission ai.read), POST /api/admin/ai/generate (ai.write)' +
            (chat ? '; chat: POST /api/client/ai/chat/stream (SSE)' : '') +
            (quota ? '; limits: AI_DAILY_MESSAGES, AI_MONTHLY_TOKENS' : '') +
            '.',
        );
      },
    ]);
  };
}
