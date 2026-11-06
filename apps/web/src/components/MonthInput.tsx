import { useEffect, useRef, useState } from 'react';
import { ui } from './ui';
import s from './MonthInput.module.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10" → [2026, 10]; anything else → null. */
function parse(v: string): [number, number] | null {
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? [Number(m[1]), month] : null;
}

const key = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

/** This month as `YYYY-MM` (local time). */
export const currentMonth = (d = new Date()) => key(d.getFullYear(), d.getMonth() + 1);

/**
 * A month picker that behaves the same in every browser. `<input type="month">`
 * is a bare text box in Firefox and desktop Safari, so this replaces it.
 * Value and onChange use the same `YYYY-MM` string ('' = no month).
 */
export function MonthInput({
  value,
  onChange,
  min,
  max,
  placeholder = 'Any month',
  clearable = true,
  className,
  'aria-label': ariaLabel,
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  /** Show Clear in the panel (set false when a month is required). */
  clearable?: boolean;
  className?: string;
  'aria-label'?: string;
  title?: string;
}) {
  const parsed = parse(value);
  const now = new Date();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(parsed?.[0] ?? now.getFullYear());
  const ref = useRef<HTMLDivElement>(null);

  // Each time it opens, show the selected month's year (or this year).
  useEffect(() => {
    if (open) setYear(parse(value)?.[0] ?? new Date().getFullYear());
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  // YYYY-MM strings compare correctly as text.
  const outOfRange = (k: string) => (!!min && k < min) || (!!max && k > max);
  const thisMonth = currentMonth(now);

  return (
    <div className={s.wrap} ref={ref}>
      <button
        type="button"
        className={`${ui.input} ${s.trigger} ${className ?? ''}`}
        aria-label={ariaLabel}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={parsed ? undefined : s.placeholder}>
          {parsed ? `${MONTHS[parsed[1] - 1]} ${parsed[0]}` : placeholder}
        </span>
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
        <div className={s.panel} role="dialog" aria-label={ariaLabel ?? 'Pick a month'}>
          <div className={s.yearRow}>
            <button
              type="button"
              className={s.nav}
              aria-label="Previous year"
              disabled={!!min && year <= Number(min.slice(0, 4))}
              onClick={() => setYear((y) => y - 1)}
            >
              ‹
            </button>
            <span className={s.year}>{year}</span>
            <button
              type="button"
              className={s.nav}
              aria-label="Next year"
              disabled={!!max && year >= Number(max.slice(0, 4))}
              onClick={() => setYear((y) => y + 1)}
            >
              ›
            </button>
          </div>
          <div className={s.grid}>
            {MONTHS.map((label, i) => {
              const k = key(year, i + 1);
              return (
                <button
                  type="button"
                  key={k}
                  className={`${s.month}${k === value ? ` ${s.selected}` : ''}${
                    k === thisMonth ? ` ${s.current}` : ''
                  }`}
                  aria-pressed={k === value}
                  disabled={outOfRange(k)}
                  onClick={() => pick(k)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className={s.footer}>
            {clearable ? (
              <button type="button" className={s.link} onClick={() => pick('')}>
                Clear
              </button>
            ) : (
              <span />
            )}
            {!outOfRange(thisMonth) && (
              <button type="button" className={s.link} onClick={() => pick(thisMonth)}>
                This month
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
