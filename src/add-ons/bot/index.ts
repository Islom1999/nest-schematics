import { Rule, SchematicContext, Tree, apply, chain, move, noop, url } from '@angular-devkit/schematics';
import {
  addEnv,
  addNestApp,
  addPackageJson,
  getProject,
  mergeSafe,
  recordFeature,
  scheduleInstall,
} from '../../utils/ops';
import { Schema } from './schema';

/**
 * `npm run g -- bot`: apps/bot, a Telegram bot (telegraf, long polling) with
 * DatabaseModule. BOT_TOKEN empty = the bot stays off, so the project still
 * builds and boots without a token.
 */
export function bot(options: Schema): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const root = options.root ?? '';
    getProject(tree, root);

    const files = apply(url('./files'), [root ? move(root) : noop()]);

    const wire: Rule = (host: Tree) => {
      const result = addNestApp(host, 'bot', root);
      if (result.buildCustomised) {
        context.logger.warn('package.json "build" is customised: add "nest build bot" to it yourself.');
      }
      addPackageJson(host, { dependencies: { telegraf: '^4.16.3' } }, root);
      addEnv(
        host,
        {
          title: 'apps/bot (Telegram, telegraf)',
          vars: [{ key: 'BOT_TOKEN', value: '', comment: 'From @BotFather. Empty = bot disabled' }],
        },
        root,
      );
      recordFeature(host, 'bot', {}, undefined, root);
      scheduleInstall(context, options.skipInstall, root);
      return host;
    };

    return chain([
      mergeSafe(files, options.force),
      wire,
      (_host: Tree, ctx: SchematicContext) => {
        if (root) return;
        ctx.logger.info('Bot: set BOT_TOKEN in .env, then npm run start:dev:bot.');
      },
    ]);
  };
}
