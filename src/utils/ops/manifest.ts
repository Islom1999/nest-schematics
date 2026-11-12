import { SchematicsException, Tree } from '@angular-devkit/schematics';
import { readText, writeText } from './text';

/** `nest-schematics.json` at the project root: which add-ons are installed and how. */
export interface Manifest {
  $schema?: string;
  /** Version of nest-schematics that created the project. */
  version: string;
  features: Record<string, ManifestFeature>;
}

export interface ManifestFeature {
  /** nest-schematics version that installed or last updated the feature. */
  version: string;
  /** Options the feature was installed with (e.g. `{ storage: 's3' }`). */
  options?: Record<string, unknown>;
  /** Sub-items, e.g. installed payment providers or CRUD resources. */
  items?: string[];
}

export const MANIFEST_FILE = 'nest-schematics.json';

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const PACKAGE_VERSION: string = require('../../../package.json').version;

function manifestPath(root: string): string {
  return `${root ? `${root}/` : ''}${MANIFEST_FILE}`;
}

export function readManifest(tree: Tree, root = ''): Manifest | null {
  const path = manifestPath(root);
  return tree.exists(path) ? (JSON.parse(readText(tree, path)) as Manifest) : null;
}

export function writeManifest(tree: Tree, manifest: Manifest, root = ''): void {
  writeText(tree, manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function hasFeature(tree: Tree, feature: string, root = ''): boolean {
  return !!readManifest(tree, root)?.features[feature];
}

/** Throws a readable error unless every feature in `required` is installed. */
export function requireFeatures(tree: Tree, by: string, required: string[], root = ''): void {
  const missing = required.filter((f) => !hasFeature(tree, f, root));
  if (missing.length) {
    throw new SchematicsException(
      `"${by}" needs ${missing.map((m) => `"${m}"`).join(', ')} first:\n` +
        missing.map((m) => `  npm run g -- ${m}`).join('\n'),
    );
  }
}

/**
 * Records a feature. Options are merged; `item` is added to `items` once.
 * Creates the manifest for projects made before it existed.
 */
export function recordFeature(
  tree: Tree,
  feature: string,
  options: Record<string, unknown> = {},
  item?: string,
  root = '',
): void {
  const manifest = readManifest(tree, root) ?? { version: PACKAGE_VERSION, features: {} };
  const current = manifest.features[feature] ?? { version: PACKAGE_VERSION };
  const items = new Set(current.items ?? []);
  if (item) items.add(item);
  manifest.features[feature] = {
    version: PACKAGE_VERSION,
    ...(Object.keys({ ...current.options, ...options }).length ? { options: { ...current.options, ...options } } : {}),
    ...(items.size ? { items: [...items].sort() } : {}),
  };
  manifest.features = Object.fromEntries(Object.entries(manifest.features).sort(([a], [b]) => a.localeCompare(b)));
  writeManifest(tree, manifest, root);
}
