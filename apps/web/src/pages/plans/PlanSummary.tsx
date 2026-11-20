import type { ShipmentPlanSummary, ShipmentStatus } from '@gs/shared';
import s from './PlanSummary.module.css';

type View = { status?: string; billing?: boolean; allMonths?: boolean };
type Tone = 'total' | 'completed' | 'progress' | 'pending' | 'exception';

const STATUS_CARDS: {
  status: '' | ShipmentStatus;
  label: string;
  tone: Tone;
  key: keyof ShipmentPlanSummary;
}[] = [
  { status: '', label: 'All shipments', tone: 'total', key: 'total' },
  { status: 'COMPLETED', label: 'Completed', tone: 'completed', key: 'completed' },
  { status: 'IN_PROGRESS', label: 'In progress', tone: 'progress', key: 'inProgress' },
  { status: 'PENDING', label: 'Pending', tone: 'pending', key: 'pending' },
  { status: 'EXCEPTION', label: 'Exception', tone: 'exception', key: 'exception' },
];

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

/**
 * The Shipping Plans headline: the month's shipments by status, then the completed ones not
 * invoiced to the client yet, so operations can always follow up. Each card filters the table.
 */
export function PlanSummary({
  data,
  loading,
  monthLabel,
  allMonths,
  status,
  billing,
  onView,
}: {
  data: ShipmentPlanSummary | undefined;
  loading: boolean;
  monthLabel: string;
  allMonths: boolean;
  status: '' | ShipmentStatus;
  billing: boolean;
  onView: (v: View) => void;
}) {
  const fig = (n: number | undefined) => (loading || n === undefined ? '–' : n.toLocaleString());
  const total = data?.total ?? 0;
  const unbilled = data?.unbilled ?? 0;
  const older = (data?.unbilledAll ?? 0) - unbilled;

  return (
    <div className={s.row}>
      <div className={s.statusGroup} role="group" aria-label={`Shipments by status, ${monthLabel}`}>
        {STATUS_CARDS.map((c) => {
          const active = !billing && status === c.status;
          const n = data?.[c.key];
          return (
            <button
              key={c.tone}
              type="button"
              className={`${s.card} ${active ? s.active : ''}`}
              data-tone={c.tone}
              aria-pressed={active}
              onClick={() => onView({ status: c.status })}
            >
              <span className={s.label}>
                <span className={s.dot} aria-hidden="true" />
                {c.status ? c.label : `Shipments · ${monthLabel}`}
              </span>
              <span className={s.value}>{fig(n)}</span>
              <span className={s.sub}>
                {c.status
                  ? `${pct(n ?? 0, total)}% of ${allMonths ? 'all' : 'the month'}`
                  : allMonths
                    ? 'Every month'
                    : 'Declared or added this month'}
              </span>
              {c.status === 'COMPLETED' && (
                <span className={s.bar} aria-hidden="true">
                  <span style={{ width: `${pct(n ?? 0, total)}%` }} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        className={`${s.follow} ${billing ? s.active : ''} ${unbilled ? s.alert : ''}`}
        role="group"
        aria-label="Completed, not invoiced to client"
      >
        <button
          type="button"
          className={s.followMain}
          aria-pressed={billing}
          onClick={() => onView({ billing: true })}
        >
          <span className={s.label}>
            <span className={s.dot} aria-hidden="true" />
            Completed · not invoiced to client
          </span>
          <span className={s.followFigures}>
            <span className={s.value}>{fig(data?.unbilled)}</span>
            <span className={s.sub}>
              {loading
                ? ''
                : unbilled
                  ? `${pct(unbilled, data?.completed ?? 0)}% of completed · ${monthLabel}`
                  : `All completed shipments invoiced · ${monthLabel}`}
            </span>
          </span>
        </button>
        {!allMonths && older > 0 && (
          <button
            type="button"
            className={s.backlog}
            onClick={() => onView({ billing: true, allMonths: true })}
          >
            +{older.toLocaleString()} from earlier months <span aria-hidden="true">→</span>
          </button>
        )}
      </div>
    </div>
  );
}
