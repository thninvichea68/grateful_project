import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  SHIPMENT_COLUMN_SEARCHES,
  type ShipmentColumnSearch,
  type ShipmentStatus,
  type ShipmentWatch,
} from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { useLookups, useShipments } from '../features/hooks';
import { ShipmentStatusPill } from '../components/StatusPill';
import { Pager, TableState, ui } from '../components/ui';
import { SearchBox } from '../components/SearchBox';
import { useToast } from '../components/Toast';
import { downloadFile } from '../lib/files';
import { ImportPlanDialog } from './plans/ImportPlanDialog';
import { fmtNum } from '../lib/format';
import { baseColumns } from './plans/columns';
import { PlansMoreMenu } from './plans/PlansMoreMenu';
import { HeadCell, SortButton } from './plans/HeadCell';
import { RowActions } from './plans/RowActions';
import { rowAlert } from './plans/rowAlert';
import t from './plans/PlansTable.module.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Month filter choices: next month back two years (YYYY-MM), plus the picked one if older. */
function monthOptions(picked: string): { value: string; label: string }[] {
  const now = new Date();
  const out: { value: string; label: string }[] = [];
  for (let i = -1; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    });
  }
  if (picked && !out.some((o) => o.value === picked)) {
    const [y, m] = picked.split('-');
    out.push({ value: picked, label: `${MONTHS[Number(m) - 1]} ${y}` });
  }
  return out;
}

