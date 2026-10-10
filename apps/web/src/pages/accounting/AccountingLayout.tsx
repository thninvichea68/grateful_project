import { useState } from 'react';
import { NavLink, Outlet, useOutletContext } from 'react-router-dom';

/** The accounting engine's six tabs, as native routes (no iframe). */
const TABS = [
  { to: '/accounting', label: 'Monthly Ledger', end: true },
  { to: '/accounting/credit-notes', label: 'Credit Noted' },
  { to: '/accounting/record-summaries', label: 'Record Summary' },
  { to: '/accounting/tax-invoices', label: 'Tax Invoice' },
  { to: '/accounting/disbursements', label: 'Disbursement' },
  { to: '/accounting/debit-notes', label: 'Debit Note' },
];

interface AccountingContext {
  /** Right-hand end of the tabs row; a page can portal its title into it. */
  tabsAside: HTMLElement | null;
}

export const useAccountingLayout = (): AccountingContext =>
  useOutletContext<AccountingContext | undefined>() ?? { tabsAside: null };

export function AccountingLayout() {
  const [tabsAside, setTabsAside] = useState<HTMLElement | null>(null);
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
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => `filter-btn${isActive ? ' active' : ''}`}
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
