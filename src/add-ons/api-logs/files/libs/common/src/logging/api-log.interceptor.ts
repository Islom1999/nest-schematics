import { CallHandler, ExecutionContext, HttpException, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { ServerApiLogType } from '@app/database';
import { ApiLogService, describeError, errorStatus } from './api-log.service';
import { LOG_PAYMENT_KEY, LogPaymentOptions } from './log-payment.decorator';
import { ensureRequestId } from './request-id';

/**
 * Who made the request, as set by the auth guard AFTER it verified the token:
 * `request.user` (`{ id | sub, type | typ }`), or `request.admin` from the
 * starter's AdminGuard. Tokens are never decoded here: an unverified token
 * must not name a user in the logs.
 */
type AuthedRequest = Request & {
  user?: { id?: unknown; sub?: unknown; type?: unknown; typ?: unknown; userType?: unknown };
  admin?: { id?: unknown };
};

interface Pending {
  started: number;
  requestId: string;
  payment?: LogPaymentOptions;
  done: boolean;
}

/**
 * Global (APP_INTERCEPTOR): logs requests to `server_api_logs` according to
 * API_LOG_MODE, always logs `@LogPayment()` routes, and sets `x-request-id`.
 * Guard rejections (401/403) and unknown routes never reach interceptors, so
 * they are not logged here. Logging can never fail or slow down a request.
 */
@Injectable()
export class ApiLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ApiLogInterceptor.name);

  constructor(
    private readonly apiLogs: ApiLogService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    let pending: Pending | null = null;
    try {
      pending = this.begin(context);
    } catch (e) {
      this.logger.warn(`API log skipped: ${(e as Error).message}`);
    }
    if (!pending) return next.handle();
    const state = pending;
    return next.handle().pipe(
      tap({
        next: (body) => this.finish(context, state, undefined, body),
        complete: () => this.finish(context, state),
        error: (error: unknown) => this.finish(context, state, error ?? new Error('Unknown error')),
      }),
    );
  }

  private begin(context: ExecutionContext): Pending | null {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const requestId = ensureRequestId(req, http.getResponse<Response>());
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (this.apiLogs.settings.skipPaths.some((p) => path === p || path.startsWith(`${p}/`))) return null;
    const payment = this.reflector.getAllAndOverride<LogPaymentOptions | undefined>(LOG_PAYMENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return { started: Date.now(), requestId, payment, done: false };
  }

  private finish(context: ExecutionContext, state: Pending, error?: unknown, body?: unknown): void {
    if (state.done) return;
    state.done = true;
    try {
      const http = context.switchToHttp();
      const req = http.getRequest<AuthedRequest>();
      const res = http.getResponse<Response>();
      const durationMs = Date.now() - state.started;
      const statusCode = error !== undefined ? errorStatus(error) : res.statusCode;
      const failed = error !== undefined || statusCode >= 400;
      const { mode, slowMs } = this.apiLogs.settings;
      const wanted =
        !!state.payment || failed || mode === 'all' || (mode === 'slow' && durationMs >= slowMs);
      if (!wanted) return;

      const user = this.userOf(req);
      const requestBody = req.body && typeof req.body === 'object' && !Object.keys(req.body as object).length ? null : req.body;
      this.apiLogs.write({
        type: state.payment ? ServerApiLogType.PAYMENT : ServerApiLogType.API,
        module: state.payment?.module ?? context.getClass().name,
        handler: context.getHandler().name,
        method: req.method,
        url: req.originalUrl ?? req.url,
        statusCode,
        requestBody,
        responseBody:
          error instanceof HttpException ? error.getResponse() : error === undefined && state.payment ? body : null,
        error: error !== undefined ? describeError(error) : null,
        durationMs,
        userId: user.id,
        userType: user.type,
        ip: req.ip ?? req.socket?.remoteAddress ?? null,
        requestId: state.requestId,
      });
    } catch (e) {
      this.logger.warn(`API log skipped: ${(e as Error).message}`);
    }
  }

  private userOf(req: AuthedRequest): { id: string | null; type: string | null } {
    const user = req.user;
    if (user && typeof user === 'object') {
      return { id: scalar(user.id ?? user.sub), type: scalar(user.type ?? user.typ ?? user.userType) ?? 'user' };
    }
    const adminId = req.admin && typeof req.admin === 'object' ? scalar(req.admin.id) : null;
    if (adminId !== null) return { id: adminId, type: 'admin' };
    return { id: null, type: null };
  }
}

/** Ids and types from token payloads: strings and numbers only. */
function scalar(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? String(value) : null;
}
