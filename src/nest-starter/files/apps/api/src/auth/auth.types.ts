import { SUPER_PERMISSION } from '@app/database';

/** Admin as the frontend sees it: sign-in `user` and `GET auth/me`. */
export interface AuthAdmin {
  id: string;
  email: string;
  name: string;
  /** Permission keys from the admin's role; `*` = every permission (super admin). */
  permissions: string[];
}

/** What AdminGuard attaches to the request (`@CurrentAdmin()`). */
export interface AdminPrincipal extends AuthAdmin {
  /** The admin_sessions row of this access token (`sid`). */
  sessionId: string;
}

/** True when `granted` covers every key in `required` (`*` covers all). */
export function hasPermissions(granted: readonly string[], required: readonly string[]): boolean {
  if (granted.includes(SUPER_PERMISSION)) return true;
  return required.every((p) => granted.includes(p));
}

export function isSuper(permissions: readonly string[]): boolean {
  return permissions.includes(SUPER_PERMISSION);
}
