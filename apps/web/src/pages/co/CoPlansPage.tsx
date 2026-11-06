import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CO_STATUS_LABEL, CO_STATUSES, type CoRow, type CoStatus } from '@gs/shared';
import { useLookups } from '../../features/hooks';
import { useCoList } from '../../features/co';
import { HeaderFilter } from '../../components/HeaderFilter';
import { TableState, ui } from '../../components/ui';
import { useLocalHeaderFilters, type LocalColumn } from '../../components/useLocalHeaderFilters';
import { Pill } from '../../components/StatusPill';
import { MonthRangeInput } from '../../components/MonthRangeInput';
import { icons } from '../../layout/icons';
import { fmtDate, fmtMoney, fmtNum } from '../../lib/format';
import { CoRecordModal } from './CoRecordModal';
import { exportCoExcel } from './coExport';

const COLS = 13;
const thisMonth = () => new Date().toISOString().slice(0, 7);
const TONE: Record<CoStatus, 'neutral' | 'pending' | 'progress' | 'completed'> = {
  PENDING: 'neutral',
  DRAFT: 'pending',
  SUBMIT: 'progress',
  APPROVE: 'completed',
};
/** "2026-07" → "07-2026", as the CO RECORD sheet shows the month. */
export const sheetMonth = (m: string) => `${m.slice(5, 7)}-${m.slice(0, 4)}`;

const asDate = { kind: 'date', format: fmtDate } as const;
const asCount = { kind: 'number', align: 'right', format: (v: string) => fmtNum(v, 0) } as const;
/** The table's columns, with what each one's header filter keeps. */
const FILTER_COLS: LocalColumn<CoRow>[] = [
  { key: 'month', label: 'Month', kind: 'date', format: sheetMonth, value: (r) => r.month },
  { key: 'form', label: 'Form', value: (r) => r.form },
  { key: 'mode', label: 'Mode', value: (r) => r.mode },
  { key: 'country', label: 'Country', value: (r) => r.country },
  // As the cell shows it: the invoice's own CO no., else the shipment's (in grey).
  { key: 'coNo', label: 'CO No.', value: (r) => r.coNo ?? r.shipmentCoNo },
  { key: 'coDate', label: 'Date CO', ...asDate, value: (r) => r.coDate },
  { key: 'invoiceNo', label: 'Inv No.', value: (r) => r.invoiceNo },
  { key: 'invoiceDate', label: 'Date Inv', ...asDate, value: (r) => r.invoiceDate },
  { key: 'pcs', label: 'PCS', ...asCount, value: (r) => String(r.pcs) },
  { key: 'ctns', label: 'CNTS', ...asCount, value: (r) => String(r.ctns) },
  {
    key: 'amount',
    label: 'Amount',
    kind: 'number',
    align: 'right',
    format: fmtMoney,
    value: (r) => String(r.amount),
  },
  { key: 'atd', label: 'ATD Date', ...asDate, value: (r) => r.atd },
  {
    key: 'status',
    label: 'Status',
    format: (v) => CO_STATUS_LABEL[v as CoStatus] ?? v,
    value: (r) => r.status,
  },
];

export function CoStatusPill({ status }: { status: CoStatus }) {
  return <Pill tone={TONE[status]}>{CO_STATUS_LABEL[status]}</Pill>;
}

/**
 * CO → CO Plans: the certificate of origin of every export invoice (the CO RECORD workbook),
 * by the invoice date's month. Qty, cartons, amount and dates come from the shipping plan;
 * the form, CO no. and date, and status are kept here. Filters sit in the URL.
 */
