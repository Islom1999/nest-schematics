import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DeviceInfo,
  hashPassword,
  LoginAttemptLimiter,
  TokenPair,
  TtlCache,
  verifyPassword,
} from '@app/common';
import { Admin, AdminSession, normalizeEmail } from '@app/database';
import { AdminSessionsService } from './admin-sessions.service';
import { AdminPrincipal, AuthAdmin } from './auth.types';
import { AuthResponseDto, SessionDto } from './dto/auth-response.dto';

/** How long the guard trusts a checked session before reading it again. */
const SESSION_CACHE_MS = 30_000;

/**
 * Admin sign-in, token refresh, current-session operations and the guard's
 * session check.
 *
 * Brute force: failed sign-ins are counted per email + IP in memory; after 5
 * failures in 15 minutes that pair gets 429 until the window ends (also for
 * the right password). `change-password` is limited the same way per admin.
 * Route-level rate limiting can be added on top of this.
 */
@Injectable()
export class AuthService {
  private readonly cache = new TtlCache<string, AdminPrincipal>(SESSION_CACHE_MS);
  private readonly signInAttempts = new LoginAttemptLimiter(5, 15 * 60_000);

  constructor(
    @InjectRepository(Admin) private readonly admins: Repository<Admin>,
    private readonly sessions: AdminSessionsService,
  ) {
    sessions.onRevoke((ids) => ids.forEach((id) => this.cache.delete(id)));
  }

  // ── sign-in / tokens ─────────────────────────────────────────────────

  async signIn(email: string, password: string, device: DeviceInfo): Promise<AuthResponseDto> {
    const normalized = normalizeEmail(email);
    const key = `${normalized}|${device.ip}`;
    this.signInAttempts.assertAllowed(key);

    const admin = await this.admins
      .createQueryBuilder('admin')
      .addSelect('admin.passwordHash')
      .leftJoinAndSelect('admin.role', 'role')
      .where('admin.email = :email', { email: normalized })
      .getOne();
    const valid = await verifyPassword(admin?.passwordHash, password);
    if (!admin || !valid) {
      this.signInAttempts.fail(key);
      throw new UnauthorizedException('Invalid email or password');
    }
    this.signInAttempts.reset(key);
    if (admin.isBlocked) throw new ForbiddenException('This account is blocked');

    const { tokens } = await this.sessions.create(admin.id, device);
    await this.admins.update(admin.id, { lastLoginAt: new Date() });
    return this.response(admin, tokens);
  }

  /** Rotates the refresh token (reuse of an old one revokes the session). */
  async refresh(refreshToken: string, device: DeviceInfo): Promise<AuthResponseDto> {
    const { session, tokens } = await this.sessions.rotate(refreshToken, device);
    const admin = await this.activeAdmin(session);
    return this.response(admin, tokens);
  }

  /** Fuse `signInUsingToken()`: a valid access token of a live session → new pair, same session. */
  async signInWithToken(accessToken: string, device: DeviceInfo): Promise<AuthResponseDto> {
    const principal = await this.authenticate(accessToken);
    const session = await this.sessions.findActive(principal.sessionId);
    if (!session) throw new UnauthorizedException('Session expired or revoked');
    const { tokens } = await this.sessions.reissue(session, device);
    return { ...this.tokens(tokens), user: this.toAuthAdmin(principal) };
  }

  /**
   * Guard check: signature + expiry + audience of the access token, then the
   * session must be live and the admin active. The result is cached per
   * session for 30s; revoking through this process evicts it immediately.
   */
  async authenticate(accessToken: string): Promise<AdminPrincipal> {
    const payload = await this.sessions.verifyAccess(accessToken);
    const cached = this.cache.get(payload.sid);
    if (cached) {
      if (cached.id !== payload.sub) throw new UnauthorizedException('Invalid token');
      return cached;
    }

    const session = await this.sessions.findActive(payload.sid);
    if (!session || session.adminId !== payload.sub) {
      throw new UnauthorizedException('Session expired or revoked');
    }
    const admin = await this.activeAdmin(session);
    const principal: AdminPrincipal = { ...this.toAuthAdmin(admin), sessionId: session.id };
    this.cache.set(session.id, principal, Math.min(SESSION_CACHE_MS, session.expiresAt.getTime() - Date.now()));
    await this.sessions.touch(session.id);
    return principal;
  }

