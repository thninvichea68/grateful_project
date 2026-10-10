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
  };
  return (
    <div className={dash.tooltip}>
      <div>
        {MONTHS_LONG[Number(p.month.slice(5, 7)) - 1]} {year}
      </div>
      <div>
        Shipments <b>{p.total}</b>
      </div>
      <div style={{ fontWeight: 600 }}>
        Import {p.imports} · Export {p.exports}
      </div>
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
  const data = monthly.map((m) => ({ ...m, label: monthLabel(m.month) }));
  const sel = data.find((d) => d.month === selected);
  const empty = !loading && data.every((d) => d.total === 0);
  return (
    <div className="shipment-summary-card ga-chart">
      <div className="ss-header-row">
        <h3>Shipment Summary of {year}</h3>
        <select
          className={dash.ssMonthSelect}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          aria-label="Highlight month"
        >
          {data.map((d) => (
            <option key={d.month} value={d.month}>
              {MONTHS_LONG[Number(d.month.slice(5, 7)) - 1]}: {d.total}
            </option>
          ))}
        </select>
      </div>
      <div className="ss-chart-wrap">
        <ChartState loading={loading} error={error} empty={empty} height={250}>
          <div className={dash.chartBox} style={{ minHeight: 250 }}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart
                data={data}
                margin={{ top: 16, right: 16, bottom: 0, left: -12 }}
                onClick={(e) =>
                  e?.activeLabel &&
                  setSelected(data.find((d) => d.label === e.activeLabel)?.month ?? selected)
                }
              >
                <defs>
                  <linearGradient id="ssAreaGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
                  </linearGradient>
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
                  tick={(p: { x: number; y: number; payload: { value: string } }) => (
                    <text
                      x={p.x}
                      y={p.y + 12}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={p.payload.value === sel?.label ? 800 : 700}
                      fill={p.payload.value === sel?.label ? '#22D3EE' : 'var(--text-tertiary)'}
                    >
                      {p.payload.value}
                    </text>
                  )}
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
                      fontWeight: 900,
                    }}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="total"
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

export function ProfitCard({ profit }: { profit: ProfitSummary }) {
  const ch = changePct(Number(profit.thisMonth), Number(profit.lastMonth));
  const positive = profit.byClient.filter((c) => Number(c.netProfit) > 0);
  const spark = profit.monthly.map((m) => ({ v: Number(m.netProfit) }));
  return (
    <div className="rc-card ga-revenue">
      <div className="rc-header">
        <div className="rc-title">Total Net Profit</div>
        <div className="rc-subtitle">Overview of profit across all clients, {profit.year}</div>
      </div>
      <div className="rc-top-hero">
        <div className="rc-metric-left">
          <div
            className="rc-total-amount"
            style={Number(profit.total) < 0 ? { color: 'var(--status-exception-fg)' } : undefined}
          >
            {fmtMoney(profit.total)}
          </div>
          <div className="rc-trend-pill">
            <span className="rc-pill-badge">{ch?.text ?? '—'}</span>
            <span className="rc-pill-text">this month vs last</span>
          </div>
        </div>
        <div className="rc-sparkline-wrap" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 4, right: 4, bottom: 2, left: 2 }}>
              <defs>
                <linearGradient id="revenueSparkGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00C2E8" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#00C2E8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke="#00C2E8"
                strokeWidth={2.5}
                fill="url(#revenueSparkGrad)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
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
                      fill={CLIENT_COLORS[profit.byClient.indexOf(c) % CLIENT_COLORS.length]}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          ) : null}
          <div className="rc-donut-center-text">
            <span className="pct">{profit.byClient.length}</span>
            <span className="tag">Clients</span>
          </div>
        </div>
        <div className="rc-client-list">
          {profit.byClient.slice(0, 5).map((c, i) => (
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
          {!profit.byClient.length && (
            <span className={dash.mutedNote}>No ledger entries this year yet.</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shown instead of profit to roles without accounting access: shipment share per client. */
export function ClientShareCard({ accounts, year }: { accounts: AccountRow[]; year: number }) {
  const total = accounts.reduce((s, a) => s + a.all.total, 0);
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
  const q = useAccounts(filters);
  return (
    <div className="accounts-card ga-accounts">
      <div className="accounts-card-header">
        <h3>Key Logistics Accounts</h3>
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
      </div>
      <div className="accounts-table-wrap">
        <ChartState loading={q.isLoading} error={q.error} empty={!q.data?.length} height={120}>
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
                      style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text-primary)' }}
                    >
                      {d.cy}
                    </td>
                    <td
                      style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text-primary)' }}
                    >
                      {d.lcl}
                    </td>
                    <td
                      style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text-primary)' }}
                    >
                      {d.air}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ChartState>
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

type ForwarderMetric = 'factory' | 'imports' | 'exports' | 'onTimePct';

export function ForwarderCard({ filters }: { filters: { from: string; to: string } }) {
  const [metric, setMetric] = useState<ForwarderMetric>('factory');
  const q = useForwarders(filters);
  const data = (q.data ?? []).slice(0, 6).map((f) => ({
    name: f.name.replace(' Logistics', '').replace('Global Forwarding', ''),
    v: f[metric] ?? 0,
  }));
  const unit = metric === 'onTimePct' ? '%' : '';
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
            { value: 'factory', label: 'Factory' },
            { value: 'imports', label: 'Import' },
            { value: 'exports', label: 'Export' },
            { value: 'onTimePct', label: 'On-time %' },
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
              <PolarRadiusAxis
                tick={false}
                axisLine={false}
                domain={[0, metric === 'onTimePct' ? 100 : 'auto']}
              />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className={dash.tooltipPlain}>
                      {(payload[0]!.payload as { name: string }).name}:{' '}
                      <b>
                        {payload[0]!.value}
                        {unit}
                      </b>
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
