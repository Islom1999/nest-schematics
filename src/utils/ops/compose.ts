import { Tree } from '@angular-devkit/schematics';
import { insertAtMarker, MARKERS } from './markers';

/**
 * Adds a service (and its named volumes) to docker-compose.yml. `yaml` is the
 * service body without the name line, indented relative to the name, e.g.
 * `image: redis:7-alpine\nports:\n  - "6379:6379"`.
 *
 * @returns false when the service exists or the project has no compose file.
 */
export function addComposeService(tree: Tree, name: string, yaml: string, volumes: string[] = [], root = ''): boolean {
  const path = `${root ? `${root}/` : ''}docker-compose.yml`;
  if (!tree.exists(path)) return false;
  const body = yaml
    .replace(/\n+$/, '')
    .split('\n')
    .map((l) => (l ? `  ${l}` : l))
    .join('\n');
  const added = insertAtMarker(tree, path, MARKERS.composeServices, `${name}:\n${body}\n`, `\n  ${name}:\n`);
  for (const volume of volumes) {
    insertAtMarker(tree, path, MARKERS.composeVolumes, `${volume}:`, `\n  ${volume}:`);
  }
  return added;
}
