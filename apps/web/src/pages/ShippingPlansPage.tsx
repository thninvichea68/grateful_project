import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SHIPMENT_STATUS_LABEL, SHIPMENT_STATUSES, type ShipmentStatus } from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import {
  useLookups,
  useShipmentColumnValues,
  useShipmentSummary,
  useShipments,
} from '../features/hooks';
import { Pill, ShipmentStatusPill } from '../components/StatusPill';
import { Pager, TableState, ui } from '../components/ui';
import { MonthInput } from '../components/MonthInput';
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
import { CardToggle } from './dashboard/parts';
import { PlanSummary } from './plans/PlanSummary';
import s from './ShippingPlansPage.module.css';

const PREFS = 'gs:plans-view';
const currentMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date()).slice(0, 7);
const columnsFor = (expand: boolean, direction: 'IMPORT' | 'EXPORT') =>
  [...BASE_COLUMNS, ...(expand ? EXPANDED_COLUMNS : [])].filter((c) =>
    direction === 'EXPORT' ? !c.importOnly : !c.exportOnly,
  );

const monthLabel = (month: string) =>
  month
    ? new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${month}-01T00:00:00Z`),
      )
    : 'All months';

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
    rawMonth === null &&
    !params.get('q') &&
    !params.has('clientId') &&
    !params.get('status') &&
    !params.get('billing');
  useEffect(() => {
    if (!autoMonth) return;
    const next = new URLSearchParams(params);
    next.set('month', currentMonth());
    setParams(next, { replace: true });
  }, [autoMonth, params, setParams]);

  const filters = {
    clientId: params.getAll('clientId'),
    // Import Plans or Export Plans, from the route (the sidebar's Shipping Plans dropdown).
    direction,
    status: (params.get('status') ?? '') as '' | ShipmentStatus,
    // UNBILLED: completed, nothing issued to the client yet (the follow-up list).
    billing: params.get('billing') === 'UNBILLED' ? ('UNBILLED' as const) : undefined,
    // Declaration month (YYYY-MM), or the month added while undeclared; empty = every month.
    month: rawMonth === 'all' ? '' : (rawMonth ?? (autoMonth ? currentMonth() : '')),
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
    billing: filters.billing,
    filters: header.raw,
  };
  const list = useShipments(query);
  const summary = useShipmentSummary({
    clientId: filters.clientId,
    direction: filters.direction,
    month: filters.month || undefined,
  });
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
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: k === 'q' });
  };
  // The headline cards filter the table: one status, or the unbilled follow-up list.
  const setView = (v: { status?: string; billing?: boolean; allMonths?: boolean }) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    if (v.status) next.set('status', v.status);
    else next.delete('status');
    if (v.billing) next.set('billing', 'UNBILLED');
    else next.delete('billing');
    if (v.allMonths) next.set('month', 'all');
    setParams(next);
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
        billing: filters.billing,
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
  const head = (
    c: Pick<PlanColumn, 'key' | 'label' | 'kind' | 'format'> & {
      options?: { value: string; label: string }[];
    },
  ) => (
    <HeaderFilter
      label={c.label}
      options={c.options}
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
    filters.billing ||
    header.active ||
    params.has('sort'),
  );
  const clearFilters = () => {
    const next = new URLSearchParams(params);
    ['q', 'month', 'clientId', 'direction', 'status', 'billing', 'page', 'f', 'sort'].forEach(
      (key) => next.delete(key),
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
        <div className={s.controls}>
          <div className={s.filterToolbar} role="toolbar" aria-label="Shipping plan tools">
            <div className={s.monthControl}>
              <MonthInput
                value={filters.month}
                onChange={(month) => setParam('month', month || 'all')}
                placeholder="All months"
                aria-label="Declaration month"
                title="Declaration month"
                className={s.monthFilter}
              />
            </div>
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
            {/* Always Import or Export; the URL only carries Export. One click flips it,
                like the Overview's Forwarder Statistics toggle. */}
            <CardToggle
              label="Import or Export"
              triggerClass={s.directionToggle}
              value={filters.direction}
              onChange={(nextDirection) => {
                const next = new URLSearchParams(params);
                next.delete('direction');
                next.delete('page');
                const search = next.toString();
                navigate(
                  `/plans/${nextDirection === 'EXPORT' ? 'export' : 'import'}${
                    search ? `?${search}` : ''
                  }`,
                );
              }}
              options={[
                { value: 'IMPORT', label: 'Import' },
                { value: 'EXPORT', label: 'Export' },
              ]}
            />
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
        </div>
        <PlanSummary
          data={summary.data}
          loading={summary.isLoading}
          monthLabel={monthLabel(filters.month)}
          allMonths={!filters.month}
          status={filters.status}
          billing={Boolean(filters.billing)}
          onView={setView}
        />
        <p className={s.resultCount} aria-live="polite">
          {list.data
            ? `${list.data.meta.total.toLocaleString()} ${
                filters.billing
                  ? 'completed, not invoiced '
                  : filters.status
                    ? SHIPMENT_STATUS_LABEL[filters.status].toLowerCase() + ' '
                    : ''
              }shipment${list.data.meta.total === 1 ? '' : 's'} · ${monthLabel(filters.month)}`
            : 'Loading shipments…'}
        </p>
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
                    // A short fixed list: a dropdown in the header.
                    options: SHIPMENT_STATUSES.map((v) => ({
                      value: v,
                      label: SHIPMENT_STATUS_LABEL[v],
                    })),
                  })}
                </th>
                <th>Billing</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={cols.length + (isExport ? 4 : 3)}
                loading={list.isLoading}
                error={list.error}
                empty={list.data?.data.length === 0}
                emptyText={
                  filters.q ||
                  filters.clientId.length ||
                  filters.month ||
                  filters.direction === 'EXPORT' ||
                  filters.status ||
                  filters.billing ||
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
                  <td>
                    {r.status !== 'COMPLETED' ? (
                      <span className={s.muted}>—</span>
                    ) : r.billed ? (
                      <Pill tone="completed">Invoiced</Pill>
                    ) : (
                      <Pill tone="exception">Not invoiced</Pill>
                    )}
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
