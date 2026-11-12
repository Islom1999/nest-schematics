import type { Request } from 'express';

/** What UserGuard sets on `request.user` (api-logs reads `id` and `typ`). */
export interface RequestUser {
  id: string;
  /** user_sessions row of the access token. */
  sid: string;
  typ: 'user';
}

/** `@CurrentUser()`: the signed-in user and the session (device) of the token. */
export interface UserPrincipal {
  id: string;
  sessionId: string;
}

export type RequestWithUser = Request & { user?: RequestUser };

/** Postgres unique violation (two sign-ups racing for the same phone/email). */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === '23505';
}
