import { useEffect, useRef, useState } from 'react';
import { useOverviewSummary } from '../features/analytics';
import { MONTHS, MONTHS_LONG } from '../pages/dashboard/parts';
import { currentMonth, useOverviewMonth } from '../pages/dashboard/overviewMonth';
import s from './LiveMonthPill.module.css';

/**
 * Beside the Overview title: "October 2026 (Live)", or the month being looked at. Click it to
 * pick another month and year (months still to come can't be picked).
 */
export function LiveMonthPill() {
  const { month, setMonth } = useOverviewMonth();
  const live = !month;
  // Same query (and cache) as the Overview page itself.
  const summary = useOverviewSummary(month);
  const shown = month ?? summary.data?.month ?? currentMonth();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(shown.slice(0, 4)));
  const box = useRef<HTMLDivElement>(null);
  const now = currentMonth();
  const nowYear = Number(now.slice(0, 4));

  useEffect(() => {
    if (!open) return;
    setYear(Number(shown.slice(0, 4)));
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
    // Re-sync the year only when the picker opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const label = `${MONTHS_LONG[Number(shown.slice(5, 7)) - 1]} ${shown.slice(0, 4)}`;
  const pick = (m: string) => {
    setMonth(m === now ? undefined : m);
    setOpen(false);
  };

  return (
    <div className={s.wrap} ref={box}>
      <button
        type="button"
        className={`time-pill-btn ${s.btn}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={live ? 'Refreshes every minute. Click to pick another month.' : 'Pick a month'}
        onClick={() => setOpen((o) => !o)}
      >
        {live && <i className={s.liveDot} aria-hidden />}
        {label}
        {live && <span className={s.liveTag}>(Live)</span>}
        <svg className={s.caret} viewBox="0 0 24 24" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className={s.panel} role="dialog" aria-label="Pick a month">
          <div className={s.yearRow}>
            <button
              type="button"
              className={s.step}
              aria-label="Previous year"
              onClick={() => setYear((y) => y - 1)}
            >
              ‹
            </button>
            <b>{year}</b>
            <button
              type="button"
              className={s.step}
              aria-label="Next year"
              disabled={year >= nowYear}
              onClick={() => setYear((y) => y + 1)}
            >
              ›
            </button>
          </div>
          <div className={s.grid}>
            {MONTHS.map((name, i) => {
              const m = `${year}-${String(i + 1).padStart(2, '0')}`;
              return (
                <button
                  type="button"
                  key={m}
                  className={s.month}
                  data-selected={m === shown || undefined}
                  data-now={m === now || undefined}
                  disabled={m > now}
                  onClick={() => pick(m)}
                >
                  {name}
                </button>
              );
            })}
          </div>
          {!live && (
            <button type="button" className={s.back} onClick={() => pick(now)}>
              <i className={s.liveDot} aria-hidden /> Back to this month (Live)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
