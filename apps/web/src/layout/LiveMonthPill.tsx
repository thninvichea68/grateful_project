import { useOverviewSummary } from '../features/analytics';
import { MONTHS_LONG } from '../pages/dashboard/parts';

/** "October 2026 (Live)" beside the Overview page title. Shares the page's cached summary query. */
export function LiveMonthPill() {
  const today = useOverviewSummary().data?.today ?? '';
  return (
    <span className="time-pill-btn" title="Refreshes every minute">
      {today
        ? `${MONTHS_LONG[Number(today.slice(5, 7)) - 1]} ${today.slice(0, 4)} (Live)`
        : 'Live'}
    </span>
  );
}
