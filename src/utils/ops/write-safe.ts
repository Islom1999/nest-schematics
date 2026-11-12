import { forEach, mergeWith, Rule, SchematicContext, Source, Tree, apply } from '@angular-devkit/schematics';

/**
 * Merges generated files into the project without clobbering user edits:
 * - new files are created;
 * - identical files are left alone;
 * - changed files are kept and reported, unless `force` is set.
 */
export function mergeSafe(source: Source, force = false): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const kept: string[] = [];
    const guarded = apply(source, [
      forEach((entry) => {
        if (!tree.exists(entry.path)) return entry;
        const current = tree.read(entry.path);
        if (current && current.equals(entry.content)) return null;
        if (force) {
          tree.overwrite(entry.path, entry.content);
        } else {
          kept.push(entry.path);
        }
        return null;
      }),
    ]);
    return (host: Tree, ctx: SchematicContext) => {
      const result = mergeWith(guarded)(host, ctx);
      if (kept.length) {
        context.logger.warn(
          `Kept ${kept.length} existing file(s) that differ from the template (use --force to overwrite):\n` +
            kept.map((p) => `  ${p.replace(/^\//, '')}`).join('\n'),
        );
      }
      return result;
    };
  };
}
