import { createHash, timingSafeEqual } from 'crypto';

/** Constant-time string comparison (hashes first, so lengths do not leak either). */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right) && a.length === b.length;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/** `::ffff:1.2.3.4` → `1.2.3.4`. */
export function normalizeIp(ip: string): string {
  return ip.trim().replace(/^::ffff:/i, '');
}

/**
 * Optional provider IP allowlist: an empty list allows everyone. Entries are
 * exact addresses or IPv4 CIDR ranges (`185.234.113.0/24`). The request IP
 * respects TRUST_PROXY (see main.ts).
 */
export function ipAllowed(allowList: readonly string[], ip: string): boolean {
  if (!allowList.length) return true;
  const address = normalizeIp(ip);
  return allowList.some((entry) => {
    const [base, bits] = entry.split('/');
    if (bits === undefined) return normalizeIp(base) === address;
    const prefix = Number(bits);
    const network = ipv4ToInt(base);
    const value = ipv4ToInt(address);
    if (network === null || value === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
    const size = 2 ** (32 - prefix);
    return Math.floor(network / size) === Math.floor(value / size);
  });
}
