import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useLookups, useShipments } from '../features/hooks';
import { ShipmentStatusPill } from '../components/StatusPill';
import { Pager, TableState, ui } from '../components/ui';
import { SearchBox } from '../components/SearchBox';
import { useToast } from '../components/Toast';
import { downloadFile } from '../lib/files';
import { fmtDate } from '../lib/format';
import { BASE_COLUMNS, EXPANDED_COLUMNS } from './plans/columns';
import { PlansFilter, type PlansFilterValue } from './plans/PlansFilter';

const PREFS = 'gs:plans-view';
const columnsFor = (expand: boolean) =>
  expand ? [...BASE_COLUMNS, ...EXPANDED_COLUMNS] : BASE_COLUMNS;

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

export function ShippingPlansPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const lookups = useLookups();
  const [prefs, setPrefs] = useState(readPrefs);
  const [exporting, setExporting] = useState(false);

  const filters = {
    clientId: params.getAll('clientId'),
    direction: (params.get('direction') ?? '') as PlansFilterValue['direction'],
    status: (params.get('status') ?? '') as PlansFilterValue['status'],
    q: params.get('q') ?? '',
    page: Number(params.get('page') ?? 1),
    sort: params.get('sort') ?? '-eta',
  };
  const query = {
    page: filters.page,
    pageSize: 50,
    sort: filters.sort,
    q: filters.q || undefined,
    clientId: filters.clientId,
    direction: filters.direction || undefined,
    status: filters.status || undefined,
  };
  const list = useShipments(query);
  const cols = useMemo(() => columnsFor(prefs.expandAll), [prefs.expandAll]);

  const apply = (v: PlansFilterValue) => {
    const next = new URLSearchParams();
    v.clientIds.forEach((id) => next.append('clientId', id));
    if (v.direction) next.set('direction', v.direction);
    if (v.status) next.set('status', v.status);
    if (filters.q) next.set('q', filters.q);
    setParams(next);
    const p = { expandAll: v.expandAll, frozen: v.frozen };
    setPrefs(p);
    localStorage.setItem(PREFS, JSON.stringify(p));
  };
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
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

  const doExport = async () => {
    setExporting(true);
    try {
      await downloadFile('/shipments/export.xlsx', {
        clientId: filters.clientId,
        direction: filters.direction || undefined,
        status: filters.status || undefined,
        q: filters.q || undefined,
        sort: filters.sort,
      });
    } catch {
      toast('Export failed. Try again.');
    } finally {
      setExporting(false);
    }
  };

  const filterValue: PlansFilterValue = {
    clientIds: filters.clientId,
    direction: filters.direction,
    status: filters.status,
    ...prefs,
  };
  return (
    <section className="view active" id="view-plans">
      <div className="card">
        <div className="card-header-row">
          <div>
            <h3>Live Consignments Tracking</h3>
            <div className="create-header-desc" style={{ marginTop: 4 }}>
              Real-time status of cargo clearance and delivery checkpoints.
            </div>
          </div>
          <div className={ui.toolbar}>
            <SearchBox
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
            <select
              className={ui.input}
              value={filters.sort}
              onChange={(e) => setParam('sort', e.target.value)}
              aria-label="Sort"
            >
              <option value="-eta">Newest ETA first</option>
              <option value="eta">Oldest ETA first</option>
              <option value="-createdAt">Recently added</option>
              <option value="client,-eta">Client</option>
              <option value="status,-eta">Status</option>
            </select>
            <button
              type="button"
              className="filter-btn"
              onClick={() => void doExport()}
              disabled={exporting}
            >
              {exporting ? 'Exporting…' : 'Export Excel'}
            </button>
            <PlansFilter
              value={filterValue}
              onApply={apply}
              clients={lookups.data?.clients ?? []}
              columnsFor={columnsFor}
            />
            {can('shipments:write') && (
              <button
                type="button"
                className="new-shipment-btn"
                onClick={() => navigate('/plans/new')}
              >
                + New Shipment
              </button>
            )}
          </div>
        </div>
        {filters.q && (
          <div className="create-header-desc" style={{ marginBottom: 10 }}>
            Showing results for “{filters.q}”.{' '}
            <button type="button" className="filter-mini-link" onClick={() => setParam('q', '')}>
              Clear search
            </button>
          </div>
        )}
        <div className={`plans-table-scroll${prefs.expandAll ? ' expanded' : ''}`}>
          <table className="data-table-clean">
            <thead>
              <tr ref={headRef}>
                {cols.map((c) => (
                  <th key={c.key} {...frozenProps(c.key)}>
                    {c.label}
                  </th>
                ))}
                <th>Arrive FTY</th>
                <th>Shipment Status</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={cols.length + 2}
                loading={list.isLoading}
                error={list.error}
                empty={list.data?.data.length === 0}
                emptyText={
                  filters.q || filters.clientId.length || filters.direction || filters.status
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
                  <td>{fmtDate(r.arriveFty)}</td>
                  <td>
                    <ShipmentStatusPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && <Pager {...list.data.meta} onPage={(p) => setParam('page', String(p))} />}
      </div>
    </section>
  );
}
