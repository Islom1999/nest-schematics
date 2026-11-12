import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/** A client or proxy may send its own id; anything else is replaced (no log injection). */
const VALID_ID = /^[A-Za-z0-9._:-]{8,64}$/;

type WithRequestId = Request & { requestId?: string };

/**
 * The request's id: the incoming `x-request-id` when it looks sane, otherwise
 * a new UUID. Stored on `request.requestId` and in the request header (for
 * code that forwards it to other services) and echoed in the response header.
 */
export function ensureRequestId(req: Request, res?: Response): string {
  const request = req as WithRequestId;
  if (request.requestId) return request.requestId;
  const incoming = req.headers[REQUEST_ID_HEADER];
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  const id = value && VALID_ID.test(value) ? value : randomUUID();
  request.requestId = id;
  req.headers[REQUEST_ID_HEADER] = id;
  if (res && !res.headersSent) res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/**
 * `app.use(requestIdMiddleware)` in main.ts: every response, including 401s
 * and unknown routes, carries `x-request-id`.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  ensureRequestId(req, res);
  next();
}
