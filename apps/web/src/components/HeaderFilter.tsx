import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import s from './HeaderFilter.module.css';

export type SortDir = 'asc' | 'desc';
/** What the column holds (kept for callers; the search works the same for each). */
type Kind = 'text' | 'number' | 'date';

const BLANK = '(Blanks)';
/** What each column was last searched for, so its box still shows the term after a re-render. */
const lastTerm = new Map<string, string>();

/**
 * A table header that is its own search box: the column name is the placeholder, so typing
 * straight into it filters the list as you go (every value containing the text). Suggestions
 * under it keep just one value; the arrow inside sorts (A→Z, again Z→A); × clears. A column
 * with a short fixed list (`options`, e.g. Status) is a dropdown instead.
 *
 * The parent keeps which column is focused (`open`) and fetches its values (`values`, '' for
 * blank cells); `selected` is the values kept, undefined when unfiltered.
 */
export function HeaderFilter({
  label,
  open,
  onOpen,
  onClose,
  values,
  loading,
  selected,
  sort,
  format = (v) => v,
  options,
  onApply,
  onSort,
}: {
  label: string;
  kind?: Kind;
  /** Kept for callers. */
  align?: 'right';
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  values: string[] | undefined;
  loading: boolean;
  selected: string[] | undefined;
  sort: SortDir | undefined;
  format?: (v: string) => string;
  /** A short fixed list (Status…): the header is a dropdown of these instead of a search box. */
  options?: { value: string; label: string }[] | undefined;
  /** The values to keep, or undefined to clear this column's filter. */
  onApply: (kept: string[] | undefined) => void;
  onSort: (dir: SortDir) => void;
}) {
  const filtered = selected !== undefined;
  const sortBtn = (
    <button
      type="button"
      className={`${s.sort} ${sort ? s.sortOn : ''}`}
      onClick={() => onSort(sort === 'asc' ? 'desc' : 'asc')}
      aria-label={
        sort === 'asc'
          ? `${label}: sorted A to Z`
          : sort === 'desc'
            ? `${label}: sorted Z to A`
            : `Sort by ${label}`
      }
      title={
        sort === 'asc'
          ? 'Sorted A → Z (click for Z → A)'
          : sort === 'desc'
            ? 'Sorted Z → A (click for A → Z)'
            : `Sort by ${label}`
      }
    >
      {sort === 'desc' ? '↓' : sort === 'asc' ? '↑' : '↕'}
    </button>
  );

  if (options)
    return (
      <span className={`${s.box} ${filtered ? s.boxOn : ''}`}>
        <select
          className={s.select}
          value={selected?.length === 1 ? selected[0] : ''}
          aria-label={`Filter ${label}`}
          onChange={(e) => onApply(e.target.value ? [e.target.value] : undefined)}
        >
          <option value="">{label}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {sortBtn}
      </span>
    );

  return (
    <SearchHead
      label={label}
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      values={values}
      loading={loading}
      selected={selected}
      format={format}
      onApply={onApply}
      sortBtn={sortBtn}
    />
  );
}

function SearchHead({
  label,
  open,
  onOpen,
  onClose,
  values,
  loading,
  selected,
  format,
  onApply,
  sortBtn,
}: {
  label: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  values: string[] | undefined;
  loading: boolean;
  selected: string[] | undefined;
  format: (v: string) => string;
  onApply: (kept: string[] | undefined) => void;
  sortBtn: ReactNode;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const shown = (v: string) => (v === '' ? BLANK : format(v));
  /** What the box shows for the current filter: the term typed, or the one value kept. */
  const describe = () =>
    selected === undefined
      ? ''
      : (lastTerm.get(label) ??
        (selected.length === 1 ? shown(selected[0]!) : `${selected.length} values`));
  const [text, setText] = useState(describe);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const q = text.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q
        ? (values ?? []).filter(
            (v) => v !== '' && (shown(v).toLowerCase().includes(q) || v.toLowerCase().includes(q)),
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [values, q],
  );

  // What the list is filtered by now (lower case), so the same text isn't applied twice.
  const applied = useRef<string | null>(text.trim().toLowerCase() || null);
  // Cleared or changed from outside (Clear all, a link): the box follows while not in use.
  useEffect(() => {
    if (open) return;
    const now = describe();
    setText(now);
    applied.current = now.trim().toLowerCase() || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, open]);

  const commit = () => {
    if (!values || (q || null) === applied.current) return;
    applied.current = q || null;
    if (q) lastTerm.set(label, text.trim());
    else lastTerm.delete(label);
    onApply(q ? matches : undefined);
  };
  // Filter as you type (a short pause first), once the column's values are in.
  useEffect(() => {
    if (!open || !values) return;
    const t = window.setTimeout(commit, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, values, open]);

  // Suggestions sit under the box.
  useLayoutEffect(() => {
    if (!open) return;
    const r = box.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 200) });
  }, [open]);

  // A click outside, or the page scrolling under it, closes the suggestions (the filter stays).
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !list.current?.contains(t)) {
        commitRef.current();
        onClose();
      }
    };
    const scroll = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', down);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', down);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [open, onClose]);

  const pick = (v: string) => {
    // One value picked: the box shows that value itself.
    lastTerm.delete(label);
    applied.current = shown(v).toLowerCase();
    setText(shown(v));
    onApply([v]);
    onClose();
  };
  const clear = () => {
    lastTerm.delete(label);
    applied.current = null;
    setText('');
    onApply(undefined);
  };

  return (
    <span ref={box} className={`${s.box} ${selected !== undefined ? s.boxOn : ''}`}>
      <input
        className={s.input}
        type="text"
        value={text}
        placeholder={label}
        size={Math.max(label.length + 2, 8)}
        aria-label={`Search ${label}`}
        onFocus={onOpen}
        onChange={(e) => {
          setText(e.target.value);
          if (!open) onOpen();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            commit();
            onClose();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {text ? (
        <button
          type="button"
          className={s.clear}
          aria-label={`Clear ${label} filter`}
          onClick={clear}
        >
          ×
        </button>
      ) : (
        sortBtn
      )}
      {open &&
        pos &&
        q &&
        createPortal(
          <div
            ref={list}
            className={s.suggest}
            style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
            role="listbox"
            aria-label={`${label} values`}
          >
            {loading || !values ? (
              <div className={s.note}>Loading…</div>
            ) : !matches.length ? (
              <div className={s.note}>
                No {label.toLowerCase()} contains “{text.trim()}”
              </div>
            ) : (
              <>
                <div className={s.note}>
                  {matches.length} match{matches.length === 1 ? '' : 'es'} · Enter keeps all
                </div>
                {matches.slice(0, 8).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className={s.option}
                    onClick={() => pick(v)}
                  >
                    {shown(v)}
                  </button>
                ))}
              </>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
