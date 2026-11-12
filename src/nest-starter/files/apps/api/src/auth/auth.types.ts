/** Admin attached to the request by AdminGuard (and returned on sign-in as `user`). */
export interface AuthAdmin {
  id: string;
  email: string;
  name: string;
  /** Permission keys; `*` = every permission (super admin). */
  permissions: string[];
}

export interface AdminJwtPayload {
  sub: string;
  email: string;
  name: string;
  permissions: string[];
  typ: 'admin';
}
