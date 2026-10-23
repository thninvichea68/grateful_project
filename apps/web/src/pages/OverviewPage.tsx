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
import { currentMonth, monthRange, useOverviewMonth } from './dashboard/overviewMonth';
import { MONTHS, MONTHS_LONG } from './dashboard/parts';

export function OverviewPage() {
  const { can, user } = useAuth();
  // Operators see one client at a time (as a user with one client does), picked on either card.
  const [clientId, setClientId] = useState('');
  const pick = user?.role === 'OPERATOR' ? { value: clientId, onChange: setClientId } : undefined;
  // The month picker beside the title (?month=YYYY-MM, or ?year=YYYY for a whole year);
  // the current month when absent.
  const { month, fullYear } = useOverviewMonth();
  const summary = useOverviewSummary(month, fullYear);
  const s = summary.data;
  const year = s?.year ?? new Date().getFullYear();
  const yearFilters = { from: `${year}-01-01`, to: `${year}-12-31` };
  // The cards below the KPIs show the header's period: a month, or January to it.
  const shown = s?.month ?? month ?? currentMonth();
  const wholeYear = s?.fullYear ?? !!fullYear;
  const periodFilters =
    s?.kpis.period ??
    (fullYear ? { from: `${fullYear}-01-01`, to: `${fullYear}-12-31` } : monthRange(shown));
  const period = wholeYear
    ? `Jan – ${MONTHS[Number(shown.slice(5, 7)) - 1]} ${shown.slice(0, 4)}`
    : `${MONTHS_LONG[Number(shown.slice(5, 7)) - 1]} ${shown.slice(0, 4)}`;
  // The year's clients are the ones to pick from; the period's figures fill the cards.
  const clients = useAccounts(yearFilters);
  const accounts = useAccounts(periodFilters);
  const today = s?.today ?? '';

  return (
    <section className="view active" id="view-overview">
      <ErrorBanner error={summary.error} />
      {s ? <KpiRow k={s.kpis} monthly={s.monthly} fullYear={s.fullYear} /> : <KpiRowSkeleton />}

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
            clients={clients.data ?? []}
            accounts={accounts.data ?? []}
            month={shown}
            fullYear={wholeYear}
            period={period}
            monthly={s?.monthly ?? []}
            pick={pick}
          />
        )}
        <CountryMapCard filters={periodFilters} />
        <AccountsCard
          filters={periodFilters}
          period={period}
          pick={pick}
          clients={clients.data ?? []}
        />
        <PortCard filters={periodFilters} />
        <ForwarderCard filters={periodFilters} />
      </div>

      <LiveConsignmentsCard />
    </section>
  );
}
