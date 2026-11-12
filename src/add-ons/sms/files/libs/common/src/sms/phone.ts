/**
 * `+998 (90) 123-45-67` → `+998901234567`. Returns null unless the result is
 * `+` and 9 to 15 digits (E.164). Numbers without `+` are taken as already
 * including the country code.
 */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.trim().replace(/[\s().-]/g, '');
  const match = /^\+?(\d{9,15})$/.exec(compact);
  return match ? `+${match[1]}` : null;
}

/** `+998901234567` → `+99890***4567` for logs. */
export function maskPhone(phone: string): string {
  return phone.length > 8 ? `${phone.slice(0, 6)}***${phone.slice(-4)}` : '***';
}