export function CoPlansPage() {
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<CoRow | null>(null);

  const to = params.get('to') ?? thisMonth();
  const from = params.get('from') ?? `${to.slice(0, 4)}-01`;
  const clientId = params.get('client') ?? '';
  const status = (params.get('status') ?? '') as CoStatus | '';
  const all = params.get('all') === '1';
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch))
      if (v) next.set(k, v);
      else next.delete(k);
    setParams(next, { replace: true });
  };

  const list = useCoList({
    from,
    to,
    clientId: clientId || undefined,
    status: status || undefined,
    all: all || undefined,
  });
  const loaded = useMemo(() => list.data ?? [], [list.data]);
  const header = useLocalHeaderFilters(loaded, FILTER_COLS, params, setParams);
  // The totals and the Excel export follow the header filters.
  const rows = header.rows;
  const totals = useMemo(
    () =>
      rows.reduce(
        (t, r) => ({ pcs: t.pcs + r.pcs, ctns: t.ctns + r.ctns, amount: t.amount + r.amount }),
        { pcs: 0, ctns: 0, amount: 0 },
      ),
    [rows],
  );

  return (
    <section className="view active" id="view-co">
      <div className="card">
        <div className="card-header-row">
          <h3 style={{ margin: 0 }}>CO Plans — Certificates of Origin</h3>
          <div className={ui.toolbar}>
            <MonthRangeInput
              from={from}
              to={to}
              onChange={(f, t) => set({ from: f, to: t })}
              aria-label="Months"
            />
            <select
              className={ui.input}
              value={clientId}
              onChange={(e) => set({ client: e.target.value })}
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
              className={ui.input}
              value={status}
              onChange={(e) => set({ status: e.target.value })}
              aria-label="Status"
            >
              <option value="">All statuses</option>
              {CO_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {CO_STATUS_LABEL[v]}
                </option>
              ))}
            </select>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                checked={all}
                onChange={(e) => set({ all: e.target.checked ? '1' : null })}
              />
              All export invoices
            </label>
            <button
              type="button"
              className={ui.ghostBtn}
              disabled={!rows.length}
              onClick={() => void exportCoExcel(rows, from, to)}
            >
              {icons.download({ width: 14, height: 14 })} Excel
            </button>
          </div>
        </div>
        <div className="plans-table-scroll">
          <table className="data-table-clean seal-plan-table co-plan-table">
            <thead>
              <tr>
                {FILTER_COLS.map((c) => (
                  <th key={c.key} className={c.align ? 'num' : undefined}>
                    <HeaderFilter {...header.headProps(c)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={COLS}
                loading={list.isLoading}
                error={list.error}
                empty={rows.length === 0}
                emptyText={
                  header.active
                    ? 'No invoices match these filters.'
                    : all
                      ? 'No export invoices dated in these months.'
                      : 'No export invoices with a CO form in these months. Tick “All export invoices” to see the rest.'
                }
              />
              {rows.map((r) => (
                <tr
                  key={r.invoiceId}
                  className="plans-row-clickable"
                  tabIndex={0}
                  onClick={() => setOpen(r)}
                  onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}
                >
                  <td>{sheetMonth(r.month)}</td>
                  <td className="val-bold">{r.form ?? '-'}</td>
                  <td>{r.mode}</td>
                  <td>{r.country ?? '-'}</td>
                  <td>
                    {r.coNo ?? (
                      <span
                        style={{
                          color: 'var(--text-tertiary)',
                          display: 'inline-block',
                          maxWidth: 170,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          verticalAlign: 'bottom',
                        }}
                        title={
                          r.shipmentCoNo
                            ? `The shipment’s CO numbers: ${r.shipmentCoNo}`
                            : undefined
                        }
                      >
                        {r.shipmentCoNo ?? '-'}
                      </span>
                    )}
                  </td>
                  <td>{fmtDate(r.coDate)}</td>
                  <td className="val-bold">
                    <Link
                      to={`/plans/${r.shipmentId}`}
                      onClick={(e) => e.stopPropagation()}
                      title={`${r.reference} · ${r.clientName}`}
                    >
                      {r.invoiceNo}
                    </Link>
                  </td>
                  <td>{fmtDate(r.invoiceDate)}</td>
                  <td className="num">{fmtNum(r.pcs, 0)}</td>
                  <td className="num">{fmtNum(r.ctns, 0)}</td>
                  <td className="num">{fmtMoney(r.amount)}</td>
                  <td>{fmtDate(r.atd)}</td>
                  <td>
                    <CoStatusPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={8}>
                    Total · {rows.length} invoice{rows.length === 1 ? '' : 's'}
                  </td>
                  <td className="num">{fmtNum(totals.pcs, 0)}</td>
                  <td className="num">{fmtNum(totals.ctns, 0)}</td>
                  <td className="num">{fmtMoney(totals.amount)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      {open && <CoRecordModal row={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
