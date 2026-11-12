import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthAdmin } from './auth.types';

/** The admin AdminGuard attached to the request. */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthAdmin => ctx.switchToHttp().getRequest<{ admin: AuthAdmin }>().admin,
);
