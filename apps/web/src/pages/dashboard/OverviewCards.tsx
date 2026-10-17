import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import type { AccountRow, MonthlyVolumeRow, ProfitSummary } from '@gs/shared';
import {
  useAccounts,
  useByCountry,
  useForwarders,
  useLiveConsignments,
  usePorts,
} from '../../features/analytics';
import { useAuth } from '../../auth/AuthProvider';
import { ShipmentStatusPill } from '../../components/StatusPill';
import { fmtDate, fmtMoney } from '../../lib/format';
import {
  CardDropdown,
  ChartState,
  CLIENT_COLORS,
  barGradient,
  changePct,
  dash,
  MONTHS,
  MONTHS_LONG,
  monthLabel,
  niceMax,
} from './parts';
import { WorldMap } from './WorldMap';
import { SingleClientVolume } from './SingleClientVolume';
import { ProfitBars } from './ProfitBars';
import acc from './AccountsCard.module.css';
export { KpiRow } from './KpiRow';

/* ------------------------------ Shipment Summary ------------------------------ */

function SummaryTooltip({
  active,
  payload,
  year,
}: TooltipProps<number, string> & { year: number }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload as {
    month: string;
    total: number;
    imports: number;
    exports: number;
    future: boolean;
  };
  return (
    <div className={dash.tooltip}>
      <div>
        {MONTHS_LONG[Number(p.month.slice(5, 7)) - 1]} {year}
      </div>
      {p.future ? (
        <div style={{ fontWeight: 600 }}>Not available yet</div>
      ) : (
        <>
          <div>
            Shipments <b>{p.total}</b>
          </div>
          <div style={{ fontWeight: 600 }}>
            Import {p.imports} · Export {p.exports}
          </div>
        </>
      )}
    </div>
  );
}

