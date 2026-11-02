import { useEffect, useState } from 'react';
import t from './PlansTable.module.css';

export type SortDir = 'asc' | 'desc' | null;

/** ↑ / ↓ when sorted by this column; a faint ↕ on hover otherwise. */
export function SortButton({
  label,
  dir,
  onSort,
}: {
  label: string;
  dir: 'asc' | 'desc' | null;
  onSort: () => void;
}) {
  return (
    <button
      type="button"
      className={`${t.headBtn} ${t.sort}`}
      data-dir={dir ?? undefined}
      aria-label={`Sort by ${label}`}
      title={`Sort by ${label}`}
      onClick={onSort}
    >
      {dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '↕'}
    </button>
  );
}

/**
 * A column header that reads as its name and is also its search box: click it and type.
 * Searches once typing pauses (or at once on Enter); × clears. `value` null = not searchable.
 */
export function HeadCell({
  label,
  value,
  onSearch,
  dir,
  onSort,
}: {
  label: string;
  value: string | null;
  onSearch: (v: string) => void;
  dir: 'asc' | 'desc' | null;
  onSort: () => void;
}) {
  const [text, setText] = useState(value ?? '');
  // Follows the URL (Clear filters, back button).
  useEffect(() => setText(value ?? ''), [value]);
  useEffect(() => {
    if (value === null || text.trim() === value) return;
    const timer = setTimeout(() => onSearch(text.trim()), 400);
    return () => clearTimeout(timer);
  }, [text, value, onSearch]);
  return (
    <div className={t.head} data-filled={!!value}>
      {value === null ? (
        <span className={t.headInput} style={{ display: 'flex', alignItems: 'center' }}>
          {label}
        </span>
      ) : (
        <input
          className={t.headInput}
          placeholder={label}
          aria-label={`Search ${label}`}
          title={`Search ${label}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearch(text.trim());
            if (e.key === 'Escape') onSearch('');
          }}
        />
      )}
      {value && (
        <button
          type="button"
          className={t.headBtn}
          aria-label={`Clear ${label} search`}
          title="Clear"
          onClick={() => onSearch('')}
        >
          ×
        </button>
      )}
      <SortButton label={label} dir={dir} onSort={onSort} />
    </div>
  );
}
