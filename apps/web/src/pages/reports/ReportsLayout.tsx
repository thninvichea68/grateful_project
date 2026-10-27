import { Outlet } from 'react-router-dom';

/**
 * Reports' pages. Their sections (Payroll and MIH, built; Import & Export, next) are the
 * sidebar's Reports dropdown, as Accounting's are.
 */
export function ReportsLayout() {
  return <Outlet />;
}

/** A report planned for a later phase. */
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
