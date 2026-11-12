import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import {
  DeepPartial,
  FindOptionsOrder,
  FindOptionsSelect,
  FindOptionsWhere,
  In,
  IsNull,
  LessThan,
  MoreThan,
  Repository,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AuthSessionBase } from '@app/database';
import { DeviceInfo } from './device-info';
import { randomToken, sha256 } from './hash';

/** Access token payload: who (`sub`), which session/device (`sid`) and which audience (`typ`). */
export interface SessionTokenPayload {
  sub: string;
  sid: string;
  typ: string;
}

interface RefreshTokenPayload extends SessionTokenPayload {
  /** Random nonce: every rotation yields a distinct token (and hash). */
  jti: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
}

export interface SessionManagerOptions {
  /** Token audience written to `typ` and required on verify: `'admin'`, `'user'`. */
  typ: string;
  /** Property of the session entity holding the owner id, e.g. `'adminId'`. */
  ownerKey: string;
  accessSecret: string;
  refreshSecret: string;
  /** Seconds. */
  accessTtl: number;
  /** Seconds; also the session lifetime, moved forward on every refresh. */
  refreshTtl: number;
  /** Max active sessions per owner; the oldest are revoked beyond it. */
  limit: number;
  /** Revoked/expired rows older than this many days are deleted. Default 30. */
  retentionDays?: number;
}

/** Why a session ended (stored in `revoke_reason`). */
export type RevokeReason =
  | 'sign_out'
  | 'sign_out_all'
  | 'revoked'
  | 'revoked_by_admin'
  | 'refresh_reuse'
  | 'session_limit'
  | 'replaced'
  | 'password_changed'
  | 'blocked'
  | 'deleted';

/** A session that was just revoked. */
export interface RevokedSession {
  id: string;
  ownerId: string;
}

export type RevokeListener = (sessionIds: string[], sessions: RevokedSession[]) => void | Promise<void>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALGORITHM = 'HS256';

/**
 * Session (= device) logic shared by admin auth and the auth-client add-on.
 * Owns the token format and the session table; the caller owns accounts,
 * passwords and permissions.
 *
 * - Access token (short) `{ sub, sid, typ }` signed with `accessSecret`.
 * - Refresh token (long) `{ sub, sid, typ, jti }` signed with `refreshSecret`;
 *   only its sha256 is stored. Every refresh rotates it. Presenting an older or
 *   unknown refresh token of a live session revokes that session (token theft).
 * - At most `limit` active sessions per owner; a new sign-in from the same
 *   `deviceId` replaces that device's previous session.
 * - `onRevoke` listeners are told the revoked sessions (cache eviction); they
 *   are awaited, so a shared cache is cleared before the revoke call returns.
 */
export class SessionManager<S extends AuthSessionBase> {
  private readonly revokeListeners: RevokeListener[] = [];

  constructor(
    protected readonly repository: Repository<S>,
    protected readonly jwt: JwtService,
    readonly options: SessionManagerOptions,
  ) {}

  /** Called with the ids (and owners) of sessions revoked through this manager. */
  onRevoke(listener: RevokeListener): void {
    this.revokeListeners.push(listener);
  }

  ownerOf(session: S): string {
    return (session as unknown as Record<string, string>)[this.options.ownerKey];
  }

  /** New session for a freshly authenticated owner. */
  async create(ownerId: string, device: DeviceInfo): Promise<{ session: S; tokens: TokenPair }> {
    if (device.deviceId) {
      await this.revokeWhere({ [this.options.ownerKey]: ownerId, deviceId: device.deviceId }, 'replaced');
    }
    const id = randomUUID();
    const tokens = await this.issue(ownerId, id);
    const now = new Date();
    const session = this.repository.create({
      ...device,
      id,
      [this.options.ownerKey]: ownerId,
      refreshHash: sha256(tokens.refreshToken),
      lastUsedAt: now,
      expiresAt: this.refreshExpiry(now),
    } as DeepPartial<S>);
    await this.repository.insert(session as QueryDeepPartialEntity<S>);
    await this.enforceLimit(ownerId);
    await this.purge(ownerId);
    return { session, tokens };
  }