export function ShipmentSummaryCard({
  year,
  monthly,
  currentMonth,
  loading,
  error,
}: {
  year: number;
  monthly: MonthlyVolumeRow[];
  currentMonth: string;
  loading: boolean;
  error: unknown;
}) {
  const [selected, setSelected] = useState(
    currentMonth.startsWith(String(year)) ? currentMonth : `${year}-01`,
  );
  // Months after the current one haven't happened yet: no line, a hatched "not available" band.
  const data = monthly.map((m) => {
    const future = !!currentMonth && m.month > currentMonth;
    return { ...m, label: monthLabel(m.month), future, actual: future ? null : m.total };
  });
  const firstFuture = data.findIndex((d) => d.future);
  const futureFrom = firstFuture > 0 ? data[firstFuture - 1]!.label : data[0]?.label;
  const sel = data.find((d) => d.month === selected && !d.future);
  const empty = !loading && data.every((d) => d.total === 0);
  return (
    <div className="shipment-summary-card ga-chart">
      <div className="ss-header-row">
        <h3>Shipment Summary of {year}</h3>
        <CardDropdown
          label="Highlight month"
          value={selected}
          onChange={setSelected}
          options={data.map((d) => ({
            value: d.month,
            label: `${MONTHS_LONG[Number(d.month.slice(5, 7)) - 1]}: ${d.future ? '—' : d.total}`,
            disabled: d.future,
          }))}
        />
      </div>
      <div className="ss-chart-wrap">
        <ChartState loading={loading} error={error} empty={empty} height={250}>
          <div className={dash.chartBox} style={{ minHeight: 250 }}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart
                data={data}
                margin={{ top: 16, right: 16, bottom: 0, left: -12 }}
                onClick={(e) => {
                  const hit = data.find((d) => d.label === e?.activeLabel);
                  if (hit && !hit.future) setSelected(hit.month);
                }}
              >
                <defs>
                  <linearGradient id="ssAreaGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
                  </linearGradient>
                  <pattern
                    id="ssFutureHatch"
                    width="8"
                    height="8"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <line
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="8"
                      stroke="var(--text-tertiary)"
                      strokeOpacity={0.22}
                      strokeWidth={2}
                    />
                  </pattern>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border-subtle)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={(p: { x: number; y: number; payload: { value: string } }) => {
                    const future = data.find((d) => d.label === p.payload.value)?.future;
                    return (
                      <text
                        x={p.x}
                        y={p.y + 12}
                        textAnchor="middle"
                        fontSize={10}
                        fontWeight={p.payload.value === sel?.label ? 800 : 700}
                        fill={p.payload.value === sel?.label ? '#22D3EE' : 'var(--text-tertiary)'}
                        fillOpacity={future ? 0.45 : 1}
                      >
                        {p.payload.value}
                      </text>
                    );
                  }}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tick={{ fontSize: 10, fontWeight: 700, fill: 'var(--text-tertiary)' }}
                />
                <Tooltip
                  content={<SummaryTooltip year={year} />}
                  cursor={{ stroke: '#22D3EE', strokeDasharray: '2 3', strokeWidth: 1.5 }}
                />
                {firstFuture >= 0 && (
                  <ReferenceArea
                    x1={futureFrom}
                    x2={data[data.length - 1]!.label}
                    fill="url(#ssFutureHatch)"
                    fillOpacity={1}
                    stroke="var(--border-strong)"
                    strokeDasharray="4 4"
                    strokeOpacity={0.6}
                    ifOverflow="extendDomain"
                  />
                )}
                {sel && (
                  <ReferenceLine
                    x={sel.label}
                    stroke="#22D3EE"
                    strokeDasharray="2 3"
                    strokeWidth={1.5}
                    label={{
                      value: `${sel.total}`,
                      position: 'top',
                      fill: '#22D3EE',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="actual"
                  stroke="#22D3EE"
                  strokeWidth={3}
                  fill="url(#ssAreaGlow)"
                  dot={{ r: 3, fill: 'var(--bg-surface)', stroke: '#22D3EE', strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: '#22D3EE', stroke: 'var(--bg-surface)', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartState>
      </div>
    </div>
  );
}

/* ------------------------------ Net profit (accounting roles) ------------------------------ */

const MONTH_NAMES = [
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
const monthName = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/**
 * Net profit for one month (this month to start; click a month on the line to change it):
 * the figure, the change on the month before, and that month's split by client.
 */
export function ProfitCard({ profit }: { profit: ProfitSummary }) {
  const [picked, setPicked] = useState<{ year: number; month: string } | null>(null);
  const month = picked?.year === profit.year ? picked.month : profit.currentMonth;
  const idx = profit.monthly.findIndex((m) => m.month === month);
  const value = Number(profit.monthly[idx]?.netProfit ?? 0);
  const prevMonth = idx > 0 ? profit.monthly[idx - 1]! : null;
  // January's "month before" is last December: only known for the current month.
  const prevValue = prevMonth
    ? Number(prevMonth.netProfit)
    : month === profit.currentMonth
      ? Number(profit.lastMonth)
      : null;
  const ch = prevValue === null ? null : changePct(value, prevValue);
  const prevLabel = prevMonth ? MONTH_NAMES[Number(prevMonth.month.slice(5, 7)) - 1] : 'December';

  const rows = profit.byClientMonthly.filter((c) => c.month === month);
  const sum = rows.reduce((t, c) => t + Number(c.netProfit), 0);
  const clients = rows.map((c) => ({
    ...c,
    pct: sum ? Math.round((Number(c.netProfit) / sum) * 1000) / 10 : 0,
  }));
  const positive = clients.filter((c) => Number(c.netProfit) > 0);

  return (
    <div className="rc-card ga-revenue">
      <div className="rc-header">
        <div className="rc-title">Total Net Profit</div>
        <div className="rc-subtitle">
          {monthName(month)} · all clients · {profit.year} to date {fmtMoney(profit.total)}
        </div>
      </div>
      <div className="rc-top-hero">
        <div className="rc-metric-left">
          <div
            className="rc-total-amount"
            style={value < 0 ? { color: 'var(--status-exception-fg)' } : undefined}
          >
            {fmtMoney(value)}
          </div>
          <div className="rc-trend-pill">
            <span
              className="rc-pill-badge"
              style={
                ch && !ch.up
                  ? {
                      background: 'var(--status-exception-bg)',
                      color: 'var(--status-exception-fg)',
                    }
                  : undefined
              }
            >
              {ch?.text ?? '—'}
            </span>
            <span className="rc-pill-text">vs {prevLabel}</span>
          </div>
        </div>
        <ProfitBars
          monthly={profit.monthly}
          selected={month}
          onSelect={(m) => setPicked({ year: profit.year, month: m })}
        />
      </div>
      <div className="rc-main-body">
        <div className="rc-donut-wrapper">
          {positive.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[{ v: 1 }]}
                  dataKey="v"
                  innerRadius={44}
                  outerRadius={56}
                  fill="var(--bg-subtle)"
                  stroke="none"
                  isAnimationActive={false}
                />
                <Pie
                  data={positive.map((c) => ({ name: c.code, v: Number(c.netProfit) }))}
                  dataKey="v"
                  innerRadius={44}
                  outerRadius={56}
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={2}
                  stroke="none"
                >
                  {positive.map((c) => (
                    <Cell
                      key={c.clientId}
                      fill={CLIENT_COLORS[clients.indexOf(c) % CLIENT_COLORS.length]}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          ) : null}
          <div className="rc-donut-center-text">
            <span className="pct">{clients.length}</span>
            <span className="tag">Clients</span>
          </div>
        </div>
        <div className="rc-client-list">
          {clients.slice(0, 5).map((c, i) => (
            <div className="rc-client-row" key={c.clientId}>
              <div className="rc-bar-group">
                <div className="rc-client-name">
                  <span
                    className="dot"
                    style={{ background: CLIENT_COLORS[i % CLIENT_COLORS.length] }}
                  />
                  {c.name}
                </div>
                <div className="rc-bar-track">
                  <div
                    className="rc-bar-fill"
                    style={{
                      width: `${Math.max(0, c.pct)}%`,
                      background: barGradient(CLIENT_COLORS[i % CLIENT_COLORS.length]),
                    }}
                  />
                </div>
              </div>
              <div className="rc-val-group">
                <span className="rc-client-pct">{c.pct}%</span>
                <span
                  className="rc-client-val"
                  style={
                    Number(c.netProfit) < 0 ? { color: 'var(--status-exception-fg)' } : undefined
                  }
                >
                  {fmtMoney(c.netProfit)}
                </span>
              </div>
            </div>
          ))}
          {!clients.length && (
            <span className={dash.mutedNote}>No ledger entries in {monthName(month)} yet.</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shown instead of profit to roles without accounting access: shipment share per client. */
export function ClientShareCard({
  accounts,
  year,
  monthly,
  currentMonth,
}: {
  accounts: AccountRow[];
  year: number;
  monthly: MonthlyVolumeRow[];
  currentMonth: string;
}) {
  const total = accounts.reduce((s, a) => s + a.all.total, 0);
  // One client: a share-of-total donut is always 100%, so show their year month by month.
  if (accounts.length === 1)
    return (
      <SingleClientVolume
        a={accounts[0]!}
        year={year}
        monthly={monthly}
        currentMonth={currentMonth}
      />
    );
  return (
    <div className="rc-card ga-revenue">
      <div className="rc-header">
        <div className="rc-title">Shipments by Client</div>
        <div className="rc-subtitle">Share of all shipments in {year}</div>
      </div>
      <div className="rc-top-hero">
        <div className="rc-metric-left">
          <div className="rc-total-amount">{total.toLocaleString()}</div>
        </div>
      </div>
      <div className="rc-main-body">
        <div className="rc-donut-wrapper">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={accounts.map((a) => ({ v: a.all.total }))}
                dataKey="v"
                innerRadius={44}
                outerRadius={56}
                startAngle={90}
                endAngle={-270}
                paddingAngle={2}
                stroke="none"
              >
                {accounts.map((a, i) => (
                  <Cell key={a.clientId} fill={CLIENT_COLORS[i % CLIENT_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="rc-donut-center-text">
            <span className="pct">{accounts.length}</span>
            <span className="tag">Clients</span>
          </div>
        </div>
        <div className="rc-client-list">
          {accounts.slice(0, 5).map((a, i) => {
            const pct = total ? (a.all.total / total) * 100 : 0;
            return (
              <div className="rc-client-row" key={a.clientId}>
                <div className="rc-bar-group">
                  <div className="rc-client-name">
                    <span
                      className="dot"
                      style={{ background: CLIENT_COLORS[i % CLIENT_COLORS.length] }}
                    />
                    {a.name}
                  </div>
                  <div className="rc-bar-track">
                    <div
                      className="rc-bar-fill"
                      style={{
                        width: `${pct}%`,
                        background: barGradient(CLIENT_COLORS[i % CLIENT_COLORS.length]),
                      }}
                    />
                  </div>
                </div>
                <div className="rc-val-group">
                  <span className="rc-client-pct">{pct.toFixed(1)}%</span>
                  <span className="rc-client-val">{a.all.total}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Countries (map card) ------------------------------ */

export function CountryMapCard({ filters }: { filters: { from: string; to: string } }) {
  const [flow, setFlow] = useState<'import' | 'export'>('import');
  const q = useByCountry(filters, flow);
  const rows = q.data ?? [];
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <div className="world-map-card ga-map">
      <div>
        <div className="world-map-header-row">
          <div>
            <div className="world-map-title-wrap">
              <span className="world-map-title-bar" />
              <div className="world-map-title">
                {flow === 'import' ? 'Imported By Countries' : 'Exported By Countries'}
              </div>
            </div>
            <div className="world-map-sub">
              {rows.length
                ? `${total.toLocaleString()} shipments · ${rows.length} ${rows.length === 1 ? 'country' : 'countries'}`
                : 'No shipments in this period'}
            </div>
          </div>
          <CardDropdown
            label="Flow"
            value={flow}
            onChange={setFlow}
            options={[
              { value: 'import', label: 'Import' },
              { value: 'export', label: 'Export' },
            ]}
          />
        </div>
        <div className="world-map-visual">
          <WorldMap rows={rows} />
        </div>
      </div>
      <div className="world-country-list">
        <ChartState loading={q.isLoading} error={q.error} empty={!rows.length} height={90}>
          {rows.slice(0, 3).map((r, i) => (
            <div
              className="world-country-row"
              key={r.iso2}
              title={`${r.count} shipments`}
              data-top={i === 0 || undefined}
            >
              <span className="c-rank">{i + 1}</span>
              <span className="c-name">{r.name}</span>
              <span className="c-val">{r.pct}%</span>
              <span className="c-bar">
                <span style={{ width: `${Math.min(100, r.pct)}%` }} />
              </span>
            </div>
          ))}
        </ChartState>
      </div>
    </div>
  );
}

/* ------------------------------ Key accounts ------------------------------ */

export function AccountsCard({ filters }: { filters: { from: string; to: string } }) {
  const [type, setType] = useState<'all' | 'import' | 'export'>('all');
  // A user limited to one client picks a year and month instead of All / Import / Export
  // (their card already shows the import/export split).
  const { user } = useAuth();
  const single = user?.clientIds?.length === 1;
  const thisYear = Number(filters.from.slice(0, 4));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' })
    .format(new Date())
    .slice(0, 7);
  const [year, setYear] = useState(String(thisYear));
  const [month, setMonth] = useState(''); // '' = the whole year
  // Months up to the current one in the current year; all twelve for a past year.
  const lastMonth = year === today.slice(0, 4) ? Number(today.slice(5, 7)) : 12;
  const range = !single
    ? filters
    : month
      ? {
          from: `${year}-${month}-01`,
          to: new Date(Date.UTC(Number(year), Number(month), 0)).toISOString().slice(0, 10),
        }
      : { from: `${year}-01-01`, to: `${year}-12-31` };
  const q = useAccounts(range);
  const period = month ? `${MONTHS_LONG[Number(month) - 1]} ${year}` : year;
  return (
    <div className="accounts-card ga-accounts">
      <div className="accounts-card-header">
        <h3>Key Logistics Accounts</h3>
        {single ? (
          <div className={acc.controls}>
            <CardDropdown
              label="Year"
              value={year}
              onChange={(y) => {
                setYear(y);
                // Keep the month only if it exists in that year so far.
                const last = y === today.slice(0, 4) ? Number(today.slice(5, 7)) : 12;
                if (Number(month) > last) setMonth('');
              }}
              options={[0, 1, 2].map((d) => ({
                value: String(thisYear - d),
                label: String(thisYear - d),
              }))}
            />
            <CardDropdown
              label="Month"
              value={month}
              onChange={setMonth}
              options={[
                { value: '', label: 'All months' },
                ...Array.from({ length: lastMonth }, (_, i) => ({
                  value: String(i + 1).padStart(2, '0'),
                  label: MONTHS[i]!,
                })),
              ]}
            />
          </div>
        ) : (
          <div className="accounts-seg-control" role="tablist">
            {(['all', 'import', 'export'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={type === t}
                className={`accounts-seg-btn${type === t ? ' active' : ''}`}
                onClick={() => setType(t)}
              >
                {t === 'all' ? 'All' : t === 'import' ? 'Import' : 'Export'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="accounts-table-wrap">
        <ChartState
          loading={q.isLoading}
          error={q.error}
          empty={!q.data?.length}
          emptyText={single ? `No shipments in ${period}` : undefined}
          height={120}
        >
          {q.data?.length === 1 ? (
            <SingleAccount
              a={q.data[0]!}
              type={single ? 'all' : type}
              period={single ? period : 'this year'}
            />
          ) : (
            <table className="accounts-table">
              <thead>
                <tr>
                  <th>CLIENT NAME</th>
                  <th style={{ textAlign: 'center' }}>Total</th>
                  <th style={{ textAlign: 'center' }}>CY / CY</th>
                  <th style={{ textAlign: 'center' }}>LCL</th>
                  <th style={{ textAlign: 'center' }}>AIR</th>
                </tr>
              </thead>
              <tbody>
                {q.data?.map((a) => {
                  const d = a[type];
                  return (
                    <tr key={a.clientId}>
                      <td>
                        <Link to={`/clients/${a.clientId}`} className="accounts-name">
                          {a.name}
                        </Link>
                      </td>
                      <td className="accounts-val-bold" style={{ textAlign: 'center' }}>
                        {d.total.toLocaleString()}
                      </td>
                      <td
                        style={{
                          textAlign: 'center',
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {d.cy}
                      </td>
                      <td
                        style={{
                          textAlign: 'center',
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {d.lcl}
                      </td>
                      <td
                        style={{
                          textAlign: 'center',
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {d.air}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </ChartState>
      </div>
    </div>
  );
}

/**
 * One client only (e.g. a user limited to one client): a summary instead of a one-row
 * table: total, import/export split, then CY/CY, LCL and AIR with their share.
 */
function SingleAccount({
  a,
  type,
  period,
}: {
  a: AccountRow;
  type: 'all' | 'import' | 'export';
  /** "this year", "2025" or "October 2026". */
  period: string;
}) {
  const d = a[type];
  const pct = (n: number) => (d.total ? Math.round((n / d.total) * 100) : 0);
  const flows = a.all.total
    ? { imp: (a.import.total / a.all.total) * 100, exp: (a.export.total / a.all.total) * 100 }
    : { imp: 0, exp: 0 };
  return (
    <div className={acc.single}>
      <div className={acc.head}>
        <span className={acc.badge}>{a.code}</span>
        <div className={acc.who}>
          <Link to={`/clients/${a.clientId}`} className={acc.name}>
            {a.name}
          </Link>
          <span className={acc.sub}>
            {type === 'all' ? 'All shipments' : type === 'import' ? 'Imports' : 'Exports'}{' '}
            {period === 'this year' ? period : `in ${period}`}
          </span>
        </div>
        <div className={acc.total}>
          <b>{d.total.toLocaleString()}</b>
          <span>shipments</span>
        </div>
      </div>

      <div className={acc.flow}>
        <div className={acc.flowBar} role="img" aria-label="Import and export split">
          <span style={{ width: `${flows.imp}%` }} data-on={type !== 'export' || undefined} />
          <span style={{ width: `${flows.exp}%` }} data-on={type !== 'import' || undefined} />
        </div>
        <div className={acc.flowLegend}>
          <span>
            <i data-kind="imp" /> Import <b>{a.import.total}</b>
          </span>
          <span>
            <i data-kind="exp" /> Export <b>{a.export.total}</b>
          </span>
        </div>
      </div>

      <div className={acc.modes}>
        {(
          [
            ['CY / CY', d.cy],
            ['LCL', d.lcl],
            ['AIR', d.air],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className={acc.mode}>
            <span className={acc.modeLabel}>{label}</span>
            <span className={acc.modeVal}>
              {n.toLocaleString()} <small>{pct(n)}%</small>
            </span>
            <span className={acc.modeBar}>
              <span style={{ width: `${pct(n)}%` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ Port of discharge ------------------------------ */

export function PortCard({ filters }: { filters: { from: string; to: string } }) {
  const [flow, setFlow] = useState<'imports' | 'exports'>('imports');
  const [mode, setMode] = useState<'percentage' | 'shipment'>('percentage');
  const q = usePorts(filters);
  const rows = useMemo(() => {
    const list = (q.data ?? [])
      .map((p) => ({ name: p.shortName, v: p[flow] }))
      .filter((p) => p.v > 0)
      .sort((a, b) => b.v - a.v);
    const top = list.slice(0, 3);
    const others = list.slice(3).reduce((s, p) => s + p.v, 0);
    return others ? [...top, { name: 'OTHERS', v: others }] : top;
  }, [q.data, flow]);
  const sum = rows.reduce((s, r) => s + r.v, 0);
  const values = rows.map((r) =>
    mode === 'percentage' ? Math.round((r.v / (sum || 1)) * 100) : r.v,
  );
  const max = mode === 'percentage' ? 100 : niceMax(Math.max(1, ...values));
  const ticks = Array.from({ length: 6 }, (_, i) => Math.round(max - (max / 5) * i));
  return (
    <div className="port-card ga-port">
      <div className="port-card-header">
        <h3>Port of Discharge</h3>
        <div className="port-card-controls">
          <CardDropdown
            label="Flow"
            value={flow}
            onChange={setFlow}
            options={[
              { value: 'imports', label: 'Import' },
              { value: 'exports', label: 'Export' },
            ]}
          />
          <CardDropdown
            label="Measure"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'percentage', label: 'By Percentage' },
              { value: 'shipment', label: 'By Shipment' },
            ]}
          />
        </div>
      </div>
      <ChartState loading={q.isLoading} error={q.error} empty={!rows.length} height={230}>
        <div
          className="port-chart-wrap"
          role="img"
          aria-label={rows
            .map((r, i) => `${r.name} ${values[i]}${mode === 'percentage' ? '%' : ''}`)
            .join(', ')}
        >
          <div className="port-chart-yaxis">
            {ticks.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <div className="port-chart-plot">
            {rows.map((r, i) => (
              <div className="port-bar-col" key={r.name}>
                <div className="port-bar-track">
                  <div
                    className="port-bar"
                    style={{ height: `${Math.min(100, (values[i]! / max) * 100)}%` }}
                  >
                    <span className="port-bar-value">
                      {mode === 'percentage' ? `${values[i]}%` : values[i]}
                    </span>
                  </div>
                </div>
                <span className="port-bar-label">{r.name}</span>
              </div>
            ))}
          </div>
        </div>
      </ChartState>
    </div>
  );
}

/* ------------------------------ Forwarder radar ------------------------------ */

type ForwarderMetric = 'imports' | 'exports';

export function ForwarderCard({ filters }: { filters: { from: string; to: string } }) {
  const [metric, setMetric] = useState<ForwarderMetric>('imports');
  const q = useForwarders(filters);
  const data = (q.data ?? []).slice(0, 6).map((f) => ({
    name: f.name.replace(' Logistics', '').replace('Global Forwarding', ''),
    v: f[metric] ?? 0,
  }));
  return (
    <div className="forwarder-card ga-forwarder">
      <div className="forwarder-card-header">
        <div className="forwarder-card-title">
          <span className="accent-bar" />
          <h3>Forwarder Statistics</h3>
        </div>
        <CardDropdown
          label="Measure"
          value={metric}
          onChange={setMetric}
          triggerClass="forwarder-filter-trigger"
          options={[
            { value: 'imports', label: 'Import' },
            { value: 'exports', label: 'Export' },
          ]}
        />
      </div>
      <div className="forwarder-radar-wrap">
        <ChartState
          loading={q.isLoading}
          error={q.error}
          empty={data.length < 3}
          emptyText={
            data.length ? 'Needs at least 3 forwarders to compare' : 'No shipments in this period'
          }
          height={230}
        >
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={data} outerRadius="70%">
              <PolarGrid stroke="var(--border-subtle)" />
              <PolarAngleAxis
                dataKey="name"
                tick={{ fontSize: 10.5, fontWeight: 700, fill: 'var(--text-secondary)' }}
              />
              <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 'auto']} />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className={dash.tooltipPlain}>
                      {(payload[0]!.payload as { name: string }).name}:{' '}
                      <b>{payload[0]!.value} shipments</b>
                    </div>
                  ) : null
                }
              />
              <Radar
                dataKey="v"
                stroke="#22D3EE"
                strokeWidth={2}
                fill="#22D3EE"
                fillOpacity={0.25}
                dot={{ r: 3, fill: '#22D3EE' }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </ChartState>
      </div>
    </div>
  );
}

/* ------------------------------ Live consignments ------------------------------ */

export function LiveConsignmentsCard() {
  const q = useLiveConsignments();
  const navigate = useNavigate();
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header-row">
        <div>
          <h3>Live Consignments Tracking</h3>
          <div className="create-header-desc" style={{ marginTop: 4 }}>
            Exceptions first, then shipments in progress closest to their ETA.
          </div>
        </div>
        <Link to="/plans" className="filter-btn">
          Open Shipping Plans
        </Link>
      </div>
      <div className="plans-table-scroll">
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>Invoice No.</th>
              <th>Client</th>
              <th>Transport</th>
              <th>Forwarder</th>
              <th>Clearance Port</th>
              <th>ETA Port</th>
              <th>Shipment Status</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={7}>
                  <div className={dash.skeleton} style={{ minHeight: 120 }} />
                </td>
              </tr>
            )}
            {!q.isLoading && !q.data?.length && (
              <tr>
                <td
                  colSpan={7}
                  style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 24 }}
                >
                  Nothing in progress right now.
                </td>
              </tr>
            )}
            {q.data?.map((r) => (
              <tr
                key={r.id}
                className="plans-row-clickable"
                tabIndex={0}
                onClick={() => navigate(`/plans/${r.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/plans/${r.id}`)}
              >
                <td className="val-bold">{r.invoiceNos.join(', ') || r.reference}</td>
                <td>{r.clientCode}</td>
                <td>{r.direction}</td>
                <td>{r.forwarderName ?? '-'}</td>
                <td>{r.clearancePortName ?? '-'}</td>
                <td>{fmtDate(r.eta)}</td>
                <td>
                  <ShipmentStatusPill status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { MONTHS };
