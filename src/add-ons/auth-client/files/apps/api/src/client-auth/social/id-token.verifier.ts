import { createHash, timingSafeEqual } from 'node:crypto';
import { Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, errors, JWTPayload, jwtVerify } from 'jose';

/** A provider that signs OpenID Connect ID tokens with keys published as JWKS. */
export interface IdTokenProvider {
  name: string;
  jwksUrl: string;
  issuers: string[];
  /** Env key with the comma separated client IDs (the accepted `aud` values). */
  clientIdsEnv: string;
}

/** What a sign-in method needs from a verified ID token. */
export interface SocialProfile {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/** `a, b ,c` -> ['a', 'b', 'c'] */
export function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Providers send `email_verified` as a boolean or as the string "true". */
export function claimIsTrue(value: unknown): boolean {
  return value === true || value === 'true';
}

function claimString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Verifies ID tokens of one provider: signature against the provider's JWKS
 * (fetched and cached by `jose`), `iss`, `aud` (one of the client IDs), `exp`
 * and `iat`. A JWKS that cannot be fetched is a 503, a bad token a 401.
 */
export class IdTokenVerifier {
  private readonly logger: Logger;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly provider: IdTokenProvider,
    private readonly audiences: string[],
  ) {
    this.logger = new Logger(`${provider.name}IdToken`);
    this.jwks = createRemoteJWKSet(new URL(provider.jwksUrl), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
  }

  get configured(): boolean {
    return this.audiences.length > 0;
  }

  /**
   * @param nonce Optional raw nonce the app generated for this sign-in; the
   *   token must then carry it (or its SHA-256 hex, as Apple's iOS flow does).
   */
  async verify(idToken: string, nonce?: string): Promise<SocialProfile> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        `${this.provider.name} sign-in is not configured (set ${this.provider.clientIdsEnv})`,
      );
    }
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, this.jwks, {
        issuer: this.provider.issuers,
        audience: this.audiences,
        requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: 30,
      }));
    } catch (error) {
      if (error instanceof errors.JWKSTimeout || !(error instanceof errors.JOSEError)) {
        this.logger.error(`Could not load the ${this.provider.name} signing keys`);
        throw new ServiceUnavailableException(`${this.provider.name} sign-in is temporarily unavailable`);
      }
      throw new UnauthorizedException(`Invalid ${this.provider.name} token`);
    }

    if (nonce !== undefined) {
      const claim = claimString(payload.nonce);
      const hashed = createHash('sha256').update(nonce).digest('hex');
      if (!claim || !(safeEqual(claim, nonce) || safeEqual(claim, hashed))) {
        throw new UnauthorizedException(`Invalid ${this.provider.name} token nonce`);
      }
    }

    const sub = claimString(payload.sub);
    if (!sub) throw new UnauthorizedException(`Invalid ${this.provider.name} token`);
    const email = claimString(payload.email)?.toLowerCase() ?? null;
    return {
      sub,
      email,
      emailVerified: email !== null && claimIsTrue(payload.email_verified),
      name: claimString(payload.name),
    };
  }
}
