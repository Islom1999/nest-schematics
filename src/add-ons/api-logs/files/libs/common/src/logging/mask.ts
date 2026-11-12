export const MASK = '***';

/** Keys that contain one of these are always masked (`newPassword`, `idToken`, `clientSecret`, ...). */
const ALWAYS_MASKED = ['password', 'secret', 'token', 'authorization'];
const MAX_DEPTH = 8;
const MAX_ITEMS = 100;

function normalize(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** `isSecret(key)` for the given key list: exact match (normalized), or one of the always-masked words. */
export function secretKeyMatcher(keys: string[]): (key: string) => boolean {
  const exact = new Set(keys.map(normalize));
  return (key) => {
    const n = normalize(key);
    return exact.has(n) || ALWAYS_MASKED.some((word) => n.includes(word));
  };
}

/**
 * A JSON-safe copy of `value` with secret values replaced by `***`, at any
 * depth (objects, arrays, class instances). Binary data, functions, cycles and
 * very deep or long structures are summarised instead of copied.
 */
export function maskSecrets(value: unknown, isSecret: (key: string) => boolean): unknown {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return v ?? null;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'function' || typeof v === 'symbol') return undefined;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
    if (Buffer.isBuffer(v) || ArrayBuffer.isView(v)) return `[binary ${(v as ArrayBufferView).byteLength} bytes]`;
    const obj = v as object;
    if (seen.has(obj)) return '[circular]';
    if (depth >= MAX_DEPTH) return '[too deep]';
    seen.add(obj);
    try {
      if (Array.isArray(obj)) {
        const items = obj.slice(0, MAX_ITEMS).map((item) => walk(item, depth + 1));
        if (obj.length > MAX_ITEMS) items.push(`[+${obj.length - MAX_ITEMS} more]`);
        return items;
      }
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(obj)) {
        if (isSecret(key)) {
          out[key] = item === null || item === undefined || item === '' ? item ?? null : MASK;
        } else {
          const copy = walk(item, depth + 1);
          if (copy !== undefined) out[key] = copy;
        }
      }
      return out;
    } finally {
      seen.delete(obj);
    }
  };
  return walk(value, 0);
}

/**
 * Keeps a body under `maxBytes` of JSON. A larger one becomes
 * `{ _truncated: true, size, preview }` so the column still holds valid JSON.
 */
export function limitSize(value: unknown, maxBytes: number): unknown {
  if (value === undefined) return null;
  const json = JSON.stringify(value);
  if (json === undefined) return null;
  const size = Buffer.byteLength(json);
  if (!maxBytes || size <= maxBytes) return value;
  return { _truncated: true, size, preview: json.slice(0, maxBytes) };
}

/** Masks secret query parameters: `/x?token=abc&page=2` → `/x?token=***&page=2`. */
export function maskUrl(url: string, isSecret: (key: string) => boolean): string {
  const at = url.indexOf('?');
  if (at < 0) return url;
  const params = new URLSearchParams(url.slice(at + 1));
  let changed = false;
  for (const key of new Set(params.keys())) {
    if (isSecret(key)) {
      params.set(key, MASK);
      changed = true;
    }
  }
  return changed ? `${url.slice(0, at)}?${params.toString()}` : url;
}
