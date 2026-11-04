import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import s from './HeaderFilter.module.css';

export type SortDir = 'asc' | 'desc';
/** What the column holds, for Excel's sort wording (A to Z, Smallest to Largest…). */
type Kind = 'text' | 'number' | 'date';

const SORT_LABELS: Record<Kind, [string, string]> = {
  text: ['Sort A to Z', 'Sort Z to A'],
  number: ['Sort Smallest to Largest', 'Sort Largest to Smallest'],
  date: ['Sort Oldest to Newest', 'Sort Newest to Oldest'],
};
const BLANK = '(Blanks)';

/**
 * A table header with an Excel-style filter: click it for sort, a search box and a checklist of
 * the column's values. The parent keeps which column is open and fetches that column's values
 * (`values`, '' for blank cells); `selected` is the values kept, undefined when unfiltered.
 */
export function HeaderFilter({
  label,
  kind = 'text',
  open,
  onOpen,
  onClose,
  values,
  loading,
  selected,
  sort,
  format = (v) => v,
  onApply,
  onSort,
}: {
  label: string;
  kind?: Kind;
  /** Kept for callers; the chevron always follows the label now. */
  align?: 'right';
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  values: string[] | undefined;
  loading: boolean;
  selected: string[] | undefined;
  sort: SortDir | undefined;
  format?: (v: string) => string;
  /** The values to keep, or undefined to clear this column's filter. */
  onApply: (kept: string[] | undefined) => void;
  onSort: (dir: SortDir) => void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const filtered = selected !== undefined;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`${s.head} ${filtered || sort ? s.on : ''}`}
        onClick={() => (open ? onClose() : onOpen())}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={filtered ? `${label}: filtered` : `Filter ${label}`}
      >
        <span>{label}</span>
        <SortIcon on={filtered || !!sort} />
      </button>
      {open &&
        createPortal(
          <Panel
            anchor={btn.current}
            label={label}
            kind={kind}
            values={values}
            loading={loading}
            selected={selected}
            format={format}
            onClose={onClose}
            onApply={(kept) => {
              onApply(kept);
              onClose();
            }}
            onSort={(dir) => {
              onSort(dir);
              onClose();
            }}
          />,
          document.body,
        )}
    </>
  );
}

function Panel({
  anchor,
  label,
  kind,
  values,
  loading,
  selected,
  format,
  onClose,
  onApply,
  onSort,
}: {
  anchor: HTMLElement | null;
  label: string;
  kind: Kind;
  values: string[] | undefined;
  loading: boolean;
  selected: string[] | undefined;
  format: (v: string) => string;
  onClose: () => void;
  onApply: (kept: string[] | undefined) => void;
  onSort: (dir: SortDir) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [search, setSearch] = useState('');
  // Ticked values; filled once the column's values arrive.
  const [checked, setChecked] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (values && !checked) setChecked(new Set(selected ?? values));
  }, [values, selected, checked]);

  // Under the header, kept on screen.
  useLayoutEffect(() => {
    if (!anchor || !panel.current) return;
    const r = anchor.getBoundingClientRect();
    const w = panel.current.offsetWidth;
    setPos({
      top: r.bottom + 4,
      left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)),
    });
  }, [anchor]);

  // Closes on a click outside, Escape, or when the page scrolls or resizes under it.
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const scroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  const shown = (v: string) => (v === '' ? BLANK : format(v));
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (values ?? []).filter((v) => !term || shown(v).toLowerCase().includes(term));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, search]);
  const ticked = checked ?? new Set<string>();
  const allVisible = visible.length > 0 && visible.every((v) => ticked.has(v));
  const someVisible = visible.some((v) => ticked.has(v));

  const toggle = (v: string) => {
    const next = new Set(ticked);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setChecked(next);
  };
  const toggleAll = () => {
    const next = new Set(ticked);
    for (const v of visible) {
      if (allVisible) next.delete(v);
      else next.add(v);
    }
    setChecked(next);
  };
  // As Excel: while searching, OK keeps the ticked values among those found.
  const kept = (search.trim() ? visible : (values ?? [])).filter((v) => ticked.has(v));
  const apply = () => {
    const everything = !search.trim() && values && kept.length === values.length;
    onApply(everything ? undefined : kept);
  };
  const [up, down] = SORT_LABELS[kind];

  return (
    <div
      ref={panel}
      className={s.panel}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
      role="dialog"
      aria-label={`Filter ${label}`}
    >
      <button type="button" className={s.item} onClick={() => onSort('asc')}>
        <span className={s.icon}>↑</span> {up}
      </button>
      <button type="button" className={s.item} onClick={() => onSort('desc')}>
        <span className={s.icon}>↓</span> {down}
      </button>
      <button
        type="button"
        className={s.item}
        disabled={selected === undefined}
        onClick={() => onApply(undefined)}
      >
        <span className={s.icon}>✕</span> Clear filter from “{label}”
      </button>
      <hr className={s.rule} />
      <input
        className={s.search}
        type="search"
        placeholder="Search"
        value={search}
        autoFocus
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && kept.length > 0 && apply()}
        aria-label={`Search ${label} values`}
      />
      <div className={s.list}>
        {loading || !checked ? (
          <div className={s.note}>Loading…</div>
        ) : !visible.length ? (
          <div className={s.note}>No matches</div>
        ) : (
          <>
            <label className={s.check}>
              <input
                type="checkbox"
                checked={allVisible}
                ref={(el) => {
                  if (el) el.indeterminate = !allVisible && someVisible;
                }}
                onChange={toggleAll}
              />
              {search.trim() ? '(Select All Search Results)' : '(Select All)'}
            </label>
            {visible.map((v) => (
              <label key={v} className={s.check}>
                <input type="checkbox" checked={ticked.has(v)} onChange={() => toggle(v)} />
                <span className={v === '' ? s.blank : undefined}>{shown(v)}</span>
              </label>
            ))}
          </>
        )}
      </div>
      <div className={s.actions}>
        <button type="button" className={s.ok} disabled={!kept.length} onClick={apply}>
          OK
        </button>
        <button type="button" className={s.cancel} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** A chevron: down while the column is neither filtered nor sorted, up in cyan once it is. */
function SortIcon({ on }: { on: boolean }) {
  return (
    <span className={s.sortIcon}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={on ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
      </svg>
    </span>
  );
}
