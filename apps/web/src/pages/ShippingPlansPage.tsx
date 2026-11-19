import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SHIPMENT_STATUS_LABEL, type ShipmentStatus } from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { useLookups, useShipmentColumnValues, useShipments } from '../features/hooks';
import { ShipmentStatusPill } from '../components/StatusPill';
import { Pager, TableState, ui } from '../components/ui';
<<<<<<< Updated upstream
import { SearchBox } from '../components/SearchBox';
import { MonthInput, currentMonth } from '../components/MonthInput';
=======
>>>>>>> Stashed changes
import { HeaderFilter } from '../components/HeaderFilter';
import { useHeaderFilters } from '../components/useHeaderFilters';
import { useToast } from '../components/Toast';
import { downloadFile } from '../lib/files';
import { ImportPlanDialog } from './plans/ImportPlanDialog';
import { StatusRulesDialog } from './plans/StatusRulesDialog';
import { fmtDate } from '../lib/format';
import { BASE_COLUMNS, EXPANDED_COLUMNS, type PlanColumn } from './plans/columns';
import { PlansFilter, type PlansFilterValue } from './plans/PlansFilter';
import { PlansMoreMenu } from './plans/PlansMoreMenu';
<<<<<<< Updated upstream
=======
import { CardToggle } from './dashboard/parts';
import s from './ShippingPlansPage.module.css';
>>>>>>> Stashed changes

const PREFS = 'gs:plans-view';
const currentMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date()).slice(0, 7);
const columnsFor = (expand: boolean, direction: 'IMPORT' | 'EXPORT') =>
  [...BASE_COLUMNS, ...(expand ? EXPANDED_COLUMNS : [])].filter((c) =>
    direction === 'EXPORT' ? !c.importOnly : !c.exportOnly,
  );

const STATUS_FILTERS: { value: '' | ShipmentStatus; label: string }[] = [
  { value: '', label: 'All shipments' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'COMPLETED', label: 'Completed' },
];

function readPrefs(): { expandAll: boolean; frozen: string[] } {
  try {
    return {
      expandAll: false,
      frozen: [],
      ...(JSON.parse(localStorage.getItem(PREFS) ?? '{}') as object),
    };
  } catch {
    return { expandAll: false, frozen: [] };
  }
}

