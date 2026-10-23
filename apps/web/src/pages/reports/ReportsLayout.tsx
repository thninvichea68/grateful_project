import { NavLink, Outlet } from 'react-router-dom';

/** Reports' tabs, laid out like Accounting's. Payroll is built; MIH and Import & Export are next. */
const TABS: { to: string; label: string; end?: boolean }[] = [
  { to: '/reports', label: 'Payroll', end: true },
  { to: '/reports/mih', label: 'MIH' },
  { to: '/reports/import-export', label: 'IMPORT & EXPORT Reports' },
];

export function ReportsLayout() {
  return (
    <>
      <nav
        aria-label="Report sections"
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}
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

/** A tab whose report is planned for a later phase. */
export function ReportComingSoon({ name }: { name: string }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{name}</h3>
      <p style={{ marginTop: 6, fontSize: 13, color: 'var(--text-tertiary)' }}>
        This report is coming in a later phase.
      </p>
    </div>
  );
}
