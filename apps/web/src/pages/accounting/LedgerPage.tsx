import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { LedgerRow } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useLedger } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { Pager, TableState, ui } from '../../components/ui';
import { Pill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { downloadFile } from '../../lib/files';
import { fmtDate, fmtNum } from '../../lib/format';
import { LedgerModal } from './LedgerModal';

const thisMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date()).slice(0, 7);
const m = (v: string) => fmtNum(v, 2);
const docNo = (
  r: LedgerRow,
  type: 'tax-invoices' | 'disbursements' | 'debit-notes',
  value: string | null,
) => {
  const d = r.documents.find((x) => x.type === type && x.number === value && x.status !== 'VOID');
  if (!value) return '-';
  return d ? (
    <Link
      to={`/accounting/${type}/${d.id}`}
      onClick={(e) => e.stopPropagation()}
      style={{ color: 'var(--accent-primary)', fontWeight: 800 }}
    >
      {value}
    </Link>
  ) : (
    value
  );
};

export function LedgerPage() {
  const { can } = useAuth();
  const toast = useToast();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<LedgerRow | 'new' | null>(null);
  const month = params.get('month') ?? thisMonth();
  const q = {
    month: month || undefined,
    clientId: params.get('clientId') || undefined,
    cheaStatus: params.get('chea') || undefined,
    q: params.get('q') || undefined,
    page: Number(params.get('page') ?? 1),
    pageSize: 100,
  };
  const list = useLedger(q);
  const t = list.data?.totals;
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v || k === 'month') next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <section className="view active">
      <div className="card">
        <div className="card-header-row">
          <div>
            <h3>Monthly Ledger</h3>
            <div className="create-header-desc" style={{ marginTop: 4 }}>
              One row per customs declaration. Net profit = (INV + DIS + DN) − (Clear fee + THC + CM
              + Other pay); VAT is not profit.
            </div>
          </div>
          <div className={ui.toolbar}>
            <input
              type="month"
              className={ui.input}
              value={month}
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
              value={q.cheaStatus ?? ''}
              onChange={(e) => set('chea', e.target.value)}
              aria-label="Chea payment"
            >
              <option value="">Paid &amp; unpaid</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PAID">Paid</option>
            </select>
            <input
              type="search"
              className={ui.input}
              placeholder="Declare / INV / DN no…"
              defaultValue={q.q}
              onChange={(e) => set('q', e.target.value.trim())}
              aria-label="Search"
            />
            <button
              type="button"
              className="filter-btn"
              onClick={() =>
                downloadFile('/accounting/ledger/export.xlsx', {
                  month: month || undefined,
                  clientId: q.clientId,
                }).catch(() => toast('Export failed.'))
              }
            >
              Export Excel
            </button>
            {can('accounting:write') && (
              <button type="button" className="new-shipment-btn" onClick={() => setOpen('new')}>
                + New Entry
              </button>
            )}
          </div>
        </div>
        {t && (
          <div
            style={{
              display: 'flex',
              gap: 20,
              flexWrap: 'wrap',
              margin: '4px 2px 12px',
              fontSize: 12.5,
              fontWeight: 800,
              color: 'var(--text-secondary)',
            }}
          >
            <span>{t.rows} entries</span>
            <span>INV ${m(t.invRevenue)}</span>
            <span>DIS ${m(t.disTotal)}</span>
            <span>DN ${m(t.dnTotal)}</span>
            <span>VAT ${m(t.vat)}</span>
            <span
              style={{
                color:
                  Number(t.netProfit) < 0
                    ? 'var(--status-exception-fg)'
                    : 'var(--status-completed-fg)',
              }}
            >
              Net profit ${m(t.netProfit)}
            </span>
            <span style={{ color: t.unpaid ? 'var(--status-pending-fg)' : undefined }}>
              {t.unpaid} unpaid
            </span>
          </div>
        )}
        <div className="plans-table-scroll">
          <table className="data-table-clean">
            <thead>
              <tr>
                <th>Inv Date</th>
                <th>Client</th>
                <th>Declare No</th>
                <th>Port</th>
                <th>INV No</th>
                <th>DIS No</th>
                <th>DN No</th>
                <th style={{ textAlign: 'right' }}>Clear Fee</th>
                <th style={{ textAlign: 'right' }}>THC</th>
                <th style={{ textAlign: 'right' }}>Other</th>
                <th style={{ textAlign: 'right' }}>CM</th>
                <th style={{ textAlign: 'right' }}>INV</th>
                <th style={{ textAlign: 'right' }}>DIS</th>
                <th style={{ textAlign: 'right' }}>VAT</th>
                <th style={{ textAlign: 'right' }}>DN Total</th>
                <th style={{ textAlign: 'right' }}>Net Profit</th>
                <th>Chea</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={17}
                loading={list.isLoading}
                error={list.error}
                empty={list.data?.data.length === 0}
                emptyText="No ledger entries for these filters."
              />
              {list.data?.data.map((r) => (
                <tr
                  key={r.id}
                  className="plans-row-clickable"
                  tabIndex={0}
                  onClick={() => setOpen(r)}
                  onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}
                >
                  <td>{fmtDate(r.invDate)}</td>
                  <td>{r.clientCode}</td>
                  <td className="val-bold">{r.declareNo}</td>
                  <td>{r.portCode ?? '-'}</td>
                  <td>{docNo(r, 'tax-invoices', r.invNo)}</td>
                  <td>{docNo(r, 'disbursements', r.disNo)}</td>
                  <td>{docNo(r, 'debit-notes', r.dnNo)}</td>
                  {[
                    r.clearFee,
                    r.thc,
                    r.otherPay,
                    r.commission,
                    r.invRevenue,
                    r.disTotal,
                    r.vat,
                    r.dnTotal,
                  ].map((v, i) => (
                    <td key={i} style={{ textAlign: 'right' }}>
                      {m(v)}
                    </td>
                  ))}
                  <td
                    style={{
                      textAlign: 'right',
                      fontWeight: 800,
                      color:
                        Number(r.netProfit) < 0
                          ? 'var(--status-exception-fg)'
                          : 'var(--text-primary)',
                    }}
                  >
                    {m(r.netProfit)}
                  </td>
                  <td>
                    <Pill tone={r.cheaStatus === 'PAID' ? 'completed' : 'pending'}>
                      {r.cheaStatus === 'PAID' ? 'Paid' : 'Unpaid'}
                    </Pill>
                  </td>
                </tr>
              ))}
              {t && t.rows > 0 && (
                <tr style={{ fontWeight: 800 }}>
                  <td colSpan={7}>Total</td>
                  {[
                    t.clearFee,
                    t.thc,
                    t.otherPay,
                    t.commission,
                    t.invRevenue,
                    t.disTotal,
                    t.vat,
                    t.dnTotal,
                    t.netProfit,
                  ].map((v, i) => (
                    <td key={i} style={{ textAlign: 'right' }}>
                      {m(v)}
                    </td>
                  ))}
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {list.data && <Pager {...list.data.meta} onPage={(p) => set('page', String(p))} />}
      </div>
      {open && <LedgerModal row={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
    </section>
  );
}
