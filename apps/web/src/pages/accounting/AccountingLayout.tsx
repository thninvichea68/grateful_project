import { useState } from 'react';
import { NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import type { Permission } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { BILLING_SECTION_PATHS } from './billingParts';

/**
 * The accounting engine's tabs, as native routes (no iframe). Client Billing (each client's
 * month: documents → statements → receipts) holds the tax invoice, disbursement, debit note
 * and receipt registers as its own sections, so its tab stays lit on those pages.
 */
const TABS: { to: string; label: string; end?: boolean; permission?: Permission }[] = [
  { to: '/accounting', label: 'Monthly Ledger', end: true },
  { to: '/accounting/billing', label: 'Client Billing' },
  { to: '/accounting/credit-notes', label: 'Chea Payments' },
  // Accounting's check of Operations' record summaries (made in the sidebar's Record Summary).
  { to: '/accounting/record-summaries', label: 'Expense to Clients' },
];

interface AccountingContext {
  /** Right-hand end of the tabs row; a page can portal its title into it. */
  tabsAside: HTMLElement | null;
}

export const useAccountingLayout = (): AccountingContext =>
  useOutletContext<AccountingContext | undefined>() ?? { tabsAside: null };

export function AccountingLayout() {
  const { can } = useAuth();
  const [tabsAside, setTabsAside] = useState<HTMLElement | null>(null);
  const { pathname } = useLocation();
  const inBilling = BILLING_SECTION_PATHS.some((p) => pathname.startsWith(p));
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px 16px',
          flexWrap: 'wrap',
          marginBottom: 14,
        }}
      >
        <nav aria-label="Accounting sections" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TABS.filter((t) => !t.permission || can(t.permission)).map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `filter-btn${isActive || (inBilling && t.to === '/accounting/billing') ? ' active' : ''}`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div ref={setTabsAside} style={{ marginLeft: 'auto', textAlign: 'right' }} />
      </div>
      <Outlet context={{ tabsAside } satisfies AccountingContext} />
    </>
  );
}
