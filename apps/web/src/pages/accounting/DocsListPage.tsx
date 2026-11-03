import { useCallback, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BILLING_DOC_TYPES,
  type BillingDocType,
  type BillingDocStatus,
  type BillingListColumn,
  type BillingListFilters,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useDocColumnValues, useDocs } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { Pager, TableState, ui } from '../../components/ui';
import { HeaderFilter, type SortDir } from '../../components/HeaderFilter';
import { SearchBox } from '../../components/SearchBox';
import { Pill } from '../../components/StatusPill';
import { fmtDate, fmtMoney } from '../../lib/format';
import { NotFoundPage } from '../NotFoundPage';
import { NewCreditNoteModal } from '../creditnoted/NewCreditNoteModal';
import { BILLING_SECTION_PATHS, BillingSections } from './billingParts';
import { DOC_CONFIG } from './docConfig';
import b from './Billing.module.css';

export const DOC_STATUS_PILL: Record<
  BillingDocStatus,
  { tone: 'completed' | 'pending' | 'exception'; label: string }
> = {
  DRAFT: { tone: 'pending', label: 'Draft' },
  ISSUED: { tone: 'completed', label: 'Issued' },
  VOID: { tone: 'exception', label: 'Cancelled' },
};

const MODE: Record<string, string> = { SEA: 'SEA', AIR: 'AIR', ROAD: 'TRUCK', RAIL: 'RAIL' };

/** The header filters kept in the URL (?f=…), so a filtered list survives a reload or a link. */
const readFilters = (raw: string | null): BillingListFilters => {
  try {
    return raw ? (JSON.parse(raw) as BillingListFilters) : {};
  } catch {
    return {};
  }
};

/** `base` is where rows link to: /accounting/<type>, or /credit-noted for the broker tab. */
export function DocsListPage({ type, base }: { type: string; base?: string }) {
  if (!(BILLING_DOC_TYPES as readonly string[]).includes(type)) return <NotFoundPage />;
  return <DocsList type={type as BillingDocType} base={base ?? `/accounting/${type}`} />;
}

