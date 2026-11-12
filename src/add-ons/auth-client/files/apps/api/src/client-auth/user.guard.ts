import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '@app/common';
import { ClientAuthService } from './client-auth.service';
import { RequestWithUser } from './client-auth.types';

function bearerToken(request: RequestWithUser): string | null {
  const [type, token] = request.headers.authorization?.split(' ') ?? [];
  return type === 'Bearer' && token ? token : null;
}

/**
 * Requires a client (user) Bearer access token of a live session and sets
 * `request.user = { id, sid, typ: 'user' }` (`@CurrentUser()`). Admin tokens
 * are refused: other secret and `typ`. `@Public()` skips it.
 *
 *   @UseGuards(UserGuard)
 *   @Get('orders')
 *   list(@CurrentUser() user: UserPrincipal) { ... }
 */
@Injectable()
export class UserGuard implements CanActivate {
  constructor(
    private readonly auth: ClientAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = bearerToken(request);
    if (!token) throw new UnauthorizedException('Missing bearer token');
    const principal = await this.auth.authenticate(token);
    request.user = { id: principal.id, sid: principal.sessionId, typ: 'user' };
    return true;
  }
}

/**
 * Like UserGuard, but a request without a token passes as a guest
 * (`@CurrentUser()` is undefined). A token that is present must be valid.
 */
@Injectable()
export class OptionalUserGuard implements CanActivate {
  constructor(private readonly auth: ClientAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = bearerToken(request);
    if (!token) return true;
    const principal = await this.auth.authenticate(token);
    request.user = { id: principal.id, sid: principal.sessionId, typ: 'user' };
    return true;
  }
}
