import type { Permission } from '@gs/shared';
import type { IconName } from './icons';

export interface NavItem {
  to: string;
  label: string;
  /** Page title shown in the top bar (prototype wording). */
  title: string;
  icon: IconName;
  permission: Permission;
  /** Rendered with the prototype's indented sub-item style. */
  sub?: boolean;
  badge?: 'openFollowUps';
  /** Exact match for NavLink active state. */
  end?: boolean;
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    heading: 'Management',
    items: [
      {
        to: '/overview',
        label: 'Overview',
        title: 'Overview',
        icon: 'overview',
        permission: 'dashboard:read',
      },
      {
        to: '/plans',
        label: 'Shipping Plans',
        title: 'Shipping Plans',
        icon: 'plans',
        permission: 'shipments:read',
      },
      {
        to: '/clients',
        label: 'Clients',
        title: 'Clients',
        icon: 'clients',
        permission: 'clients:read',
      },
      {
        to: '/analytics',
        label: 'Analytics',
        title: 'Analytics',
        icon: 'analytics',
        permission: 'dashboard:read',
      },
      {
        to: '/cutstock',
        label: 'Cut Stock',
        title: 'Cut Stock Master List',
        icon: 'cutstock',
        permission: 'cutstock:read',
      },
      {
        to: '/documents',
        label: 'Documents',
        title: 'Documents',
        icon: 'documents',
        permission: 'documents:read',
      },
      {
        to: '/followup',
        label: 'Follow Up',
        title: 'Follow Up',
        icon: 'followup',
        permission: 'followups:read',
        badge: 'openFollowUps',
      },
    ],
  },
  {
    heading: 'Finance',
    items: [
      {
        to: '/accounting',
        label: 'Accounting',
        title: 'Accounting',
        icon: 'accounting',
        permission: 'accounting:read',
        end: true,
      },
      {
        to: '/accounting/credit-notes',
        label: 'Credit Noted',
        title: 'Chea Payments / Credit Noted',
        icon: 'creditNote',
        permission: 'accounting:read',
        sub: true,
      },
      {
        to: '/accounting/record-summary',
        label: 'Record Summary',
        title: 'Record Summary',
        icon: 'recordSummary',
        permission: 'accounting:read',
        sub: true,
      },
      {
        to: '/quotations',
        label: 'Quotations',
        title: 'Quotations',
        icon: 'quotations',
        permission: 'quotations:read',
      },
      {
        to: '/operations',
        label: 'Operations',
        title: 'Operations',
        icon: 'operations',
        permission: 'shipments:read',
      },
    ],
  },
  {
    heading: 'Admin',
    items: [
      {
        to: '/staff',
        label: 'Staff Management',
        title: 'Staff Management',
        icon: 'staff',
        permission: 'staff:read',
      },
      {
        to: '/settings',
        label: 'Settings',
        title: 'Settings',
        icon: 'settings',
        permission: 'settings:read',
      },
    ],
  },
];

/** Titles for routes that are not sidebar items. Longest prefix wins. */
const EXTRA_TITLES: [string, string][] = [
  ['/accounting/tax-invoices', 'Tax Invoice'],
  ['/accounting/disbursements', 'Disbursement'],
  ['/accounting/debit-notes', 'Debit Note'],
  ['/plans/new', 'Create Shipment'],
];

export function titleFor(pathname: string): string {
  const candidates: [string, string][] = [
    ...EXTRA_TITLES,
    ...NAV.flatMap((g) => g.items.map((i) => [i.to, i.title] as [string, string])),
  ];
  const match = candidates
    .filter(([to]) => pathname === to || pathname.startsWith(`${to}/`))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return match?.[1] ?? 'Grateful Solutions';
}
