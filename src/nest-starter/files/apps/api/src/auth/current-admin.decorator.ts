import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { DeviceInfo, extractDeviceInfo } from '@app/common';
import { AdminPrincipal } from './auth.types';

/** The admin AdminGuard attached to the request (with its `sessionId`). */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminPrincipal =>
    ctx.switchToHttp().getRequest<{ admin: AdminPrincipal }>().admin,
);

/** Device headers, User-Agent and IP of the request (stored on the session). */
export const Device = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): DeviceInfo => extractDeviceInfo(ctx.switchToHttp().getRequest<Request>()),
);
