import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestWithUser, UserPrincipal } from './client-auth.types';

/**
 * The user UserGuard authenticated: `{ id, sessionId }`. Undefined on routes
 * without UserGuard, or for guests behind OptionalUserGuard.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): UserPrincipal => {
  const user = ctx.switchToHttp().getRequest<RequestWithUser>().user;
  return (user ? { id: user.id, sessionId: user.sid } : undefined) as UserPrincipal;
});
