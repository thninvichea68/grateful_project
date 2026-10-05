/**
 * Role-based access control. Permissions are checked by the API middleware
 * (`requirePermission`) and mirrored in the web app to hide what a role can't use.
 * The database `roles.permissions` column is seeded from ROLE_DEFAULT_PERMISSIONS
 * and can be edited by an Admin (Phase 5).
 */
export const PERMISSIONS = [
  'dashboard:read',
  'shipments:read',
  'shipments:write',
  'shipments:delete',
  'clients:read',
  'clients:write',
  'cutstock:read',
  'cutstock:write',
  'cutstock:override',
  'accounting:read',
  'accounting:write',
  'quotations:read',
  'quotations:write',
  'documents:read',
  'documents:write',
  'followups:read',
  'followups:write',
  'staff:read',
  'staff:manage',
  'settings:read',
  'settings:manage',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_CODES = ['ADMIN', 'MANAGER', 'OPERATOR', 'ACCOUNTANT', 'VIEWER'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

const READ_ALL: Permission[] = PERMISSIONS.filter((p) => p.endsWith(':read'));

export const ROLE_DEFAULT_PERMISSIONS: Record<RoleCode, Permission[]> = {
  ADMIN: [...PERMISSIONS],
  MANAGER: PERMISSIONS.filter((p) => p !== 'settings:manage' && p !== 'staff:manage'),
  OPERATOR: [
    ...READ_ALL.filter((p) => p !== 'audit:read' && p !== 'accounting:read'),
    'shipments:write',
    'clients:write',
    'cutstock:write',
    'documents:write',
    'followups:write',
  ],
  ACCOUNTANT: [
    ...READ_ALL.filter((p) => p !== 'audit:read'),
    'accounting:write',
    'quotations:write',
    'documents:write',
    'followups:write',
  ],
  VIEWER: READ_ALL.filter((p) => p !== 'audit:read' && p !== 'staff:read'),
};

export const ROLE_LABEL: Record<RoleCode, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  OPERATOR: 'Operator',
  ACCOUNTANT: 'Accountant',
  VIEWER: 'Viewer',
};

export function hasPermission(granted: readonly string[], needed: Permission): boolean {
  return granted.includes(needed);
}
