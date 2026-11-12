/**
 * Every admin permission, grouped by resource: `<resource>.<action>`.
 * The admin UI lists these when editing roles. Generators add their resources.
 */
export interface PermissionGroup {
  resource: string;
  actions: string[];
}

export const PERMISSION_CATALOG: PermissionGroup[] = [
  { resource: 'admin', actions: ['read', 'write'] },
  { resource: 'role', actions: ['read', 'write'] },
  // @ns:permissions
];

export const ALL_PERMISSIONS: string[] = PERMISSION_CATALOG.flatMap((g) => g.actions.map((a) => `${g.resource}.${a}`));
