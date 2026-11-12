import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  ADMIN_ACCESS_KEY,
  ADMIN_RESOURCE_KEY,
  AdminAccessLevel,
  AdminResourcePermissions,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
} from '@app/common';
import { AuthService } from './auth.service';
import { AdminPrincipal, hasPermissions } from './auth.types';

/**
 * Requires an admin Bearer access token whose signature, expiry and session
 * are valid (a revoked session is refused at once; see AuthService), and every
 * permission the route needs: its own `@RequirePermissions`, or — for the
 * generic BaseCrudController routes — the read/write keys its controller
 * declared with `@AdminResource`, or the controller's `@RequirePermissions`.
 * Fails closed: a generic route whose level is not mapped is refused. `*`
 * grants everything. `@Public()` skips the guard.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<Request & { admin?: AdminPrincipal }>();
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) throw new UnauthorizedException('Missing bearer token');

    const admin = await this.auth.authenticate(token);
    request.admin = admin;

    if (!hasPermissions(admin.permissions, this.requiredPermissions(context))) {
      throw new ForbiddenException('Not enough permissions');
    }
    return true;
  }

  private requiredPermissions(context: ExecutionContext): string[] {
    const handler = context.getHandler();
    const cls = context.getClass();
    const own = this.reflector.get<string[] | undefined>(PERMISSIONS_KEY, handler);
    if (own) return own;

    const level = this.reflector.get<AdminAccessLevel | undefined>(ADMIN_ACCESS_KEY, handler);
    if (level) {
      const mapped = this.reflector.get<AdminResourcePermissions | undefined>(ADMIN_RESOURCE_KEY, cls)?.[level];
      if (!mapped?.length) throw new ForbiddenException('Not enough permissions');
      return mapped;
    }
    return this.reflector.get<string[] | undefined>(PERMISSIONS_KEY, cls) ?? [];
  }
}
