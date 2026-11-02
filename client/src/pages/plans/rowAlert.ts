import type { ShipmentListItem } from '@gs/shared';

export interface RowAlert {
  tone: 'danger' | 'warning' | 'info';
  label: string;
}

type AlertFields = Pick<
  ShipmentListItem,
  'direction' | 'status' | 'clearanceStatus' | 'eta' | 'etd'
> &
  Partial<Pick<ShipmentListItem, 'transportMode' | 'cutOffAt' | 'atd'>>;

/**
 * An air export's cut-off (Phnom Penh time) against `now`: red within 6 hours or once passed,
 * amber within 48 hours, nothing before or after departure.
 */
function cutOffAlert(r: AlertFields, now: number): RowAlert | null {
  if (r.direction !== 'EXPORT' || r.transportMode !== 'AIR' || !r.cutOffAt || r.atd) return null;
  const hours = (Date.parse(`${r.cutOffAt}:00+07:00`) - now) / 3_600_000;
  if (hours < 0) return { tone: 'danger', label: 'Cut-off passed' };
  if (hours > 48) return null;
  return {
    tone: hours <= 6 ? 'danger' : 'warning',
    label: `Cut-off in ${Math.max(1, Math.round(hours))}h`,
  };
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/**
 * The hint under a Shipping Plans status pill. Same rules as the API's watch filters
 * (DUE_SOON / ATTENTION): the shipment's date is an import's ETA or an export's ETD, and
 * `today` is the business date the API returns with the list.
 */
export function rowAlert(r: AlertFields, today: string, now = Date.now()): RowAlert | null {
  if (r.clearanceStatus === 'EXCEPTION') return { tone: 'danger', label: 'Customs exception' };
  const cutOff = cutOffAlert(r, now);
  if (cutOff) return cutOff;
  if (r.status === 'COMPLETED')
    return r.clearanceStatus === 'CLEARED'
      ? null
      : { tone: 'warning', label: 'Customs not cleared' };
  const date = r.direction === 'EXPORT' ? (r.etd ?? r.eta) : (r.eta ?? r.etd);
  if (!date) return null;
  const days = daysBetween(today, date);
  const what = r.direction === 'EXPORT' ? 'ETD' : 'ETA';
  if (days < 0) return { tone: 'danger', label: `${what} ${-days}d ago` };
  if (days === 0) return { tone: 'warning', label: `${what} today` };
  if (days <= 7) return { tone: 'info', label: `${what} in ${days}d` };
  return null;
}
