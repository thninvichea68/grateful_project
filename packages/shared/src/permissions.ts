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
  /** Seal Plans (container seals, trucking and depot); saving also updates the containers. */
  'sealplans:read',
  'sealplans:write',
  'clients:read',
  'clients:write',
  'cutstock:read',
  'cutstock:write',
  'cutstock:override',
  'accounting:read',
  'accounting:write',
  /** Credit Noted (Chea / customs broker payment vouchers), separate from the rest of accounting. */
  'creditnotes:read',
  'creditnotes:write',
  /** Record Summary (each shipment's summary sheet), separate so Operations can work on it. */
  'recordsummaries:read',
  'recordsummaries:write',
  'quotations:read',
  'quotations:write',
  /** Reports (Payroll, MIH, Import & Export): staff salaries, so kept apart from accounting. */
  'reports:read',
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

export const ROLE_CODES = [
  'ADMIN',
  'MANAGER',
  'OPERATOR',
  'ACCOUNTANT',
  'VIEWER',
  'CUSTOMS_BROKER',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

const READ_ALL: Permission[] = PERMISSIONS.filter((p) => p.endsWith(':read'));

export const ROLE_DEFAULT_PERMISSIONS: Record<RoleCode, Permission[]> = {
  ADMIN: [...PERMISSIONS],
  MANAGER: PERMISSIONS.filter((p) => p !== 'settings:manage' && p !== 'staff:manage'),
  OPERATOR: [
    ...READ_ALL.filter(
      (p) =>
        p !== 'audit:read' &&
        p !== 'accounting:read' &&
        p !== 'creditnotes:read' &&
        p !== 'reports:read',
    ),
    'shipments:write',
    'sealplans:write',
    'clients:write',
    'cutstock:write',
    'recordsummaries:write',
    'documents:write',
    'followups:write',
  ],
  ACCOUNTANT: [
    ...READ_ALL.filter((p) => p !== 'audit:read'),
    'accounting:write',
    'creditnotes:write',
    'recordsummaries:write',
    'quotations:write',
    'documents:write',
    'followups:write',
  ],
  VIEWER: READ_ALL.filter((p) => p !== 'audit:read' && p !== 'staff:read' && p !== 'reports:read'),
  /** The customs broker (Chea): writes Credit Noted vouchers and can look up shipments. */
  CUSTOMS_BROKER: ['shipments:read', 'creditnotes:read', 'creditnotes:write'],
};

export const ROLE_LABEL: Record<RoleCode, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  OPERATOR: 'Operations',
  ACCOUNTANT: 'Accountant',
  VIEWER: 'Viewer',
  CUSTOMS_BROKER: 'Customs Broker',
};

/** A user's permissions: their role's, plus per-user extras, minus per-user removals. */
export function effectivePermissions(
  role: readonly string[],
  add: readonly string[] = [],
  remove: readonly string[] = [],
): Permission[] {
  const removed = new Set(remove);
  return PERMISSIONS.filter((p) => (role.includes(p) || add.includes(p)) && !removed.has(p));
}

export function hasPermission(granted: readonly string[], needed: Permission): boolean {
  return granted.includes(needed);
}
