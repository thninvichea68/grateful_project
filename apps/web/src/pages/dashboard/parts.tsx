import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../lib/api';
import s from './dashboard.module.css';

export { s as dash };

/** Loading skeleton / error / empty wrapper used by every chart. */
export function ChartState({
  loading,
  error,
  empty,
  emptyText = 'No shipments in this period',
  height = 200,
  children,
}: {
  loading: boolean;
  error: unknown;
  empty: boolean;
  emptyText?: string;
  height?: number;
  children: ReactNode;
}) {
  if (loading)
    return (
      <div className={s.skeleton} style={{ height }} aria-busy="true" aria-label="Loading chart" />
    );
  if (error)
    return (
      <div className={s.stateError} style={{ minHeight: height }}>
        {error instanceof ApiError ? error.message : 'Could not load this chart.'}
      </div>
    );
  if (empty)
    return (
      <div className={s.state} style={{ minHeight: height }}>
        {emptyText}
      </div>
    );
  return <>{children}</>;
}

const CHECK = (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const CARET = (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    aria-hidden="true"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/** The prototype's `.card-dropdown` (Import / Export, By Percentage / By Shipment…). */
export function CardDropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  triggerClass = '',
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  triggerClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const current = options.find((o) => o.value === value);
  return (
    <div className={`card-dropdown${open ? ' open' : ''}`} ref={ref}>
      <button
        className={`card-dropdown-trigger ${triggerClass}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{current?.label}</span>
        {CARET}
      </button>
      <div className="card-dropdown-menu" role="menu">
        {options.map((o) => (
          <div
            key={o.value}
            role="menuitemradio"
            aria-checked={o.value === value}
            tabIndex={0}
            className={`card-dropdown-item${o.value === value ? ' active' : ''}`}
            onClick={() => {
              onChange(o.value);
              setOpen(false);
            }}
            onKeyDown={(e) =>
              (e.key === 'Enter' || e.key === ' ') &&
              (e.preventDefault(), onChange(o.value), setOpen(false))
            }
          >
            {o.label}
            {CHECK}
          </div>
        ))}
      </div>
    </div>
  );
}

/** "↗ 12.4%" vs a previous value; null when there is nothing to compare with. */
export function changePct(cur: number, prev: number): { text: string; up: boolean } | null {
  if (!prev) return cur ? { text: 'new', up: true } : null;
  const pct = ((cur - prev) / prev) * 100;
  return { text: `${pct >= 0 ? '↗' : '↘'} ${Math.abs(pct).toFixed(1)}%`, up: pct >= 0 };
}

/** The prototype's `.an-hbar-*` progress list. */
export function HBarList({
  rows,
}: {
  rows: {
    key: string;
    name: string;
    value: number;
    display: string;
    color?: string;
    max?: number;
  }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.max ?? r.value));
  return (
    <div className="an-hbar-list">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="an-hbar-row-top">
            <span className="an-hbar-name">{r.name}</span>
            <span className="an-hbar-val">{r.display}</span>
          </div>
          <div className="an-hbar-track">
            <div
              className="an-hbar-fill"
              style={{
                width: `${Math.max(0, (r.value / (r.max ?? max)) * 100)}%`,
                background: r.color ?? 'var(--accent-primary)',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
export const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const monthLabel = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
export const CLIENT_COLORS = [
  '#00B4D8',
  '#F43F5E',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#38BDF8',
  '#EC4899',
  '#84CC16',
];

/** Round an axis maximum up to a friendly number (5, 10, 20, 50, 100…). */
export function niceMax(v: number): number {
  if (v <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
