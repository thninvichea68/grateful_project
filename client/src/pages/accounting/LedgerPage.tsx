import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { sumMoney, type LedgerRow } from '@gs/shared';
import { useLedger } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { Pager, TableState, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { downloadFile } from '../../lib/files';
import { fmtDate, fmtNum } from '../../lib/format';
import { icons } from '../../layout/icons';
import { SearchBox } from '../../components/SearchBox';
import { LedgerModal } from './LedgerModal';
import { ClearFeePayments } from './ClearFeePayments';
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
/**
 * Accounting figure: 2 decimals with thousands separators, negatives in brackets, zero as a
 * dash, so a column reads at a glance (as on a printed ledger).
 */
const acct = (v: string | number) => {
  const n = Number(v);
  if (!n) return '–';
  const s = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${s})` : s;
};
const usd = (v: string | number) => {
  const n = Number(v);
  const s = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `($${s})` : `$${s}`;
};
/** One step back or on: a month ("2026-11" → "2026-10") or a year ("2026" → "2025"). */
const shift = (period: string, by: number) => {
  if (period.length === 4) return String(Number(period) + by);
  const [y, mo] = period.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** 2026-08-22 → Saturday (the date is a plain calendar day, so read it as UTC). */
const weekday = (iso: string | null | undefined) =>
  iso ? (WEEKDAYS[new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay()] ?? '-') : '-';
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
      style={{ color: 'var(--accent-primary)', fontWeight: 700 }}
    >
      {value}
    </Link>
  ) : (
    value
  );
};

export function LedgerPage() {
  const toast = useToast();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<LedgerRow | null>(null);
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

  return (
    <section className={`view active ${l.fill}`}>
      <div className="card">
        <div className={l.filters}>
          <div className={l.segment} role="group" aria-label="View by">
            {(['month', 'year'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={(year ? 'year' : 'month') === v}
                onClick={() =>
                  v === 'year'
                    ? !year && setPeriod({ year: (month || thisMonth()).slice(0, 4) })
                    : year &&
                      setPeriod({
                        // Back to this month if it's the year being viewed, else that year's January.
                        month: !thisMonth().startsWith(year) ? `${year}-01` : thisMonth(),
                      })
                }
              >
                {v === 'month' ? 'Monthly' : 'Yearly'}
              </button>
            ))}
          </div>
          <div className={l.stepper}>
            <button
              type="button"
              aria-label={year ? 'Previous year' : 'Previous month'}
              onClick={() =>
                year
                  ? setPeriod({ year: shift(year, -1) })
                  : setPeriod({ month: shift(month || thisMonth(), -1) })
              }
            >
              ‹
            </button>
            {year ? (
              <select
                className={l.periodInput}
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
                className={l.periodInput}
                value={month}
                onChange={(e) => set('month', e.target.value)}
                aria-label="Month"
              />
            )}
            <button
              type="button"
              aria-label={year ? 'Next year' : 'Next month'}
              onClick={() =>
                year
                  ? setPeriod({ year: shift(year, 1) })
                  : setPeriod({ month: shift(month || thisMonth(), 1) })
              }
            >
              ›
            </button>
          </div>
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
          </div>
        </div>
        {t && (
          <Statement
            t={t}
            unpaidOn={q.cheaStatus === 'UNPAID'}
            onUnpaid={() => set('chea', q.cheaStatus === 'UNPAID' ? '' : 'UNPAID')}
          />
        )}
        {/* Columns grouped as on a ledger: the entry, its documents, costs, income, result. */}
        <div className={`plans-table-scroll ${l.tableScroll}`}>
          <table className={l.ledger}>
            <thead>
              <tr className={l.groups}>
                <th colSpan={5}>Declaration</th>
                <th colSpan={4} className={l.groupStart}>
                  Documents
                </th>
                <th colSpan={4} className={l.groupStart}>
                  Costs (USD)
                </th>
                <th colSpan={3} className={l.groupStart}>
                  Income (USD)
                </th>
                <th className={`${l.groupStart} ${l.resultHead}`}>Result</th>
                <th colSpan={2} className={l.groupStart}>
                  Memo
                </th>
              </tr>
              <tr>
                <th className={l.stickyA}>Declare No.</th>
                <th>Date</th>
                <th>Client</th>
                <th>Port</th>
                <th>Chea</th>
                <th className={l.groupStart}>INV No.</th>
                <th>DIS No.</th>
                <th>DN No.</th>
                <th>INV Date</th>
                <th className={`${l.num} ${l.groupStart}`}>Clear Fee</th>
                <th className={l.num}>THC</th>
                <th className={l.num}>CM</th>
                <th className={l.num}>Other</th>
                <th className={`${l.num} ${l.groupStart}`}>INV</th>
                <th className={l.num}>DIS</th>
                <th className={l.num}>DN</th>
                <th className={`${l.num} ${l.groupStart} ${l.resultHead}`}>Net Profit</th>
                <th className={`${l.num} ${l.groupStart}`}>VAT 10%</th>
                <th className={l.num}>Rate</th>
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={19}
                loading={list.isLoading}
                error={list.error}
                empty={list.data?.data.length === 0}
                emptyText={`No ledger entries for ${periodLabel(month, year)}.`}
              />
              {list.data?.data.map((r) => (
                <tr
                  key={r.id}
                  className={l.row}
                  tabIndex={0}
                  title={r.mark ?? undefined}
                  onClick={() => setOpen(r)}
                  onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}
                >
                  <td className={`${l.stickyA} ${l.declare}`}>
                    {r.declareNo}
                    {r.mark && <span className={l.markDot} aria-label="Has a mark" />}
                  </td>
                  <td>{fmtDate(r.declareDate)}</td>
                  <td>
                    <span className={l.client} title={r.clientName}>
                      {r.clientCode}
                    </span>
                  </td>
                  <td
                    title={[r.portName, r.portNo && `No. ${r.portNo}`].filter(Boolean).join(' · ')}
                  >
                    {r.portCode ?? '–'}
                  </td>
                  <td>
                    <span className={l.chea} data-paid={r.cheaStatus === 'PAID'}>
                      {r.cheaStatus === 'PAID' ? 'Paid' : 'Unpaid'}
                    </span>
                  </td>
                  <td className={l.groupStart}>
                    {r.invNo ? (
                      docNo(r, 'tax-invoices', r.invNo)
                    ) : (
                      <span className={l.notInvoiced}>Not invoiced</span>
                    )}
                  </td>
                  <td>{docNo(r, 'disbursements', r.disNo)}</td>
                  <td>{docNo(r, 'debit-notes', r.dnNo)}</td>
                  <td title={weekday(r.invDate)}>{fmtDate(r.invDate)}</td>
                  <td className={`${l.num} ${l.groupStart}`}>{acct(r.clearFee)}</td>
                  <td className={l.num}>{acct(r.thc)}</td>
                  <td className={l.num}>{acct(r.commission)}</td>
                  <td className={l.num}>{acct(r.otherPay)}</td>
                  <td className={`${l.num} ${l.groupStart}`}>{acct(r.invRevenue)}</td>
                  <td className={l.num}>{acct(r.disTotal)}</td>
                  <td className={l.num}>{acct(r.dnTotal)}</td>
                  <td
                    className={`${l.num} ${l.groupStart} ${l.result}`}
                    data-neg={Number(r.netProfit) < 0}
                  >
                    {acct(r.netProfit)}
                  </td>
                  <td className={`${l.num} ${l.groupStart} ${l.memo}`}>{acct(r.vat)}</td>
                  <td className={`${l.num} ${l.memo}`}>{fmtNum(r.exchangeRate, 0)}</td>
                </tr>
              ))}
            </tbody>
            {t && t.rows > 0 && (
              <tfoot>
                <tr>
                  <td className={l.stickyA} colSpan={9}>
                    Total · {fmtNum(t.rows)} {t.rows === 1 ? 'entry' : 'entries'}
                  </td>
                  <td className={`${l.num} ${l.groupStart}`}>{acct(t.clearFee)}</td>
                  <td className={l.num}>{acct(t.thc)}</td>
                  <td className={l.num}>{acct(t.commission)}</td>
                  <td className={l.num}>{acct(t.otherPay)}</td>
                  <td className={`${l.num} ${l.groupStart}`}>{acct(t.invRevenue)}</td>
                  <td className={l.num}>{acct(t.disTotal)}</td>
                  <td className={l.num}>{acct(t.dnTotal)}</td>
                  <td
                    className={`${l.num} ${l.groupStart} ${l.result} ${l.grand}`}
                    data-neg={Number(t.netProfit) < 0}
                  >
                    {acct(t.netProfit)}
                  </td>
                  <td className={`${l.num} ${l.groupStart} ${l.memo}`}>{acct(t.vat)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {list.data && (
          <Pager {...list.data.meta} onPage={(p) => set('page', String(p))}>
            {month && <ClearFeePayments month={month} />}
          </Pager>
        )}
      </div>
      {open && <LedgerModal row={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

type Totals = NonNullable<ReturnType<typeof useLedger>['data']>['totals'];

/**
 * The period as a small income statement: income less costs is net profit (with its margin);
 * VAT is held for the tax office, shown apart as a memo line.
 */
function Statement({
  t,
  unpaidOn,
  onUnpaid,
}: {
  t: Totals;
  unpaidOn: boolean;
  onUnpaid: () => void;
}) {
  const income = sumMoney([t.invRevenue, t.disTotal, t.dnTotal]);
  const costs = sumMoney([t.clearFee, t.thc, t.commission, t.otherPay]);
  const net = Number(t.netProfit);
  const margin = income ? (net / income) * 100 : null;
  const costShare = income > 0 ? Math.min(100, (costs / income) * 100) : 0;
  const line = (label: string, v: string, title?: string) => (
    <div className={l.line} title={title}>
      <dt>{label}</dt>
      <dd>{acct(v)}</dd>
    </div>
  );
  return (
    <section className={l.statement} aria-label="Income statement">
      <div className={l.part}>
        <header className={l.partHead}>
          <span>Income</span>
          <b>{usd(income)}</b>
        </header>
        <dl>
          {line('Revenue (INV)', t.invRevenue, 'Service revenue on tax invoices, before VAT')}
          {line('Disbursements', t.disTotal)}
          {line('Debit notes', t.dnTotal)}
        </dl>
      </div>
      <div className={l.part}>
        <header className={l.partHead}>
          <span>Costs</span>
          <b>{usd(costs)}</b>
        </header>
        <dl>
          {line('Clear fee', t.clearFee, 'Paid to Chea')}
          {line('THC', t.thc)}
          {line('CM', t.commission, 'Commission')}
          {line('Other', t.otherPay, 'Other pay')}
        </dl>
      </div>
      <div className={`${l.part} ${l.resultPart}`} data-neg={net < 0}>
        <header className={l.partHead}>
          <span>Net profit</span>
          <span className={l.netLine}>
            <strong className={l.netValue} data-neg={net < 0}>
              {usd(t.netProfit)}
            </strong>
            {margin !== null && (
              <span className={l.margin} data-neg={net < 0}>
                {margin.toFixed(1)}%
              </span>
            )}
          </span>
        </header>
        {/* Where each dollar of income went: costs, then profit. */}
        <div
          className={l.split}
          role="img"
          aria-label={`Costs ${costShare.toFixed(0)}% of income, profit ${(100 - costShare).toFixed(0)}%`}
        >
          <span className={l.splitCost} style={{ width: `${costShare}%` }} />
          <span className={l.splitProfit} />
        </div>
        <div className={l.memos}>
          <span className={l.splitLegend}>
            <span>
              <i className={l.keyCost} /> Costs {costShare.toFixed(0)}%
            </span>
            <span>
              <i className={l.keyProfit} /> Profit {Math.max(0, 100 - costShare).toFixed(0)}%
            </span>
          </span>
          <span
            className={l.memoChip}
            title="VAT 10% on service revenue: collected for the tax office, not profit"
          >
            VAT collected <b>{usd(t.vat)}</b>
          </span>
          <button
            type="button"
            className={l.memoChip}
            data-warn={t.unpaid > 0}
            aria-pressed={unpaidOn}
            title={unpaidOn ? 'Show all' : 'Show unpaid only'}
            onClick={onUnpaid}
          >
            Unpaid to Chea{' '}
            <b>
              {t.unpaid} of {fmtNum(t.rows)}
            </b>
          </button>
        </div>
      </div>
    </section>
  );
}
