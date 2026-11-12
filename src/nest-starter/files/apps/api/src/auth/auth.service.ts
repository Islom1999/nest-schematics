import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AdminJwtPayload, AuthAdmin } from './auth.types';

function sameSecret(a: string, b: string): boolean {
  // Hash first so lengths match and timing does not leak the length.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * SKELETON: one admin from .env (ADMIN_EMAIL / ADMIN_PASSWORD) with every
 * permission. Replace `findAdmin` with an Admin entity (bcrypt/argon2 hash,
 * roles → permissions) before production.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async signIn(email: string, password: string) {
    const admin = this.findAdmin(email, password);
    if (!admin) throw new UnauthorizedException('Invalid email or password');
    return this.session(admin);
  }

  /** Fuse `signInUsingToken()`: verify and return a fresh token. */
  async refresh(accessToken: string) {
    return this.session(await this.verifyToken(accessToken));
  }

  async verifyToken(token: string): Promise<AuthAdmin> {
    let payload: AdminJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<AdminJwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.typ !== 'admin') throw new UnauthorizedException('Invalid token');
    return { id: payload.sub, email: payload.email, name: payload.name, permissions: payload.permissions ?? [] };
  }

  private async session(admin: AuthAdmin) {
    const payload: AdminJwtPayload = {
      sub: admin.id,
      email: admin.email,
      name: admin.name,
      permissions: admin.permissions,
      typ: 'admin',
    };
    return { accessToken: await this.jwt.signAsync(payload), user: admin };
  }

  private findAdmin(email: string, password: string): AuthAdmin | null {
    const envEmail = this.config.get<string>('ADMIN_EMAIL');
    const envPassword = this.config.get<string>('ADMIN_PASSWORD');
    if (!envEmail || !envPassword) return null;
    const ok = sameSecret(email.toLowerCase(), envEmail.toLowerCase()) && sameSecret(password, envPassword);
    return ok ? { id: 'env-admin', email: envEmail, name: 'Admin', permissions: ['*'] } : null;
  }
}
