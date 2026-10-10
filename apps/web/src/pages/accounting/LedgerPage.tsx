import { useState } from 'react';
import { createPortal } from 'react-dom';
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
import { icons } from '../../layout/icons';
import { SearchBox } from '../../components/SearchBox';
import { StatTile, StatTiles } from '../../components/StatTiles';
import { useAccountingLayout } from './AccountingLayout';
import { LedgerModal } from './LedgerModal';
import l from './LedgerPage.module.css';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
/** "2026-10" → "October 2026"; a year → "Jan – Dec 2026"; nothing → "All months". */
function periodLabel(month: string, year: string | null) {
  if (year) return `Jan – Dec ${year}`;
  if (!month) return 'All months';
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

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
  // Period: a month (default) or a whole year (?year=2026, Jan–Dec).
  const year = params.get('year');
  const month = year ? '' : (params.get('month') ?? thisMonth());
  const currentYear = Number(thisMonth().slice(0, 4));
  const years = Array.from({ length: 8 }, (_, i) => String(currentYear + 1 - i));
  const q = {
    month: month || undefined,
    year: year || undefined,
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
  const setPeriod = (p: { month: string } | { year: string }) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    if ('year' in p) {
      next.delete('month');
      next.set('year', p.year);
    } else {
      next.delete('year');
      next.set('month', p.month);
    }
    setParams(next, { replace: true });
  };

  const { tabsAside } = useAccountingLayout();

  return (
    <section className={`view active ${l.fill}`}>
      {/* Title sits at the right end of the accounting tabs row, freeing height for rows. */}
      {tabsAside &&
        createPortal(
          <div>
            <h3 className={l.title}>
              {year ? 'Yearly Ledger' : 'Monthly Ledger'} ·{' '}
              <span className={l.period}>{periodLabel(month, year)}</span>
            </h3>
            <div className={l.sub}>One row per customs declaration.</div>
          </div>,
          tabsAside,
        )}
      <div className="card">
        <div className={l.filters}>
          <select
            className={ui.input}
            value={year ? 'year' : 'month'}
            onChange={(e) =>
              e.target.value === 'year'
                ? setPeriod({ year: (month || thisMonth()).slice(0, 4) })
                : setPeriod({
                    // Back to this month if it's the year being viewed, else that year's January.
                    month: year && !thisMonth().startsWith(year) ? `${year}-01` : thisMonth(),
                  })
            }
            aria-label="View by"
          >
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
          </select>
          {year ? (
            <select
              className={ui.input}
              value={year}
              onChange={(e) => setPeriod({ year: e.target.value })}
              aria-label="Year"
            >
              {(years.includes(year) ? years : [year, ...years]).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="month"
              className={ui.input}
              value={month}
              onChange={(e) => set('month', e.target.value)}
              aria-label="Month"
            />
          )}
          <span className={l.divider} aria-hidden="true" />
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
          <SearchBox
            className={l.search}
            placeholder="Search declare, INV or DN no…"
            defaultValue={q.q}
            onChange={(e) => set('q', e.target.value.trim())}
            aria-label="Search"
          />
          <div className={l.actions}>
            <button
              type="button"
              className={l.export}
              onClick={() =>
                downloadFile('/accounting/ledger/export.xlsx', {
                  month: month || undefined,
                  year: year || undefined,
                  clientId: q.clientId,
                }).catch(() => toast('Export failed.'))
              }
            >
              {icons.download({})}
              Export Excel
            </button>
            {can('accounting:write') && (
              <button type="button" className="new-shipment-btn" onClick={() => setOpen('new')}>
                {icons.plus({})}
                New Entry
              </button>
            )}
          </div>
        </div>
        {t && (
          <StatTiles columns={8}>
            <StatTile label="Entries" value={fmtNum(t.rows)} />
            <StatTile label="INV (Service revenue)" value={`$${m(t.invRevenue)}`} />
            <StatTile label="Disbursements" value={`$${m(t.disTotal)}`} />
            <StatTile label="Debit notes" value={`$${m(t.dnTotal)}`} />
            <StatTile label="VAT 10% (Not profit)" value={`$${m(t.vat)}`} />
            <StatTile
              label="Net profit"
              value={`$${m(t.netProfit)}`}
              tone={Number(t.netProfit) < 0 ? 'danger' : 'success'}
              span={2}
              tooltip="(INV + DIS + DN) − (Clear fee + THC + CM + Other)"
            />
            <StatTile
              label="Unpaid (Chea)"
              value={t.unpaid}
              tone={t.unpaid > 0 ? 'warning' : undefined}
              pressed={q.cheaStatus === 'UNPAID'}
              onClick={() => set('chea', q.cheaStatus === 'UNPAID' ? '' : 'UNPAID')}
              tooltip={q.cheaStatus === 'UNPAID' ? 'Show all' : 'Show unpaid only'}
            />
          </StatTiles>
        )}
        <div className={`plans-table-scroll ${l.tableScroll}`}>
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
