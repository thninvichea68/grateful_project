import { useMemo } from 'react';
import type { SetURLSearchParams } from 'react-router-dom';
import type { HeaderFilters } from '@gs/shared';
import type { HeaderFilter, SortDir } from './HeaderFilter';
import { useHeaderFilters } from './useHeaderFilters';

/** A column of a list loaded whole, for its Excel-style header filter. */
export interface LocalColumn<T> {
  key: string;
  label: string;
  kind?: 'text' | 'number' | 'date';
  /** How a value shows in the checklist. */
  format?: (v: string) => string;
  align?: 'right';
  /** The cell's value as the filter keeps it ('' = blank). */
  value: (row: T) => string | null | undefined;
}

const str = (v: string | null | undefined) => (v ?? '').trim();

/** Excel's order for the column's kind; blanks last either way. */
function compare(kind: LocalColumn<unknown>['kind'], a: string, b: string) {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  if (kind === 'number') return Number(a) - Number(b);
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

const keeps = <T>(cols: LocalColumn<T>[], filters: HeaderFilters, except?: string) => {
  const active = cols.filter((c) => c.key !== except && filters[c.key]);
  return (r: T) => active.every((c) => filters[c.key]!.includes(str(c.value(r))));
};

/**
 * Header filters and sort for a list the page already holds whole (not paged), so they run
 * here instead of on the server. Same URL (?f=… and ?sort=key|-key) and the same HeaderFilter
 * as the paged lists; a column's checklist shows what the other filters leave, as Excel does.
 */
export function useLocalHeaderFilters<T>(
  rows: T[],
  cols: LocalColumn<T>[],
  params: URLSearchParams,
  setParams: SetURLSearchParams,
) {
  const header = useHeaderFilters(params, setParams);
  const sort = params.get('sort') ?? '';
  const { filters, openCol } = header;

  const shown = useMemo(() => {
    const kept = rows.filter(keeps(cols, filters));
    const key = sort.replace(/^-/, '');
    const col = cols.find((c) => c.key === key);
    if (!col) return kept;
    const dir = sort.startsWith('-') ? -1 : 1;
    // Blanks stay last whichever way it sorts.
    return [...kept].sort((a, b) => {
      const x = str(col.value(a));
      const y = str(col.value(b));
      if (!x || !y) return compare(col.kind, x, y);
      return dir * compare(col.kind, x, y);
    });
  }, [rows, cols, filters, sort]);

  const values = useMemo(() => {
    const col = cols.find((c) => c.key === openCol);
    if (!col) return undefined;
    const vs = new Set(rows.filter(keeps(cols, filters, col.key)).map((r) => str(col.value(r))));
    return [...vs].sort((a, b) => compare(col.kind, a, b));
  }, [rows, cols, filters, openCol]);

  const setSort = (key: string, dir: SortDir) => {
    const next = new URLSearchParams(params);
    next.set('sort', dir === 'asc' ? key : `-${key}`);
    setParams(next, { replace: true });
  };

  /** The HeaderFilter props for a column. */
  const headProps = (c: LocalColumn<T>): Parameters<typeof HeaderFilter>[0] => ({
    label: c.label,
    kind: c.kind,
    align: c.align,
    format: c.format,
    open: openCol === c.key,
    onOpen: () => header.setOpenCol(c.key),
    onClose: header.close,
    values: openCol === c.key ? values : undefined,
    loading: false,
    selected: filters[c.key],
    sort: sort === c.key ? 'asc' : sort === `-${c.key}` ? 'desc' : undefined,
    onApply: (kept) => header.apply(c.key, kept),
    onSort: (d) => setSort(c.key, d),
  });

  return { rows: shown, headProps, active: header.active };
}