export function ShippingPlansPage({ direction }: { direction: 'IMPORT' | 'EXPORT' }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const lookups = useLookups();
  const [prefs, setPrefs] = useState(readPrefs);
  const [exporting, setExporting] = useState(false);
  const header = useHeaderFilters(params, setParams);
  const defaultMonth = currentMonth();

  // A plain visit (sidebar, or only direction/sort in the link) opens on this month.
  // Links that bring a search, client or status keep every month so their counts match.
  // "All months" is kept in the URL as month=all so Clear doesn't snap back.
  const rawMonth = params.get('month');
  const autoMonth =
    rawMonth === null && !params.get('q') && !params.has('clientId') && !params.get('status');
  useEffect(() => {
    if (!autoMonth) return;
    const next = new URLSearchParams(params);
    next.set('month', currentMonth());
    setParams(next, { replace: true });
  }, [autoMonth, params, setParams]);

  const filters = {
    clientId: params.getAll('clientId'),
<<<<<<< Updated upstream
    // Import Plans or Export Plans, from the route (the sidebar's Shipping Plans dropdown).
    direction,
    status: (params.get('status') ?? '') as PlansFilterValue['status'],
    // Declaration month (YYYY-MM), or the month added while undeclared; empty = every month.
    month: rawMonth === 'all' ? '' : (rawMonth ?? (autoMonth ? currentMonth() : '')),
=======
    // Always Import or Export (Import unless the link asks for Export).
    direction: (params.get('direction') === 'EXPORT' ? 'EXPORT' : 'IMPORT') as 'IMPORT' | 'EXPORT',
    status: (params.get('status') ?? '') as '' | ShipmentStatus,
    // Default to the current month; an explicitly empty month means all months.
    month: params.get('month') ?? defaultMonth,
>>>>>>> Stashed changes
    q: params.get('q') ?? '',
    page: Number(params.get('page') ?? 1),
    // Newest customs clearance (declaration) date first, unless another order is picked.
    sort: params.get('sort') ?? '-clearanceDate',
  };
  const query = {
    page: filters.page,
    pageSize: Number(params.get('pageSize') ?? 50),
    sort: filters.sort,
    q: filters.q || undefined,
    clientId: filters.clientId,
    direction: filters.direction,
    status: filters.status || undefined,
    month: filters.month || undefined,
    filters: header.raw,
  };
  const list = useShipments(query);
  // The open header filter's values come from the list's other filters, not the page.
  const { page: _page, pageSize: _size, sort: _sort, ...valuesQuery } = query;
  const colValues = useShipmentColumnValues(header.openCol, valuesQuery);
  const cols = useMemo(
    () => columnsFor(prefs.expandAll, filters.direction),
    [prefs.expandAll, filters.direction],
  );
  // Export rows end on ETD / ATD (leaving Cambodia) instead of Arrive FTY.
  const isExport = filters.direction === 'EXPORT';

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (k === 'month' && !v) next.set(k, '');
    else if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: k === 'q' });
  };

  // Freeze panes: pin chosen columns with sticky `left` offsets measured from the header.
  const headRef = useRef<HTMLTableRowElement>(null);
  const [lefts, setLefts] = useState<Record<string, number>>({});
  const frozenKeys = cols.filter((c) => prefs.frozen.includes(c.key)).map((c) => c.key);
  useLayoutEffect(() => {
    const ths = Array.from(headRef.current?.children ?? []) as HTMLElement[];
    let acc = 0;
    const next: Record<string, number> = {};
    cols.forEach((c, i) => {
      if (frozenKeys.includes(c.key)) {
        next[c.key] = acc;
        acc += ths[i]?.offsetWidth ?? 0;
      }
    });
    setLefts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, prefs.frozen.join(','), list.data]);
  const frozenProps = (key: string) => {
    if (!(key in lefts)) return {};
    const edge = frozenKeys[frozenKeys.length - 1] === key;
    return {
      className: `frozen-col${edge ? ' frozen-col-edge' : ''}`,
      style: { left: lefts[key] },
    };
  };

  const [importing, setImporting] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try {
      await downloadFile('/shipments/export.xlsx', {
        clientId: filters.clientId,
        direction: filters.direction || undefined,
        status: filters.status || undefined,
        month: filters.month || undefined,
        q: filters.q || undefined,
        sort: filters.sort,
        filters: header.raw,
      });
    } catch {
      toast('Export failed. Try again.');
    } finally {
      setExporting(false);
    }
  };

  // Excel-style header: a column's filter and sort ("?sort=hbl" / "-hbl").
  const head = (c: Pick<PlanColumn, 'key' | 'label' | 'kind' | 'format'>) => (
    <HeaderFilter
      label={c.label}
      kind={c.kind}
      format={c.format}
      open={header.openCol === c.key}
      onOpen={() => header.setOpenCol(c.key)}
      onClose={header.close}
      values={header.openCol === c.key ? colValues.data : undefined}
      loading={colValues.isLoading}
      selected={header.filters[c.key]}
      // The default order (newest clearance first) doesn't light its column; a picked sort does.
      sort={
        !params.has('sort')
          ? undefined
          : filters.sort === c.key
            ? 'asc'
            : filters.sort === `-${c.key}`
              ? 'desc'
              : undefined
      }
      onApply={(kept) => header.apply(c.key, kept)}
      onSort={(d) => setParam('sort', d === 'asc' ? c.key : `-${c.key}`)}
    />
  );

  const filterValue: PlansFilterValue = {
    ...prefs,
  };
  const hasActiveFilters = Boolean(
    filters.q ||
    (params.has('month') && filters.month !== defaultMonth) ||
    filters.clientId.length ||
    filters.direction === 'EXPORT' ||
    filters.status ||
    header.active ||
    params.has('sort'),
  );
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    ['q', 'month', 'clientId', 'direction', 'status', 'page', 'f', 'sort'].forEach((key) =>
      next.delete(key),
    );
    setParams(next, { replace: true });
  };
  const applyView = (value: PlansFilterValue) => {
    setPrefs(value);
    localStorage.setItem(PREFS, JSON.stringify(value));
  };

  return (
    <section className="view active caps-values" id="view-plans">
      <div className={`card ${s.pageCard}`}>
        <header className={s.pageHeader}>
          <h1>Shipping plans</h1>
        </header>
        <div className={s.controls}>
          <div className={s.filterToolbar}>
            <div className={s.monthControl}>
              <input
                type="month"
                className={`${ui.input} ${s.monthFilter}`}
                value={filters.month}
                onChange={(e) => setParam('month', e.target.value)}
                aria-label="Declaration month"
                title="Filter by declaration month"
              />
              <button
                type="button"
                className="filter-mini-link"
                onClick={() => setParam('month', filters.month ? '' : defaultMonth)}
              >
                {filters.month ? 'All months' : 'This month'}
              </button>
            </div>
<<<<<<< Updated upstream
          </div>
          <div className={ui.toolbar}>
            <SearchBox
              grow
              placeholder="Invoice, HBL, container, declare no…"
              defaultValue={filters.q}
              aria-label="Search shipments"
              key={filters.q}
              onKeyDown={(e) =>
                e.key === 'Enter' && setParam('q', (e.target as HTMLInputElement).value.trim())
              }
              onBlur={(e) =>
                e.target.value.trim() !== filters.q && setParam('q', e.target.value.trim())
              }
            />
            <MonthInput
              value={filters.month}
              onChange={(v) => setParam('month', v || 'all')}
              placeholder="All months"
              aria-label="Declaration month"
              title="Declaration month"
            />
=======
>>>>>>> Stashed changes
            <select
              className={`${ui.input} ${s.clientFilter}`}
              value={filters.clientId.length === 1 ? filters.clientId[0] : ''}
              onChange={(e) => setParam('clientId', e.target.value)}
              aria-label="Client"
            >
              <option value="">All clients</option>
              {lookups.data?.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
<<<<<<< Updated upstream
=======
            {/* Always Import or Export; the URL only carries Export. One click flips it,
                like the Overview's Forwarder Statistics toggle. */}
            <CardToggle
              label="Import or Export"
              triggerClass={s.directionToggle}
              value={filters.direction}
              onChange={(d) => setParam('direction', d === 'EXPORT' ? 'EXPORT' : '')}
              options={[
                { value: 'IMPORT', label: 'Import' },
                { value: 'EXPORT', label: 'Export' },
              ]}
            />
>>>>>>> Stashed changes
            <PlansFilter
              value={filterValue}
              onApply={applyView}
              columnsFor={(expand) => columnsFor(expand, filters.direction)}
            />
            {hasActiveFilters && (
              <button type="button" className={ui.ghostBtn} onClick={clearFilters}>
                Clear all
              </button>
            )}
            <PlansMoreMenu
              exporting={exporting}
              onExport={() => void doExport()}
              onImport={can('shipments:write') ? () => setImporting(true) : undefined}
              onTemplate={
                can('shipments:write')
                  ? () =>
                      void downloadFile('/shipments/import-template.xlsx').catch(() =>
                        toast('The template could not be downloaded. Try again.'),
                      )
                  : undefined
              }
              onStatusRules={() => setRulesOpen(true)}
            />
          </div>
          <div className={s.statusBar}>
            <div className={s.statusFilters} role="group" aria-label="Filter shipments by status">
              {STATUS_FILTERS.map((status) => (
                <button
                  key={status.value || 'all'}
                  type="button"
                  className={`${s.statusFilter} ${
                    filters.status === status.value ? s.statusFilterActive : ''
                  }`}
                  aria-pressed={filters.status === status.value}
                  onClick={() => setParam('status', status.value)}
                >
                  {status.label}
                </button>
              ))}
            </div>
            <p className={s.resultCount} aria-live="polite">
              {list.data
                ? `${list.data.meta.total.toLocaleString()} ${
                    filters.status ? SHIPMENT_STATUS_LABEL[filters.status] + ' ' : ''
                  }shipment${list.data.meta.total === 1 ? '' : 's'}`
                : 'Loading shipments…'}
            </p>
          </div>
        </div>
        {filters.q && (
          <div className={s.searchSummary}>
            Showing results for “{filters.q}”.{' '}
            <button type="button" className="filter-mini-link" onClick={() => setParam('q', '')}>
              Clear search
            </button>
          </div>
        )}
        <div className={`plans-table-scroll${prefs.expandAll ? ' expanded' : ''}`}>
          <table className={`data-table-clean ${s.table}`}>
            <thead>
              <tr ref={headRef}>
                {cols.map((c) => (
                  <th key={c.key} {...frozenProps(c.key)}>
                    {head(c)}
                  </th>
                ))}
                {isExport ? (
                  <>
                    <th>{head({ key: 'etd', label: 'ETD', kind: 'date', format: fmtDate })}</th>
                    <th>{head({ key: 'atd', label: 'ATD', kind: 'date', format: fmtDate })}</th>
                  </>
                ) : (
                  <th>
                    {head({ key: 'arriveFty', label: 'Arrive FTY', kind: 'date', format: fmtDate })}
                  </th>
                )}
                <th>
                  {head({
                    key: 'status',
                    label: 'Status',
                    format: (v) => SHIPMENT_STATUS_LABEL[v as ShipmentStatus] ?? v,
                  })}
                </th>
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={cols.length + (isExport ? 3 : 2)}
                loading={list.isLoading}
                error={list.error}
                empty={list.data?.data.length === 0}
                emptyText={
                  filters.q ||
                  filters.clientId.length ||
                  filters.month ||
                  filters.direction === 'EXPORT' ||
                  filters.status ||
                  header.active
                    ? 'No shipments match the selected filters.'
                    : 'No shipments yet. Create one with “New Shipment”.'
                }
              />
              {list.data?.data.map((r) => (
                <tr
                  key={r.id}
                  className="plans-row-clickable"
                  tabIndex={0}
                  onClick={() => navigate(`/plans/${r.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/plans/${r.id}`)}
                >
                  {cols.map((c) => {
                    const fp = frozenProps(c.key);
                    return (
                      <td
                        key={c.key}
                        {...fp}
                        className={
                          [fp.className, c.bold ? 'val-bold' : ''].filter(Boolean).join(' ') ||
                          undefined
                        }
                      >
                        {c.render(r)}
                      </td>
                    );
                  })}
                  {isExport ? (
                    <>
                      <td>{fmtDate(r.etd)}</td>
                      <td>{fmtDate(r.atd)}</td>
                    </>
                  ) : (
                    <td>{fmtDate(r.arriveFty)}</td>
                  )}
                  <td>
                    <ShipmentStatusPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && (
          <Pager
            {...list.data.meta}
            onPage={(p) => setParam('page', String(p))}
            onPageSize={(n) => setParam('pageSize', String(n))}
          />
        )}
      </div>
      {importing && <ImportPlanDialog onClose={() => setImporting(false)} />}
      {rulesOpen && <StatusRulesDialog onClose={() => setRulesOpen(false)} />}
    </section>
  );
}
