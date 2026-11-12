import { CanActivate, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { isObservable, lastValueFrom } from 'rxjs';
import { UserGuard, UserPrincipal } from '../../client-auth';
import { TusUserAuthenticator } from './tus-auth.service';

/** The request shape UserGuard reads the token from and attaches the user to. */
interface TokenRequest {
  headers: { authorization: string };
  user?: UserPrincipal;
}

/** Stand-in route handler for the guard's execution context. */
function tusCreateHandler(): void {}

/**
 * User tokens for resumable uploads (`typ: 'user'`, auth-client). tus
 * requests (and tusd hooks) do not go through route guards, so this runs
 * UserGuard on a request that carries only the Authorization header: the same
 * signature, expiry and session checks as `@UseGuards(UserGuard)` routes.
 * Added by `npm run g -- upload-tus` once `auth-client` is installed.
 */
@Injectable()
export class TusUserAuth implements TusUserAuthenticator, OnModuleInit {
  private guard?: CanActivate;

  constructor(private readonly moduleRef: ModuleRef) {}

  async onModuleInit(): Promise<void> {
    try {
      this.guard = this.moduleRef.get(UserGuard, { strict: false });
    } catch {
      this.guard = await this.moduleRef.create(UserGuard);
    }
  }

  async authenticate(authorization: string): Promise<{ id: string }> {
    if (!this.guard) throw new UnauthorizedException('User authentication is not ready');
    const request: TokenRequest = { headers: { authorization } };
    // Handler and class carry no metadata, so a guard that looks for @Public() finds nothing.
    const context = new ExecutionContextHost([request, {}, () => undefined], TusUserAuth, tusCreateHandler);
    context.setType('http');
    const result = this.guard.canActivate(context);
    const allowed = isObservable(result) ? await lastValueFrom(result) : await result;
    if (!allowed || !request.user?.id) throw new UnauthorizedException('Invalid token');
    return { id: request.user.id };
  }
}
