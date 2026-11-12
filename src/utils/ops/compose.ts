import { Tree } from '@angular-devkit/schematics';
import { insertAtMarker, MARKERS } from './markers';
import { readText, writeText } from './text';

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

const indentWidth = (line: string): number => line.length - line.trimStart().length;
const isContent = (line: string): boolean => line.trim() !== '' && !line.trim().startsWith('#');

/** Index after the last content line of the block below `start` that is indented deeper than `indent`. */
function blockEnd(lines: string[], start: number, indent: number): number {
  let end = start + 1;
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (indentWidth(lines[i]) <= indent) break;
    end = i + 1;
  }
  return end;
}

/**
 * Adds an entry under `key` of an existing service in docker-compose.yml,
 * creating the key at the end of the service when it is missing. `entry` is
 * written relative to the key, e.g. `- tus-data:/srv/tusd-data` (volumes),
 * `TUS_DIR: /srv/tusd-data` (environment) or `tusd:\n  condition: service_started`
 * (depends_on). A map entry whose name is already there (`TUS_DIR:`), or an
 * identical list item, is left alone, so user edits survive re-runs.
 *
 * @returns false when nothing was added (entry present, no compose file or no such service).
 */
export function addComposeServiceEntry(tree: Tree, service: string, key: string, entry: string, root = ''): boolean {
  const path = `${root ? `${root}/` : ''}docker-compose.yml`;
  if (!tree.exists(path)) return false;
  const lines = readText(tree, path).split('\n');
  const services = lines.findIndex((l) => /^services:\s*$/.test(l));
  if (services < 0) return false;
  const servicesEnd = blockEnd(lines, services, 0);
  const serviceLine = lines.findIndex(
    (l, i) => i > services && i < servicesEnd && new RegExp(`^ {1,4}${service}:\\s*$`).test(l),
  );
  if (serviceLine < 0) return false;
  const serviceIndent = indentWidth(lines[serviceLine]);
  const serviceEnd = blockEnd(lines, serviceLine, serviceIndent);
  const firstProp = lines.slice(serviceLine + 1, serviceEnd).find(isContent);
  const propIndent = firstProp ? indentWidth(firstProp) : serviceIndent + 2;

  const entryLines = entry.replace(/\n+$/, '').split('\n');
  const head = entryLines[0].trim();
  const name = head.startsWith('-') ? null : (/^([^:\s]+):/.exec(head)?.[1] ?? null);
  const keyLine = lines.findIndex(
    (l, i) => i > serviceLine && i < serviceEnd && indentWidth(l) === propIndent && l.trim() === `${key}:`,
  );

  const toInsert: string[] = [];
  let insertAt: number;
  let childIndent: number;
  if (keyLine >= 0) {
    const keyEnd = blockEnd(lines, keyLine, propIndent);
    const firstChild = lines.slice(keyLine + 1, keyEnd).find(isContent);
    childIndent = firstChild ? indentWidth(firstChild) : propIndent + 2;
    const children = lines.slice(keyLine + 1, keyEnd).filter((l) => isContent(l) && indentWidth(l) === childIndent);
    if (children.some((l) => (name ? l.trim().startsWith(`${name}:`) : l.trim() === head))) return false;
    insertAt = keyEnd;
  } else {
    childIndent = propIndent + 2;
    insertAt = serviceEnd;
    toInsert.push(`${' '.repeat(propIndent)}${key}:`);
  }
  const base = indentWidth(entryLines[0]);
  for (const line of entryLines) {
    toInsert.push(line.trim() ? `${' '.repeat(childIndent)}${line.slice(Math.min(base, indentWidth(line)))}` : line);
  }
  lines.splice(insertAt, 0, ...toInsert);
  writeText(tree, path, lines.join('\n'));
  return true;
}
