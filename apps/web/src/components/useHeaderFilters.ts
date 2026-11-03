import { useCallback, useState } from 'react';
import type { SetURLSearchParams } from 'react-router-dom';
import type { HeaderFilters } from '@gs/shared';

/**
 * A list's Excel-style header filters, kept in the URL (?f=…) so a filtered list survives a
 * reload or a link, and which column's filter is open (one at a time).
 */
export function useHeaderFilters(params: URLSearchParams, setParams: SetURLSearchParams) {
  const raw = params.get('f') || undefined;
  let filters: HeaderFilters = {};
  try {
    filters = raw ? (JSON.parse(raw) as HeaderFilters) : {};
  } catch {
    filters = {};
  }
  const [openCol, setOpenCol] = useState<string | null>(null);
  const close = useCallback(() => setOpenCol(null), []);

  const write = (next: HeaderFilters) => {
    const p = new URLSearchParams(params);
    if (Object.keys(next).length) p.set('f', JSON.stringify(next));
    else p.delete('f');
    p.delete('page');
    setParams(p, { replace: true });
  };
  /** Keep `kept` in `col`, or clear its filter (undefined). */
  const apply = (col: string, kept: string[] | undefined) => {
    const { [col]: _old, ...others } = filters;
    write(kept ? { ...others, [col]: kept } : others);
  };

  return {
    /** The filters as the API takes them (JSON), undefined when none. */
    raw,
    filters,
    openCol,
    setOpenCol,
    close,
    apply,
    active: Object.keys(filters).length > 0,
  };
}
