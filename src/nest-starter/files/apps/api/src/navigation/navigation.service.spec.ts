import { NAVIGATION, NavigationItem } from './navigation.registry';
import { filterNavigation, NavigationService } from './navigation.service';

const TREE: NavigationItem[] = [
  { id: 'home', title: 'Home', icon: 'i:home', link: '/' },
  { id: 'users', title: 'Users', icon: 'i:users', link: '/users', permission: 'user.read' },
  {
    id: 'shop',
    title: 'Shop',
    icon: 'i:shop',
    link: '/shop',
    children: [
      { id: 'orders', title: 'Orders', icon: 'i:o', link: '/orders', permission: 'order.read' },
      { id: 'export', title: 'Export', icon: 'i:e', link: '/export', permission: ['order.read', 'order.export'] },
    ],
  },
];

const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe('filterNavigation', () => {
  it('keeps entries without a permission for everyone', () => {
    expect(ids(filterNavigation(TREE, []))).toEqual(['home']);
  });

  it('shows only what the permissions allow and hides a group with no visible child', () => {
    expect(ids(filterNavigation(TREE, ['user.read']))).toEqual(['home', 'users']);
    const shop = filterNavigation(TREE, ['order.read']).find((i) => i.id === 'shop');
    expect(shop?.type).toBe('collapsable');
    expect(ids(shop?.children ?? [])).toEqual(['orders']);
  });

  it('needs every permission of an array', () => {
    const both = filterNavigation(TREE, ['order.read', 'order.export']).find((i) => i.id === 'shop');
    expect(ids(both?.children ?? [])).toEqual(['orders', 'export']);
  });

  it('gives the super admin everything and never leaks the permission keys', () => {
    const all = filterNavigation(TREE, ['*']);
    expect(ids(all)).toEqual(['home', 'users', 'shop']);
    expect(JSON.stringify(all)).not.toContain('permission');
    expect(all[0].type).toBe('basic');
  });
});

describe('NAVIGATION registry', () => {
  it('has unique ids and the admin and role entries behind their permissions', () => {
    const flat = (items: NavigationItem[]): string[] => items.flatMap((i) => [i.id, ...flat(i.children ?? [])]);
    expect(new Set(flat(NAVIGATION)).size).toBe(flat(NAVIGATION).length);
    const service = new NavigationService();
    expect(ids(service.get(['admin.read']).default)).toEqual(['admins']);
    expect(ids(service.get(['role.read']).default)).toEqual(['roles']);
    expect(service.get([]).default).toEqual([]);
    expect(ids(service.get(['*']).horizontal)).toEqual(ids(NAVIGATION));
  });
});
