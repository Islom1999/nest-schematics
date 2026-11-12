import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';

/** sha256 hex — for high-entropy secrets (refresh tokens, OTP lookups), not passwords. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** URL-safe random string with `bytes` bytes of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** argon2id hash of a password. */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

/**
 * Checks a password against an argon2 hash. With no hash (unknown account) it
 * still hashes once, so response time does not reveal whether the account exists.
 */
export async function verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
  if (!hash) {
    await argon2.hash(password, { type: argon2.argon2id });
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