  /**
   * Refresh rotation: verifies the refresh token, swaps its hash atomically
   * and returns a new pair. A token that is validly signed for a live session
   * but is not its current one (already rotated, or forged with a leaked
   * secret) revokes the session.
   */
  async rotate(refreshToken: string, device: DeviceInfo): Promise<{ session: S; tokens: TokenPair }> {
    const payload = await this.verify(refreshToken, 'refresh');
    const session = await this.findActive(payload.sid);
    if (!session || this.ownerOf(session) !== payload.sub) {
      throw new UnauthorizedException('Session expired or revoked');
    }
    return this.replaceRefresh(session, device, sha256(refreshToken));
  }

  /**
   * New pair for an existing live session without a refresh token (the
   * caller already verified an access token of this session). The previous
   * refresh token stops working.
   */
  async reissue(session: S, device: DeviceInfo): Promise<{ session: S; tokens: TokenPair }> {
    return this.replaceRefresh(session, device);
  }

  /** Verifies an access token's signature, expiry and audience. Throws 401. */
  verifyAccess(token: string): Promise<SessionTokenPayload> {
    return this.verify(token, 'access');
  }

  /** The session if it exists, is not revoked and not expired. */
  async findActive(sessionId: string): Promise<S | null> {
    if (!UUID.test(sessionId)) return null;
    return this.repository.findOne({
      where: this.where({ id: sessionId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) }),
    });
  }

  /** Active sessions of an owner, most recently used first. */
  list(ownerId: string): Promise<S[]> {
    return this.repository.find({
      where: this.where({ [this.options.ownerKey]: ownerId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) }),
      order: { lastUsedAt: 'DESC' } as FindOptionsOrder<S>,
    });
  }

  /** Marks the session as used now (call at most every few seconds per session). */
  async touch(sessionId: string, ip?: string): Promise<void> {
    const patch: Record<string, unknown> = { lastUsedAt: new Date() };
    if (ip) patch.ip = ip;
    await this.repository.update(this.where({ id: sessionId }), patch as QueryDeepPartialEntity<S>);
  }

  /** Revokes one session (of `ownerId`, when given). Returns false if it was not active. */
  async revoke(sessionId: string, reason: RevokeReason, ownerId?: string): Promise<boolean> {
    if (!UUID.test(sessionId)) return false;
    const where: Record<string, unknown> = { id: sessionId };
    if (ownerId) where[this.options.ownerKey] = ownerId;
    return (await this.revokeWhere(where, reason)).length > 0;
  }

  /** Revokes every active session of an owner, optionally keeping one. Returns how many. */
  async revokeAll(ownerId: string, reason: RevokeReason, exceptSessionId?: string): Promise<number> {
    const ids = await this.revokeWhere({ [this.options.ownerKey]: ownerId }, reason, exceptSessionId);
    return ids.length;
  }

  // ── internals ────────────────────────────────────────────────────────

  private async replaceRefresh(session: S, device: DeviceInfo, expectedHash?: string) {
    const ownerId = this.ownerOf(session);
    const tokens = await this.issue(ownerId, session.id);
    const now = new Date();
    const patch: Record<string, unknown> = {
      refreshHash: sha256(tokens.refreshToken),
      lastUsedAt: now,
      expiresAt: this.refreshExpiry(now),
      ip: device.ip,
      userAgent: device.userAgent,
    };
    for (const key of ['deviceName', 'platform', 'os', 'appVersion'] as const) {
      if (device[key]) patch[key] = device[key];
    }
    const where: Record<string, unknown> = { id: session.id, revokedAt: IsNull() };
    if (expectedHash) where.refreshHash = expectedHash;
    // Compare-and-swap: of two requests with the same refresh token only one wins.
    const result = await this.repository.update(this.where(where), patch as QueryDeepPartialEntity<S>);
    if (!result.affected) {
      if (expectedHash) {
        await this.revoke(session.id, 'refresh_reuse');
        throw new UnauthorizedException('Refresh token was already used; the session has been revoked');
      }
      throw new UnauthorizedException('Session expired or revoked');
    }
    return { session: Object.assign(session, patch), tokens };
  }

  private async issue(ownerId: string, sessionId: string): Promise<TokenPair> {
    const { typ, accessSecret, refreshSecret, accessTtl, refreshTtl } = this.options;
    const access: SessionTokenPayload = { sub: ownerId, sid: sessionId, typ };
    const refresh: RefreshTokenPayload = { ...access, jti: randomToken(16) };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(access, { secret: accessSecret, expiresIn: accessTtl, algorithm: ALGORITHM }),
      this.jwt.signAsync(refresh, { secret: refreshSecret, expiresIn: refreshTtl, algorithm: ALGORITHM }),
    ]);
    return { accessToken, refreshToken, expiresIn: accessTtl };
  }

  private async verify(token: string, kind: 'access' | 'refresh'): Promise<SessionTokenPayload> {
    const secret = kind === 'access' ? this.options.accessSecret : this.options.refreshSecret;
    let payload: Partial<RefreshTokenPayload>;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, { secret, algorithms: [ALGORITHM] });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const { sub, sid, typ, jti } = payload;
    if (
      typeof typ !== 'string' ||
      typ !== this.options.typ ||
      typeof sub !== 'string' ||
      typeof sid !== 'string' ||
      (kind === 'refresh' && typeof jti !== 'string')
    ) {
      throw new UnauthorizedException('Invalid token');
    }
    return { sub, sid, typ };
  }

  private refreshExpiry(from: Date): Date {
    return new Date(from.getTime() + this.options.refreshTtl * 1000);
  }

  private async revokeWhere(where: Record<string, unknown>, reason: RevokeReason, exceptId?: string): Promise<string[]> {
    const rows = await this.repository.find({
      select: { id: true, [this.options.ownerKey]: true } as FindOptionsSelect<S>,
      where: this.where({ ...where, revokedAt: IsNull() }),
    });
    const revoked = rows.filter((r) => r.id !== exceptId).map((r) => ({ id: r.id, ownerId: this.ownerOf(r) }));
    const ids = revoked.map((r) => r.id);
    if (!ids.length) return [];
    const patch: Record<string, unknown> = { revokedAt: new Date(), revokeReason: reason };
    await this.repository.update(this.where({ id: In(ids) }), patch as QueryDeepPartialEntity<S>);
    for (const listener of this.revokeListeners) await listener(ids, revoked);
    return ids;
  }

  private async enforceLimit(ownerId: string): Promise<void> {
    const active = await this.repository.find({
      select: { id: true } as FindOptionsSelect<S>,
      where: this.where({ [this.options.ownerKey]: ownerId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) }),
      order: { createdAt: 'DESC' } as FindOptionsOrder<S>,
    });
    const extra = active.slice(Math.max(1, this.options.limit)).map((s) => s.id);
    if (extra.length) await this.revokeWhere({ id: In(extra) }, 'session_limit');
  }

  /** Deletes this owner's sessions that ended more than `retentionDays` ago. */
  private async purge(ownerId: string): Promise<void> {
    const cutoff = new Date(Date.now() - (this.options.retentionDays ?? 30) * 86_400_000);
    const owner = { [this.options.ownerKey]: ownerId };
    await this.repository.delete(this.where({ ...owner, expiresAt: LessThan(cutoff) }));
    await this.repository.delete(this.where({ ...owner, revokedAt: LessThan(cutoff) }));
  }

  private where(conditions: Record<string, unknown>): FindOptionsWhere<S> {
    return conditions as FindOptionsWhere<S>;
  }
}
