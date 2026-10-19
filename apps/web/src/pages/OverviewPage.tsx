import { useState } from 'react';
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
import { useOverviewMonth } from './dashboard/overviewMonth';

export function OverviewPage() {
  const { can, user } = useAuth();
  // Operators see one client at a time (as a user with one client does), picked on either card.
  const [clientId, setClientId] = useState('');
  const pick = user?.role === 'OPERATOR' ? { value: clientId, onChange: setClientId } : undefined;
  // The month picker beside the title (?month=YYYY-MM); the current month when absent.
  const { month } = useOverviewMonth();
  const summary = useOverviewSummary(month);
  const s = summary.data;
  const year = s?.year ?? new Date().getFullYear();
  const yearFilters = { from: `${year}-01-01`, to: `${year}-12-31` };
  const accounts = useAccounts(yearFilters);
  const today = s?.today ?? '';

  return (
    <section className="view active" id="view-overview">
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
          <ProfitCard key={s.month} profit={s.profit} />
        ) : (
          <ClientShareCard
            accounts={accounts.data ?? []}
            year={year}
            monthly={s?.monthly ?? []}
            currentMonth={today.slice(0, 7)}
            pick={pick}
          />
        )}
        <CountryMapCard filters={yearFilters} />
        <AccountsCard filters={yearFilters} pick={pick} clients={accounts.data ?? []} />
        <PortCard filters={yearFilters} />
        <ForwarderCard filters={yearFilters} />
      </div>

      <LiveConsignmentsCard />
    </section>
  );
}
