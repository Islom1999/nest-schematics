const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

/**
 * `'15m'` → 900, `'30d'` → 2592000, `'3600'` → 3600 (seconds).
 * Supported units: s, m, h, d, w. Throws on anything else so a typo in .env
 * fails at boot instead of issuing tokens with a surprising lifetime.
 */
export function parseDuration(value: string | number | undefined, fallback: string | number): number {
  const raw = value === undefined || value === null || value === '' ? fallback : value;
  if (typeof raw === 'number') return raw;
  const match = /^\s*(\d+)\s*([smhdw]?)\s*$/i.exec(raw);
  if (!match) throw new Error(`Invalid duration "${raw}" (use e.g. 900, 15m, 12h, 30d)`);
  const seconds = Number(match[1]) * UNITS[(match[2] || 's').toLowerCase()];
  if (seconds <= 0) throw new Error(`Duration must be positive: "${raw}"`);
  return seconds;
}
