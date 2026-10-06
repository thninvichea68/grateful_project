import { NavLink, Outlet } from 'react-router-dom';

/** The accounting engine's six tabs, as native routes (no iframe). */
const TABS = [
  { to: '/accounting', label: 'Monthly Ledger', end: true },
  { to: '/accounting/credit-notes', label: 'Credit Noted' },
  { to: '/accounting/record-summaries', label: 'Record Summary' },
  { to: '/accounting/tax-invoices', label: 'Tax Invoice' },
  { to: '/accounting/disbursements', label: 'Disbursement' },
  { to: '/accounting/debit-notes', label: 'Debit Note' },
];

export function AccountingLayout() {
  return (
    <>
      <nav
        aria-label="Accounting sections"
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}
      >
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
      <Outlet />
    </>
  );
}
