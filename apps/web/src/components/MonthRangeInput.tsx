import { useEffect, useRef, useState } from 'react';
import { ui } from './ui';
import { currentMonth } from './MonthInput';
import s from './MonthInput.module.css';
import r from './MonthRangeInput.module.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const key = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;
const label = (v: string) => `${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}`;

/**
 * One field for a `YYYY-MM` month range. In the panel the first click picks the
 * start month and the second the end (picked the other way round, they swap);
 * a single month is the same month clicked twice.
 */
export function MonthRangeInput({
  from,
  to,
  onChange,
  className,
  'aria-label': ariaLabel,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  className?: string;
  'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(to.slice(0, 4)));
  /** The start month while the end is still to be picked. */
  const [start, setStart] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setYear(Number(to.slice(0, 4)));
    setStart(null);
    setHover(null);
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
    // Reset only when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = (a: string, b: string) => {
    onChange(a <= b ? a : b, a <= b ? b : a);
    setOpen(false);
  };
  const pick = (k: string) => (start ? commit(start, k) : setStart(k));

  // What the grid highlights: the range being picked, else the current one.
  const lo = start ? (hover && hover < start ? hover : start) : from;
  const hi = start ? (hover && hover > start ? hover : start) : to;
  const thisMonth = currentMonth();

  return (
    <div className={s.wrap} ref={ref}>
      <button
        type="button"
        className={`${ui.input} ${s.trigger} ${r.trigger} ${className ?? ''}`}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{from === to ? label(from) : `${label(from)} – ${label(to)}`}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </button>
      {open && (
        <div className={s.panel} role="dialog" aria-label={ariaLabel ?? 'Pick a month range'}>
          <div className={s.yearRow}>
            <button
              type="button"
              className={s.nav}
              aria-label="Previous year"
              onClick={() => setYear((y) => y - 1)}
            >
              ‹
            </button>
            <span className={s.year}>{year}</span>
            <button
              type="button"
              className={s.nav}
              aria-label="Next year"
              onClick={() => setYear((y) => y + 1)}
            >
              ›
            </button>
          </div>
          <div className={r.hint}>
            {start ? `From ${label(start)} — pick the end month` : 'Pick the start month'}
          </div>
          <div className={s.grid} onMouseLeave={() => setHover(null)}>
            {MONTHS.map((m, i) => {
              const k = key(year, i + 1);
              const edge = k === lo || k === hi;
              const inside = k > lo && k < hi;
              return (
                <button
                  type="button"
                  key={k}
                  className={`${s.month}${edge ? ` ${s.selected}` : ''}${inside ? ` ${r.inRange}` : ''}${
                    k === thisMonth ? ` ${s.current}` : ''
                  }`}
                  aria-pressed={edge || inside}
                  onMouseEnter={() => setHover(k)}
                  onClick={() => pick(k)}
                >
                  {m}
                </button>
              );
            })}
          </div>
          <div className={s.footer}>
            <button
              type="button"
              className={s.link}
              onClick={() => commit(`${thisMonth.slice(0, 4)}-01`, thisMonth)}
            >
              This year
            </button>
            <button type="button" className={s.link} onClick={() => commit(thisMonth, thisMonth)}>
              This month
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
