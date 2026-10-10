import { useId } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { ClientRevenueRow } from '@gs/shared';
import type { AnalyticsFilters } from '../../features/analytics';
import { useClientRevenue } from '../../features/analytics';
import { fmtDate, fmtMoney } from '../../lib/format';
import { ChartState, monthLabel } from '../dashboard/parts';
import s from './ClientRevenueCards.module.css';

/** Revenue mix (INV / DIS / DN) as three shades of the one accent colour. */
const shade = (pct: number) => `color-mix(in srgb, var(--accent-primary) ${pct}%, transparent)`;
const MIX = [
  { key: 'invRevenue', label: 'INV (Service)', color: shade(100) },
  { key: 'disTotal', label: 'Disbursements', color: shade(55) },
  { key: 'dnTotal', label: 'Debit notes', color: shade(25) },
] as const;
const COSTS = [
  { key: 'clearFee', label: 'Clear fee' },
  { key: 'thc', label: 'THC' },
  { key: 'commission', label: 'Commission' },
  { key: 'otherPay', label: 'Other' },
] as const;

/** Ledger link for the card: a single month, a single year, or just the client. */
function ledgerLink(clientId: string, from?: string, to?: string) {
  const q = new URLSearchParams({ clientId });
  if (from && to && from.slice(0, 7) === to.slice(0, 7)) q.set('month', from.slice(0, 7));
  else if (from && to && from.slice(0, 4) === to.slice(0, 4)) q.set('year', from.slice(0, 4));
  return `/accounting/ledger?${q}`;
}

function Trend({ rows }: { rows: ClientRevenueRow['monthly'] }) {
  const id = useId().replace(/:/g, '');
  const data = rows.map((m) => ({ month: m.month, v: Number(m.netProfit) }));
  return (
    <div className={s.trend}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 2, left: 4 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '3 3' }}
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <div className={s.tip}>
                  {monthLabel(payload[0].payload.month)} {payload[0].payload.month.slice(0, 4)}:{' '}
                  <b>{fmtMoney(payload[0].value as number)}</b>
                </div>
              ) : null
            }
          />
          <Area
            type="monotone"
            dataKey="v"
            stroke="var(--accent-primary)"
            strokeWidth={1.8}
            fill={`url(#${id})`}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0, fill: 'var(--accent-primary)' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ClientCard({ r, link }: { r: ClientRevenueRow; link: string }) {
  const revenue = Number(r.revenue);
  const loss = Number(r.netProfit) < 0;
  return (
    <article className={s.card}>
      <header className={s.head}>
        <span className={s.badge}>{r.code}</span>
        <div className={s.who}>
          <h4 className={s.name} title={r.name}>
            {r.name}
          </h4>
          <div className={s.meta}>
            {r.entries} {r.entries === 1 ? 'entry' : 'entries'} · last invoice{' '}
            {fmtDate(r.lastInvDate)}
          </div>
        </div>
        {r.sharePct !== null && (
          <span className={s.share} title="Share of all clients' net profit">
            <b>{r.sharePct}%</b> of profit
          </span>
        )}
      </header>

      <div className={s.body}>
        {/* Left: the headline number and how it moved month to month. */}
        <div className={s.summary}>
          <div className={s.label}>Net profit</div>
          <div className={s.value} data-loss={loss || undefined}>
            {fmtMoney(r.netProfit)}
          </div>
          {r.marginPct !== null && (
            <div className={s.margin} data-loss={loss || undefined}>
              {r.marginPct}% margin
            </div>
          )}
          {r.monthly.length > 1 && <Trend rows={r.monthly} />}
        </div>

        {/* Right: where the money came from and where it went. */}
        <div className={s.detail}>
          <div className={s.mix}>
            <div className={s.mixBar} role="img" aria-label="Revenue mix">
              {MIX.map((m) => {
                const v = Number(r[m.key]);
                return v > 0 && revenue > 0 ? (
                  <span
                    key={m.key}
                    style={{ width: `${(v / revenue) * 100}%`, background: m.color }}
                    title={`${m.label}: ${fmtMoney(v)} (${((v / revenue) * 100).toFixed(1)}%)`}
                  />
                ) : null;
              })}
            </div>
          </div>
          <div className={s.cols}>
            <div>
              <h5 className={s.label}>Revenue</h5>
              <dl className={s.lines}>
                {MIX.map((m) => (
                  <div key={m.key}>
                    <dt>
                      <i style={{ background: m.color }} />
                      {m.label}
                    </dt>
                    <dd>{fmtMoney(r[m.key])}</dd>
                  </div>
                ))}
                <div className={s.total}>
                  <dt>Total billed</dt>
                  <dd>{fmtMoney(r.revenue)}</dd>
                </div>
              </dl>
            </div>
            <div>
              <h5 className={s.label}>Costs</h5>
              <dl className={s.lines}>
                {COSTS.map((c) => (
                  <div key={c.key}>
                    <dt>{c.label}</dt>
                    <dd>{fmtMoney(r[c.key])}</dd>
                  </div>
                ))}
                <div className={s.total}>
                  <dt>Total costs</dt>
                  <dd>{fmtMoney(r.costs)}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>

      <footer className={s.foot}>
        <span title="Collected for the tax office, not profit">
          VAT 10% <b>{fmtMoney(r.vat)}</b>
        </span>
        <span className={s.dot} aria-hidden="true" />
        <span data-warn={r.unpaid > 0 || undefined} className={s.unpaid}>
          {r.unpaid} unpaid (Chea)
        </span>
        <Link to={link} className={s.open}>
          Open ledger →
        </Link>
      </footer>
    </article>
  );
}

/** Analytics section: one card per client with every ledger figure for the period. */
export function ClientRevenueCards({
  filters,
  periodLabel,
}: {
  filters: AnalyticsFilters;
  periodLabel: string;
}) {
  const q = useClientRevenue(filters, true);
  const rows = q.data ?? [];
  const ignored = filters.direction || filters.transportMode;
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="an-section-title-row">
        <div>
          <h3>Client Revenue — Full Breakdown</h3>
          <div className="an-section-sub">
            Every revenue and cost line per client from the Monthly Ledger, by invoice date.{' '}
            {periodLabel}
            {ignored && ' · Import/export and transport filters don’t apply to the ledger.'}
          </div>
        </div>
      </div>
      <ChartState
        loading={q.isLoading}
        error={q.error}
        empty={!rows.length}
        emptyText="No ledger entries in this period"
        height={160}
      >
        <div className={s.grid}>
          {rows.map((r) => (
            <ClientCard
              key={r.clientId}
              r={r}
              link={ledgerLink(r.clientId, filters.from, filters.to)}
            />
          ))}
        </div>
      </ChartState>
    </div>
  );
}
