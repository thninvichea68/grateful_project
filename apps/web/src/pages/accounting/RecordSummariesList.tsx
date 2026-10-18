import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { BillingDocStatus } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useDocs } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, Pager } from '../../components/ui';
import { SearchBox } from '../../components/SearchBox';
import { fmtMoney } from '../../lib/format';
import { icons } from '../../layout/icons';
// Same look as Credit Noted and Accounting → Chea Payments.
import s from './CreditNotesReview.module.css';

const TYPE = 'record-summaries' as const;
const STATUS: Record<BillingDocStatus, { label: string; cls: string }> = {
  DRAFT: { label: 'Draft', cls: s.unchecked! },
  ISSUED: { label: 'Submitted', cls: s.checked! },
  VOID: { label: 'Cancelled', cls: s.void! },
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MODE: Record<string, string> = { SEA: 'Sea', AIR: 'Air', ROAD: 'Truck', RAIL: 'Rail' };
const PAGE_SIZES = [10, 25, 50];

/**
 * Record summaries, laid out like Credit Noted: one card with the filters, the table and the
 * pager; a row opens the editor at `base`/:id. Sidebar → Record Summary shows just that;
 * Accounting → Record Summary adds Chea Payments' status cards (which also filter) on top.
 */
export function RecordSummariesList({ base, cards = false }: { base: string; cards?: boolean }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) || undefined;
  const filters = {
    q: get('q'),
    clientId: get('clientId'),
    direction: get('direction'),
    monthOfYear: get('month'),
    year: get('year'),
  };
  const q = {
    ...filters,
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 10),
    status: get('status'),
  };
  const list = useDocs(TYPE, q);
  // The cards' counts: the same filters, one status each (only the total is read).
  const count = (status: BillingDocStatus) => ({ ...filters, status, page: 1, pageSize: 1 });
  const drafts = useDocs(TYPE, count('DRAFT'), cards);
  const issued = useDocs(TYPE, count('ISSUED'), cards);
  const voided = useDocs(TYPE, count('VOID'), cards);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2];
  const filtered = !!(q.q || q.clientId || q.direction || q.monthOfYear || q.year || q.status);
  const open = (id: string) => navigate(`${base}/${id}`);

  return (
    <section className={`view active ${s.page}`}>
      {cards && (
        <StatusCards
          active={q.status ?? ''}
          onPick={(v) => set('status', v)}
          counts={{
            DRAFT: drafts.data?.meta.total,
            ISSUED: issued.data?.meta.total,
            VOID: voided.data?.meta.total,
          }}
        />
      )}

      <ErrorBanner error={list.error} />
      <div className={s.card}>
        <div className={s.toolbar}>
          <SearchBox
            className={s.search}
            placeholder="Search declare no."
            defaultValue={q.q}
            onChange={(e) => set('q', e.target.value.trim())}
            aria-label="Search by declare no."
          />
          {!cards && (
            <select
              className={s.select}
              value={q.status ?? ''}
              onChange={(e) => set('status', e.target.value)}
              aria-label="Status"
            >
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="ISSUED">Submitted</option>
              <option value="VOID">Cancelled</option>
            </select>
          )}
          <select
            className={s.select}
            value={q.clientId ?? ''}
            onChange={(e) => set('clientId', e.target.value)}
            aria-label="Client"
          >
            <option value="">All clients</option>
            {lookups.data?.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className={s.select}
            value={q.direction ?? ''}
            onChange={(e) => set('direction', e.target.value)}
            aria-label="Shipment"
          >
            <option value="">Import &amp; export</option>
            <option value="IMPORT">Import</option>
            <option value="EXPORT">Export</option>
          </select>
          <select
            className={s.select}
            value={q.monthOfYear ?? ''}
            onChange={(e) => set('month', e.target.value)}
            aria-label="Month"
          >
            <option value="">All months</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select
            className={s.select}
            value={q.year ?? ''}
            onChange={(e) => set('year', e.target.value)}
            aria-label="Year"
          >
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          {filtered && (
            <button
              type="button"
              className={s.clear}
              onClick={() => setParams({}, { replace: true })}
            >
              Clear
            </button>
          )}
          {can('accounting:write') && (
            <button type="button" className={s.newBtn} onClick={() => navigate(`${base}/new`)}>
              {icons.plus({ width: 15, height: 15 })} New Record Summary
            </button>
          )}
        </div>

        <div className={s.scroll}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>No.</th>
                <th>Client</th>
                <th>Type</th>
                <th>Declare No.</th>
                <th>Date</th>
                <th>Invoice No.</th>
                <th>Quantity</th>
                <th>Port</th>
                <th>Shipment by</th>
                <th className={s.num}>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading && (
                <tr>
                  <td colSpan={11} className={s.empty}>
                    Loading…
                  </td>
                </tr>
              )}
              {list.data?.data.length === 0 && (
                <tr>
                  <td colSpan={11} className={s.empty}>
                    <span className={s.emptyIcon}>
                      {icons.recordsummary({ width: 22, height: 22 })}
                    </span>
                    <b>{filtered ? 'Nothing matches these filters' : 'No record summaries yet'}</b>
                    <span>
                      {filtered
                        ? 'Try another client, month or status.'
                        : 'Start one with “New Record Summary” and pick the declaration.'}
                    </span>
                  </td>
                </tr>
              )}
              {list.data?.data.map((d, i) => (
                <tr
                  key={d.id}
                  tabIndex={0}
                  onClick={() => open(d.id)}
                  onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open(d.id)}
                >
                  <td className={s.cn}>{(q.page - 1) * q.pageSize + i + 1}</td>
                  <td>
                    <span className={s.client}>{d.clientName.toUpperCase()}</span>
                  </td>
                  <td>
                    {d.direction && (
                      <span className={s.type}>
                        <i className={d.direction === 'IMPORT' ? s.imp : s.exp} />
                        {d.direction === 'IMPORT' ? 'Import' : 'Export'}
                      </span>
                    )}
                  </td>
                  <td className={s.mono}>{d.billTo ?? d.declareNo ?? '-'}</td>
                  <td>{d.date}</td>
                  <td className={s.mono}>{d.invNo ?? '-'}</td>
                  <td>{d.quantityText ?? '-'}</td>
                  <td>{d.port?.toUpperCase() ?? '-'}</td>
                  <td>{d.transportMode ? (MODE[d.transportMode] ?? d.transportMode) : '-'}</td>
                  <td className={`${s.num} ${s.fee}`}>{fmtMoney(d.total)}</td>
                  <td>
                    <span className={`${s.statusPill} ${STATUS[d.status].cls}`}>
                      <i className={s.pillDot} />
                      {STATUS[d.status].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {list.data && list.data.meta.total > 0 && (
          <div className={s.foot}>
            <label className={s.show}>
              Rows
              <select
                className={s.select}
                value={q.pageSize}
                onChange={(e) => set('pageSize', e.target.value)}
              >
                {PAGE_SIZES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <Pager {...list.data.meta} onPage={(p) => set('page', String(p))} />
          </div>
        )}
      </div>
    </section>
  );
}

/** Chea Payments' four status cards; picking one filters the list. */
function StatusCards({
  active,
  onPick,
  counts,
}: {
  active: string;
  onPick: (status: string) => void;
  counts: Record<BillingDocStatus, number | undefined>;
}) {
  const known = Object.values(counts).every((n) => n !== undefined);
  const all = known ? Object.values(counts).reduce((a, n) => a! + n!, 0) : undefined;
  const cards: { status: string; label: string; value?: number; icon: ReactNode; cls: string }[] = [
    {
      status: '',
      label: 'All records',
      value: all,
      icon: icons.recordsummary({ width: 17, height: 17 }),
      cls: s.neutral!,
    },
    {
      status: 'DRAFT',
      label: 'Draft',
      value: counts.DRAFT,
      icon: icons.edit({ width: 17, height: 17 }),
      cls: s.unchecked!,
    },
    {
      status: 'ISSUED',
      label: 'Submitted',
      value: counts.ISSUED,
      icon: icons.send({ width: 17, height: 17 }),
      cls: s.checked!,
    },
    {
      status: 'VOID',
      label: 'Cancelled',
      value: counts.VOID,
      icon: icons.close({ width: 17, height: 17 }),
      cls: s.void!,
    },
  ];
  return (
    <div className={s.stats} role="group" aria-label="Filter by status">
      {cards.map((k) => {
        const on = active === k.status;
        return (
          <button
            key={k.label}
            type="button"
            className={`${s.stat} ${k.cls} ${on ? s.statOn : ''}`}
            aria-pressed={on}
            onClick={() => onPick(k.status)}
          >
            <span className={s.statIcon}>{k.icon}</span>
            <span className={s.statText}>
              <span className={s.statLabel}>{k.label}</span>
              <span className={s.statValue}>{k.value ?? '–'}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