function DocsList({ type, base }: { type: BillingDocType; base: string }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const lookups = useLookups();
  const cfg = DOC_CONFIG[type];
  const isCn = type === 'credit-notes';
  const canWrite = can(isCn ? 'creditnotes:write' : 'accounting:write');
  // Tax invoice, DIS and debit note lists also show the declare date, packages and freight.
  const shipCols = type === 'tax-invoices' || type === 'disbursements' || type === 'debit-notes';
  const [picking, setPicking] = useState(false);
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params.get('f'));
  const sort = (params.get('sort') as BillingListColumn | null) ?? undefined;
  const dir = (params.get('dir') as SortDir | null) ?? undefined;
  // The toolbar's filters; the header filters' value lists are fetched under these too.
  const listFilters = {
    q: params.get('q') || undefined,
    status: params.get('status') || undefined,
    clientId: params.get('clientId') || undefined,
    month: params.get('month') || undefined,
    filters: params.get('f') || undefined,
  };
  const q = {
    ...listFilters,
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 50),
    sort,
    dir,
  };
  const list = useDocs(type, q);
  const setMany = (values: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(values)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in values)) next.delete('page');
    setParams(next, { replace: true });
  };
  const set = (k: string, v: string) => setMany({ [k]: v });

  // Header filters, Excel style: one open at a time, its values fetched when it opens.
  const [openCol, setOpenCol] = useState<BillingListColumn | null>(null);
  const close = useCallback(() => setOpenCol(null), []);
  const colValues = useDocColumnValues(type, openCol ?? '', listFilters, !!openCol);
  const anyHeader = Object.keys(filters).length > 0 || !!sort;
  const head = (
    col: BillingListColumn,
    label: string,
    o: { kind?: 'number' | 'date'; align?: 'right'; format?: (v: string) => string } = {},
  ) => (
    <th style={o.align ? { textAlign: 'right' } : undefined}>
      <HeaderFilter
        label={label}
        kind={o.kind}
        align={o.align}
        format={o.format}
        open={openCol === col}
        onOpen={() => setOpenCol(col)}
        onClose={close}
        values={openCol === col ? colValues.data : undefined}
        loading={colValues.isLoading}
        selected={filters[col]}
        sort={sort === col ? dir : undefined}
        onApply={(kept) => {
          const { [col]: _old, ...others } = filters;
          const next: BillingListFilters = kept ? { ...others, [col]: kept } : others;
          setMany({ f: Object.keys(next).length ? JSON.stringify(next) : undefined });
        }}
        onSort={(d) => setMany({ sort: col, dir: d })}
      />
    </th>
  );
  return (
    <section className="view active view-fill">
      {BILLING_SECTION_PATHS.includes(base) && <BillingSections className={b.sectionsTop} />}
      <div className="card">
        <div className="card-header-row">
          <div>
            <h3>{isCn ? 'Credit Noted' : `${cfg.title}s`}</h3>
            <div className="create-header-desc" style={{ marginTop: 4 }}>
              {isCn
                ? 'Customs broker payment vouchers. Start one from a declaration; "Submit to Monthly" posts its total as the Clear Fee.'
                : 'Create from a ledger row (Monthly Ledger → open a row) to fill everything from the shipment, or start blank here.'}
            </div>
          </div>
          <div className={ui.toolbar}>
            <SearchBox
              placeholder="Number, customer, declare no…"
              defaultValue={q.q}
              onChange={(e) => set('q', e.target.value.trim())}
              aria-label="Search"
            />
            <input
              type="month"
              className={ui.input}
              value={q.month ?? ''}
              onChange={(e) => set('month', e.target.value)}
              aria-label="Month"
            />
            <select
              className={ui.input}
              value={q.clientId ?? ''}
              onChange={(e) => set('clientId', e.target.value)}
              aria-label="Client"
            >
              <option value="">All clients</option>
              {lookups.data?.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
            <select
              className={ui.input}
              value={q.status ?? ''}
              onChange={(e) => set('status', e.target.value)}
              aria-label="Status"
            >
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="ISSUED">Issued</option>
              <option value="VOID">Cancelled</option>
            </select>
            {anyHeader && (
              <button
                type="button"
                className={ui.ghostBtn}
                onClick={() => setMany({ f: undefined, sort: undefined, dir: undefined })}
              >
                Clear filters
              </button>
            )}
            {canWrite &&
              (isCn ? (
                <button type="button" className="new-shipment-btn" onClick={() => setPicking(true)}>
                  + New {cfg.title}
                </button>
              ) : (
                <Link to={`${base}/new`} className="new-shipment-btn">
                  + New {cfg.title}
                </Link>
              ))}
          </div>
        </div>
        <div className="plans-table-scroll">
          <table className="data-table-clean">
            <thead>
              <tr>
                {head('number', cfg.numberField ? 'No.' : 'Declare No.')}
                {head('date', 'Date', { kind: 'date', format: fmtDate })}
                {head('client', 'Client')}
                {head('billTo', type === 'record-summaries' ? 'Declare No.' : 'Bill to')}
                {head('declareNo', 'Declare No.')}
                {shipCols && head('declareDate', 'Declare Date', { kind: 'date', format: fmtDate })}
                {shipCols && head('quantity', 'Quantity')}
                {shipCols && head('freight', 'Freight', { format: (v) => MODE[v] ?? v })}
                {head('total', 'Total', { kind: 'number', align: 'right', format: fmtMoney })}
                {head('status', 'Status', {
                  format: (v) => DOC_STATUS_PILL[v as BillingDocStatus]?.label ?? v,
                })}
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={shipCols ? 10 : 7}
                loading={list.isLoading}
                error={list.error}
                empty={list.data?.data.length === 0}
                emptyText={`No ${cfg.title.toLowerCase()}s yet.`}
              />
              {list.data?.data.map((d) => (
                <tr
                  key={d.id}
                  className="plans-row-clickable"
                  tabIndex={0}
                  onClick={() => navigate(`${base}/${d.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`${base}/${d.id}`)}
                >
                  <td className="val-bold">{d.number ?? d.declareNo ?? '-'}</td>
                  <td>{fmtDate(d.date)}</td>
                  <td>{d.clientCode}</td>
                  <td>{d.billTo ?? '-'}</td>
                  <td>{d.declareNo ?? '-'}</td>
                  {shipCols && <td>{d.declareDate ? fmtDate(d.declareDate) : '-'}</td>}
                  {shipCols && <td>{d.quantityText ?? '-'}</td>}
                  {shipCols && (
                    <td>{d.transportMode ? (MODE[d.transportMode] ?? d.transportMode) : '-'}</td>
                  )}
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(d.total)}</td>
                  <td>
                    <Pill tone={DOC_STATUS_PILL[d.status].tone}>
                      {DOC_STATUS_PILL[d.status].label}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && (
          <Pager
            {...list.data.meta}
            onPage={(p) => set('page', String(p))}
            onPageSize={(n) => set('pageSize', String(n))}
          />
        )}
      </div>
      {picking && <NewCreditNoteModal base={base} onClose={() => setPicking(false)} />}
    </section>
  );
}
