import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeviceInfo, RevokeReason, TokenPair, TtlCache } from '@app/common';
import { User, UserSession } from '@app/database';
import { SessionDto } from '../auth/dto/auth-response.dto';
import { UserPrincipal } from './client-auth.types';
import { ClientAuthResponseDto, UpdateMeDto } from './dto/client-auth.dto';
import { ClientUserDto, toClientUser } from './dto/client-user.dto';
import { UserSessionsService } from './user-sessions.service';

/** How long the guard trusts a checked session before reading it again. */
const SESSION_CACHE_MS = 30_000;

/**
 * Sessions of client users: starting one after a sign-in method proved who
 * the user is, refresh rotation, the guard's check, and the current user's
 * own sessions. Sign-in methods (phone, email, Google...) call `startSession()`.
 */
@Injectable()
export class ClientAuthService {
  private readonly cache = new TtlCache<string, UserPrincipal>(SESSION_CACHE_MS);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly sessions: UserSessionsService,
  ) {
    sessions.onRevoke((ids) => ids.forEach((id) => this.cache.delete(id)));
  }

  /** New session (device) for a user who just signed in. Blocked users get 403. */
  async startSession(user: User, device: DeviceInfo, isNew = false): Promise<ClientAuthResponseDto> {
    if (user.isBlocked) throw new ForbiddenException('This account is blocked');
    const { tokens } = await this.sessions.create(user.id, device);
    user.lastLoginAt = new Date();
    await this.users.update(user.id, { lastLoginAt: user.lastLoginAt });
    return this.response(user, tokens, isNew);
  }

  /** Rotates the refresh token (reuse of an old one revokes the session). */
  async refresh(refreshToken: string, device: DeviceInfo): Promise<ClientAuthResponseDto> {
    const { session, tokens } = await this.sessions.rotate(refreshToken, device);
    const user = await this.activeUser(session);
    return this.response(user, tokens, false);
  }

  /**
   * Guard check: signature, expiry and `typ: 'user'` of the access token
   * (signed with USER_JWT_SECRET, so admin tokens fail here), then a live
   * session of an active user. Cached per session for 30s; revoking through
   * this process evicts the entry at once.
   */
  async authenticate(accessToken: string): Promise<UserPrincipal> {
    const payload = await this.sessions.verifyAccess(accessToken);
    const cached = this.cache.get(payload.sid);
    if (cached) {
      if (cached.id !== payload.sub) throw new UnauthorizedException('Invalid token');
      return cached;
    }
    const session = await this.sessions.findActive(payload.sid);
    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedException('Session expired or revoked');
    }
    await this.activeUser(session);
    const principal: UserPrincipal = { id: session.userId, sessionId: session.id };
    this.cache.set(session.id, principal, Math.min(SESSION_CACHE_MS, session.expiresAt.getTime() - Date.now()));
    await this.sessions.touch(session.id);
    return principal;
  }

  // ── current user ─────────────────────────────────────────────────────

  async me(principal: UserPrincipal): Promise<ClientUserDto> {
    return toClientUser(await this.findUser(principal.id));
  }

  async updateMe(principal: UserPrincipal, dto: UpdateMeDto): Promise<ClientUserDto> {
    const patch: Partial<Pick<User, 'name' | 'language'>> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.language !== undefined) patch.language = dto.language;
    if (Object.keys(patch).length) await this.users.update(principal.id, patch);
    return this.me(principal);
  }

  async signOut(principal: UserPrincipal): Promise<void> {
    await this.sessions.revoke(principal.sessionId, 'sign_out', principal.id);
  }

  signOutAll(principal: UserPrincipal): Promise<number> {
    return this.sessions.revokeAll(principal.id, 'sign_out_all');
  }

  async listSessions(userId: string, currentSessionId?: string): Promise<SessionDto[]> {
    const rows = await this.sessions.list(userId);
    return rows.map((s) => toUserSessionDto(s, s.id === currentSessionId));
  }

  async revokeSession(userId: string, sessionId: string, reason: RevokeReason): Promise<void> {
    if (!(await this.sessions.revoke(sessionId, reason, userId))) {
      throw new NotFoundException('Session not found or already ended');
    }
  }

  revokeOtherSessions(principal: UserPrincipal): Promise<number> {
    return this.sessions.revokeAll(principal.id, 'revoked', principal.sessionId);
  }

  async setPushToken(principal: UserPrincipal, token: string, platform: string | null): Promise<void> {
    await this.sessions.setPushToken(principal.sessionId, token, platform);
  }

  /** Drops cached sessions of one user (blocked, deleted). */
  invalidateUser(userId: string): void {
    this.cache.deleteWhere((p) => p.id === userId);
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private async findUser(id: string): Promise<User> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new UnauthorizedException('Account is not active');
    return user;
  }

  private async activeUser(session: UserSession): Promise<User> {
    const user = await this.users.findOne({ where: { id: session.userId } });
    if (!user || user.isBlocked) {
      await this.sessions.revoke(session.id, user ? 'blocked' : 'deleted');
      throw new UnauthorizedException('Account is not active');
    }
    return user;
  }

  private response(user: User, tokens: TokenPair, isNew: boolean): ClientAuthResponseDto {
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: toClientUser(user),
      isNew,
    };
  }
}

export function toUserSessionDto(session: UserSession, isCurrent: boolean): SessionDto {
  return {
    id: session.id,
    deviceId: session.deviceId,
    deviceName: session.deviceName,
    platform: session.platform,
    os: session.os,
    appVersion: session.appVersion,
    ip: session.ip,
    userAgent: session.userAgent,
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt,
    expiresAt: session.expiresAt,
    isCurrent,
  };
}
