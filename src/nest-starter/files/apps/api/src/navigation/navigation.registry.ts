/**
 * One entry of the admin sidebar. Data only: add-ons and generators append to
 * `NAVIGATION` at the `// @ns:navigation` marker, nothing else to wire.
 *
 *   { id: 'orders', title: 'Orders', icon: 'heroicons_outline:shopping-cart', link: '/orders', permission: 'order.read' },
 */
export interface NavigationItem {
  /** Unique across the whole tree (the UI matches layouts by id). */
  id: string;
  title: string;
  /** Icon name of the UI, e.g. `heroicons_outline:users`. */
  icon: string;
  /** Router link of the admin app. */
  link: string;
  /** Permission(s) needed to see the entry (every one of them). None = every admin. */
  permission?: string | string[];
  /** Sub-menu. An entry whose children are all hidden is hidden too. */
  children?: NavigationItem[];
}

export const NAVIGATION: NavigationItem[] = [
  { id: 'admins', title: 'Admins', icon: 'heroicons_outline:users', link: '/admins', permission: 'admin.read' },
  { id: 'roles', title: 'Roles', icon: 'heroicons_outline:shield-check', link: '/roles', permission: 'role.read' },
  // @ns:navigation
];
