import { useAuth } from '../auth/AuthProvider';
import { useAccounts, useOverviewSummary } from '../features/analytics';
import { ErrorBanner } from '../components/ui';
import {
  AccountsCard,
  ClientShareCard,
  CountryMapCard,
  ForwarderCard,
  KpiRow,
  LiveConsignmentsCard,
  PortCard,
  ProfitCard,
  ShipmentSummaryCard,
} from './dashboard/OverviewCards';
import { KpiRowSkeleton } from './dashboard/KpiRow';
import { MONTHS_LONG } from './dashboard/parts';

export function OverviewPage() {
  const { can } = useAuth();
  const summary = useOverviewSummary();
  const s = summary.data;
  const year = s?.year ?? new Date().getFullYear();
  const yearFilters = { from: `${year}-01-01`, to: `${year}-12-31` };
  const accounts = useAccounts(yearFilters);
  const today = s?.today ?? '';

  return (
    <section className="view active" id="view-overview">
      <div className="ov-top-row">
        <div>
          <h1>Logistics Operations Overview</h1>
        </div>
        <span className="time-pill-btn" title="Refreshes every minute">
          {today
            ? `${MONTHS_LONG[Number(today.slice(5, 7)) - 1]} ${today.slice(0, 4)} (Live)`
            : 'Live'}
        </span>
      </div>
      <ErrorBanner error={summary.error} />
      {s ? <KpiRow k={s.kpis} monthly={s.monthly} /> : <KpiRowSkeleton />}

      <div className="ov-grid-3col">
        <ShipmentSummaryCard
          year={year}
          monthly={s?.monthly ?? []}
          currentMonth={today.slice(0, 7)}
          loading={summary.isLoading}
          error={summary.error}
        />
        {can('accounting:read') && s?.profit ? (
          <ProfitCard profit={s.profit} />
        ) : (
          <ClientShareCard accounts={accounts.data ?? []} year={year} />
        )}
        <CountryMapCard filters={yearFilters} />
        <AccountsCard filters={yearFilters} />
        <PortCard filters={yearFilters} />
        <ForwarderCard filters={yearFilters} />
      </div>

      <LiveConsignmentsCard />
    </section>
  );
}