export function ShippingPlansPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const lookups = useLookups();
  const [exporting, setExporting] = useState(false);

  const filters = {
    clientId: params.getAll('clientId'),
    // Always Import or Export (Import unless the link asks for Export).
    direction: (params.get('direction') === 'EXPORT' ? 'EXPORT' : 'IMPORT') as 'IMPORT' | 'EXPORT',
    status: (params.get('status') ?? '') as '' | ShipmentStatus,
    // Declaration month (YYYY-MM), or the month added while undeclared; empty = every month.
    month: params.get('month') ?? '',
    // A summary tile: due in the next 7 days, or needs attention.
    watch: (params.get('watch') ?? '') as '' | ShipmentWatch,
    q: params.get('q') ?? '',
    // "My shipments": only the ones assigned to me.
    mine: params.get('mine') === '1',
    page: Number(params.get('page') ?? 1),
    // Newest customs clearance (declaration) date first, unless another order is picked.
    sort: params.get('sort') ?? '-clearanceDate',
  };
  // The box under each column header (f_hbl, f_invoice…), straight from the URL.
  const colSearch = Object.fromEntries(
    SHIPMENT_COLUMN_SEARCHES.map((k) => [`f_${k}`, params.get(`f_${k}`) || undefined]),
  );
  const query = {
    ...colSearch,
    page: filters.page,
    pageSize: 50,
    sort: filters.sort,
    q: filters.q || undefined,
    clientId: filters.clientId,
    direction: filters.direction,
    status: filters.status || undefined,
    month: filters.month || undefined,
    watch: filters.watch || undefined,
    assignedToId: filters.mine ? user?.id : undefined,
  };
  const list = useShipments(query);
  const summary = list.data?.summary;
  const cols = baseColumns(filters.direction);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: k === 'q' });
  };

  // Tiles: one status or one watch at a time; clicking the active tile shows everything again.
  const pickTile = (k: 'status' | 'watch', v: '' | ShipmentStatus | ShipmentWatch) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    next.delete('status');
    next.delete('watch');
    if (v && params.get(k) !== v) next.set(k, v);
    setParams(next);
  };

  const filtered = !!(
    filters.q ||
    filters.clientId.length ||
    filters.month ||
    filters.status ||
    filters.watch ||
    filters.mine
  );
  // The toolbar filters (status and the alert chips are shown by the tabs themselves).
  const narrowed = !!(
    filters.q ||
    filters.clientId.length ||
    filters.month ||
    filters.mine ||
    Object.values(colSearch).some(Boolean)
  );
  const clearFilters = () => {
    const next = new URLSearchParams();
    for (const k of ['direction', 'status', 'watch']) {
      const v = params.get(k);
      if (v) next.set(k, v);
    }
    setParams(next);
  };

  // Header sorting: click once for A→Z / oldest first, again for the reverse.
  const sortDir = (key: string): 'asc' | 'desc' | null =>
    filters.sort === key ? 'asc' : filters.sort === `-${key}` ? 'desc' : null;
  const sortBy = (key: string) => setParam('sort', sortDir(key) === 'asc' ? `-${key}` : key);
  const ariaSort = (key: string) =>
    sortDir(key) === 'asc' ? 'ascending' : sortDir(key) === 'desc' ? 'descending' : undefined;

  const [importing, setImporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try {
      await downloadFile('/shipments/export.xlsx', {
        clientId: filters.clientId,
        direction: filters.direction || undefined,
        status: filters.status || undefined,
        month: filters.month || undefined,
        watch: filters.watch || undefined,
        assignedToId: filters.mine ? user?.id : undefined,
        q: filters.q || undefined,
        ...colSearch,
        sort: filters.sort,
      });
    } catch {
      toast('Export failed. Try again.');
    } finally {
      setExporting(false);
    }
  };

  const isExport = filters.direction === 'EXPORT';
  const statusTabs: { v: '' | ShipmentStatus; label: string; n: number | undefined }[] = [
    { v: '', label: 'All', n: summary?.total },
    { v: 'PENDING', label: 'Pending', n: summary?.pending },
    { v: 'IN_PROGRESS', label: 'In progress', n: summary?.inProgress },
    { v: 'COMPLETED', label: 'Completed', n: summary?.completed },
  ];
  const activeTab = filters.watch ? null : filters.status;
  return (
    <section className="view active" id="view-plans">
      <div className="card">
        {/* Import or Export first: it decides every column and count below. */}
        <div className={t.top}>
          <div className={t.segment} role="group" aria-label="Import or Export">
            {(['IMPORT', 'EXPORT'] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={filters.direction === d}
                onClick={() => setParam('direction', d === 'EXPORT' ? 'EXPORT' : '')}
              >
                {d === 'IMPORT' ? 'Import' : 'Export'}
              </button>
            ))}
          </div>
          <div className={ui.toolbar} style={{ flex: '1 1 auto', justifyContent: 'flex-end' }}>
            <SearchBox
              placeholder="Search BL, invoice, container, declare no…"
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
              value={filters.month}
              onChange={(e) => setParam('month', e.target.value)}
              aria-label="Declaration month"
              title="Declaration month"
            >
              <option value="">All months</option>
              {monthOptions(filters.month).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              className={ui.input}
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
            <button
              type="button"
              className={t.mine}
              aria-pressed={filters.mine}
              onClick={() => setParam('mine', filters.mine ? '' : '1')}
            >
              My shipments
            </button>
            <PlansMoreMenu
              exporting={exporting}
              onExport={() => void doExport()}
              onImport={can('shipments:write') ? () => setImporting(true) : undefined}
            />
          </div>
        </div>

        {/* Status tabs on the left; the two "act now" counts on the right. */}
        <div className={t.bar}>
          <div className={t.tabs} role="group" aria-label="Status">
            {statusTabs.map((x) => (
              <button
                key={x.v || 'all'}
                type="button"
                className={t.tab}
                aria-pressed={activeTab === x.v}
                onClick={() => pickTile('status', x.v)}
              >
                {x.label}
                <span className={t.count}>{x.n === undefined ? '…' : fmtNum(x.n)}</span>
              </button>
            ))}
          </div>
          <div className={t.watch}>
            {narrowed && (
              <button type="button" className={t.clear} onClick={clearFilters}>
                Clear filters ×
              </button>
            )}
            <button
              type="button"
              className={t.chip}
              data-tone="danger"
              data-on={!!summary?.attention || undefined}
              aria-pressed={filters.watch === 'ATTENTION'}
              title="Past its date and not completed, a customs exception, or completed while customs is not cleared"
              onClick={() => pickTile('watch', 'ATTENTION')}
            >
              <b>{summary ? fmtNum(summary.attention) : '…'}</b> Need attention
            </button>
            <button
              type="button"
              className={t.chip}
              data-tone="warning"
              data-on={!!summary?.dueSoon || undefined}
              aria-pressed={filters.watch === 'DUE_SOON'}
              title="Not completed, and due within the next 7 days"
              onClick={() => pickTile('watch', 'DUE_SOON')}
            >
              <b>{summary ? fmtNum(summary.dueSoon) : '…'}</b>
              {isExport ? 'Departing' : 'Arriving'} in 7 days
            </button>
          </div>
        </div>

        <div className="plans-table-scroll">
          <table className={`data-table-clean ${t.table}`}>
            {/* One header row: each column name is its search box, with a sort arrow. */}
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.key} aria-sort={ariaSort(c.key)}>
                    <HeadCell
                      label={c.label}
                      value={isColumnSearch(c.key) ? (params.get(`f_${c.key}`) ?? '') : null}
                      onSearch={(v) => setParam(`f_${c.key}`, v)}
                      dir={sortDir(c.key)}
                      onSort={() => sortBy(c.key)}
                    />
                  </th>
                ))}
                <th className={t.statusCol} aria-sort={ariaSort('status')}>
                  <div className={t.head} data-filled={!filters.watch && !!filters.status}>
                    <select
                      className={t.headInput}
                      aria-label="Status"
                      value={filters.watch ? '' : filters.status}
                      onChange={(e) => pickTile('status', e.target.value as '' | ShipmentStatus)}
                    >
                      <option value="">Status</option>
                      <option value="PENDING">Pending</option>
                      <option value="IN_PROGRESS">In progress</option>
                      <option value="COMPLETED">Completed</option>
                    </select>
                    <SortButton
                      label="Status"
                      dir={sortDir('status')}
                      onSort={() => sortBy('status')}
                    />
                  </div>
                </th>
                <th className={t.actionCol} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={cols.length + 2}
                loading={list.isLoading}
                error={list.error}
                empty={list.data?.data.length === 0}
                emptyText={
                  filtered || isExport
                    ? 'No shipments match the selected filters.'
                    : 'No shipments yet. Create one with “New Shipment”.'
                }
              />
              {list.data?.data.map((r) => {
                const alert = summary && rowAlert(r, summary.today);
                return (
                  <tr
                    key={r.id}
                    className="plans-row-clickable"
                    data-tone={alert?.tone === 'info' ? undefined : alert?.tone}
                    tabIndex={0}
                    onClick={() => navigate(`/plans/${r.id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/plans/${r.id}`)}
                  >
                    {cols.map((c) => (
                      <td key={c.key}>{c.render(r)}</td>
                    ))}
                    <td className={t.statusCol} title={alert?.label}>
                      <ShipmentStatusPill status={r.status} />
                      {alert && alert.tone !== 'info' && (
                        <span
                          className={t.alertDot}
                          data-tone={alert.tone}
                          aria-label={alert.label}
                        />
                      )}
                    </td>
                    <td className={t.actionCol}>
                      <RowActions r={r} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {list.data && <Pager {...list.data.meta} onPage={(p) => setParam('page', String(p))} />}
      </div>
      {importing && <ImportPlanDialog onClose={() => setImporting(false)} />}
    </section>
  );
}

const isColumnSearch = (key: string): key is ShipmentColumnSearch =>
  (SHIPMENT_COLUMN_SEARCHES as readonly string[]).includes(key);
