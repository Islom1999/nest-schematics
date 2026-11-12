import type { OpenAPIObject } from '@nestjs/swagger';

/** One OpenAPI document served at `/docs/<name>` and exported to `openapi/<name>.json`. */
export interface SwaggerDocumentSpec {
  name: string;
  title: string;
  description?: string;
  /**
   * Route prefixes after the global prefix: `'admin'` takes `/api/admin` and
   * `/api/admin/...`. The longest matching prefix of all documents wins, so
   * `'auth/client'` in one document beats `'auth'` in another.
   */
  prefixes: string[];
  /** Takes every route that no prefix claims. */
  fallback?: boolean;
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

/** Name of the document that owns `path` (e.g. `/api/admin/product/{id}`), or null. */
export function documentForPath(path: string, specs: SwaggerDocumentSpec[], globalPrefix = ''): string | null {
  let route = trimSlashes(path);
  const prefix = trimSlashes(globalPrefix);
  if (prefix && (route === prefix || route.startsWith(`${prefix}/`))) route = trimSlashes(route.slice(prefix.length));

  let best: { name: string; length: number } | null = null;
  for (const spec of specs) {
    for (const raw of spec.prefixes) {
      const candidate = trimSlashes(raw);
      if (!candidate || !(route === candidate || route.startsWith(`${candidate}/`))) continue;
      if (!best || candidate.length > best.length) best = { name: spec.name, length: candidate.length };
    }
  }
  return best?.name ?? specs.find((s) => s.fallback)?.name ?? null;
}

/** Every `#/components/schemas/<name>` referenced anywhere in `value`. */
function collectSchemaRefs(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaRefs(item, into);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string' && child.startsWith('#/components/schemas/')) {
        into.add(child.slice('#/components/schemas/'.length));
      } else {
        collectSchemaRefs(child, into);
      }
    }
  }
}

/** Keeps only the component schemas reachable from the paths. */
function pruneSchemas(document: OpenAPIObject): void {
  const schemas = document.components?.schemas;
  if (!schemas) return;
  const used = new Set<string>();
  collectSchemaRefs(document.paths, used);
  const queue = [...used];
  while (queue.length) {
    const nested = new Set<string>();
    collectSchemaRefs(schemas[queue.pop()!], nested);
    for (const name of nested) {
      if (!used.has(name)) {
        used.add(name);
        queue.push(name);
      }
    }
  }
  for (const name of Object.keys(schemas)) if (!used.has(name)) delete schemas[name];
}

/**
 * Object keys sorted recursively, so exported files diff cleanly. Arrays and
 * the order of a schema's `properties` (declaration order = form field
 * order in generated UIs) are kept.
 */
export function sortOpenApi<T>(value: T, keepOrder = false): T {
  if (Array.isArray(value)) return value.map((item) => sortOpenApi(item)) as T;
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>);
  if (!keepOrder) entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([key, child]) => [key, sortOpenApi(child, key === 'properties')])) as T;
}

/** Splits one full document into one document per spec (paths, used schemas and tags only). */
export function splitDocument(
  document: OpenAPIObject,
  specs: SwaggerDocumentSpec[],
  globalPrefix = '',
): Record<string, OpenAPIObject> {
  const result: Record<string, OpenAPIObject> = {};
  for (const spec of specs) {
    const part = JSON.parse(JSON.stringify(document)) as OpenAPIObject;
    part.info = { ...part.info, title: spec.title, description: spec.description ?? part.info.description };
    part.paths = Object.fromEntries(
      Object.entries(document.paths).filter(([path]) => documentForPath(path, specs, globalPrefix) === spec.name),
    ) as OpenAPIObject['paths'];
    pruneSchemas(part);
    const tags = new Set<string>();
    for (const item of Object.values(part.paths)) {
      for (const method of HTTP_METHODS) {
        for (const tag of (item as Record<string, { tags?: string[] }>)[method]?.tags ?? []) tags.add(tag);
      }
    }
    if (part.tags) part.tags = part.tags.filter((t) => tags.has(t.name));
    result[spec.name] = sortOpenApi(JSON.parse(JSON.stringify(part)) as OpenAPIObject);
  }
  return result;
}

function operations(document: OpenAPIObject): { id?: string; where: string }[] {
  const list: { id?: string; where: string }[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = (item as Record<string, { operationId?: string }>)[method];
      if (operation) list.push({ id: operation.operationId, where: `${method.toUpperCase()} ${path}` });
    }
  }
  return list;
}

/** `operationId`s used by more than one route, as readable lines (empty = fine). */
export function findDuplicateOperationIds(document: OpenAPIObject): string[] {
  const byId = new Map<string, string[]>();
  for (const { id, where } of operations(document)) {
    if (!id) continue;
    byId.set(id, [...(byId.get(id) ?? []), where]);
  }
  return [...byId.entries()].filter(([, where]) => where.length > 1).map(([id, where]) => `${id}: ${where.join(', ')}`);
}

/**
 * Enums declared inline (no `enumName`), as `Schema.property` / `GET /path (param)`.
 * Generated clients turn each one into its own anonymous type.
 */
export function findInlineEnums(document: OpenAPIObject): string[] {
  const found: string[] = [];
  const visit = (value: unknown, where: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, where));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (Array.isArray(node.enum)) {
      found.push(where);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'properties' && child && typeof child === 'object') {
        for (const [prop, schema] of Object.entries(child)) visit(schema, `${where}.${prop}`);
      } else if (key === 'parameters' && Array.isArray(child)) {
        for (const param of child as { name?: string }[]) visit(param, `${where} (${param.name})`);
      } else {
        visit(child, where);
      }
    }
  };
  for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
    // A named enum is itself a component schema with `enum`: that is the good case.
    const node = schema as Record<string, unknown>;
    if (!Array.isArray(node.enum)) visit(schema, name);
  }
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = (item as Record<string, unknown>)[method];
      if (operation) visit(operation, `${method.toUpperCase()} ${path}`);
    }
  }
  return [...new Set(found)];
}