  // ── current admin ────────────────────────────────────────────────────

  me(principal: AdminPrincipal): AuthAdmin {
    return this.toAuthAdmin(principal);
  }

  async signOut(principal: AdminPrincipal): Promise<void> {
    await this.sessions.revoke(principal.sessionId, 'sign_out', principal.id);
  }

  signOutAll(principal: AdminPrincipal): Promise<number> {
    return this.sessions.revokeAll(principal.id, 'sign_out_all');
  }

  async listSessions(adminId: string, currentSessionId?: string): Promise<SessionDto[]> {
    const rows = await this.sessions.list(adminId);
    return rows.map((s) => toSessionDto(s, s.id === currentSessionId));
  }

  async revokeSession(adminId: string, sessionId: string, reason: 'revoked' | 'revoked_by_admin'): Promise<void> {
    if (!(await this.sessions.revoke(sessionId, reason, adminId))) {
      throw new NotFoundException('Session not found or already ended');
    }
  }

  revokeOtherSessions(principal: AdminPrincipal): Promise<number> {
    return this.sessions.revokeAll(principal.id, 'revoked', principal.sessionId);
  }

  /** Checks the current password, sets the new one and signs out every other device. */
  async changePassword(principal: AdminPrincipal, currentPassword: string, newPassword: string): Promise<void> {
    const key = `change-password|${principal.id}`;
    this.signInAttempts.assertAllowed(key);
    const admin = await this.admins
      .createQueryBuilder('admin')
      .addSelect('admin.passwordHash')
      .where('admin.id = :id', { id: principal.id })
      .getOne();
    if (!admin || !(await verifyPassword(admin.passwordHash, currentPassword))) {
      this.signInAttempts.fail(key);
      throw new BadRequestException('Current password is incorrect');
    }
    this.signInAttempts.reset(key);
    if (currentPassword === newPassword) {
      throw new BadRequestException('The new password must differ from the current one');
    }
    await this.admins.update(admin.id, { passwordHash: await hashPassword(newPassword) });
    await this.sessions.revokeAll(admin.id, 'password_changed', principal.sessionId);
  }

  // ── cache control (admin management) ─────────────────────────────────

  /** Drops cached sessions of one admin (profile, role or block changed). */
  invalidateAdmin(adminId: string): void {
    this.cache.deleteWhere((p) => p.id === adminId);
  }

  /** Drops every cached session (a role's permissions changed). */
  invalidateAll(): void {
    this.cache.clear();
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private async activeAdmin(session: AdminSession): Promise<Admin> {
    const admin = await this.admins.findOne({ where: { id: session.adminId }, relations: { role: true } });
    if (!admin || admin.isBlocked) {
      await this.sessions.revoke(session.id, admin ? 'blocked' : 'deleted');
      throw new UnauthorizedException('Account is not active');
    }
    return admin;
  }

  private toAuthAdmin(admin: Admin | AuthAdmin): AuthAdmin {
    if ('permissions' in admin) {
      return { id: admin.id, email: admin.email, name: admin.name, permissions: admin.permissions };
    }
    const role = admin.role && !admin.role.deletedAt ? admin.role : null;
    return { id: admin.id, email: admin.email, name: admin.name, permissions: [...(role?.permissions ?? [])] };
  }

  private tokens(tokens: TokenPair) {
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn };
  }

  private response(admin: Admin, tokens: TokenPair): AuthResponseDto {
    return { ...this.tokens(tokens), user: this.toAuthAdmin(admin) };
  }
}

export function toSessionDto(session: AdminSession, isCurrent: boolean): SessionDto {
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
