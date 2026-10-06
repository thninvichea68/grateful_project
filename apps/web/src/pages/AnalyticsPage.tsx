import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CLEARANCE_STATUS_LABEL } from '@gs/shared';
import {
  useAccounts,
  useByCountry,
  useClearanceStatus,
  useForwarders,
  useKpis,
  useMonthlyVolume,
  usePorts,
  useTransportShare,
  type AnalyticsFilters,
} from '../features/analytics';
import { useLookups } from '../features/hooks';
import { ChartState, HBarList, changePct, dash, monthLabel } from './dashboard/parts';

const CLEARANCE_COLOR = {
  CLEARED: 'var(--status-completed-fg)',
  IN_PROGRESS: 'var(--status-progress-fg)',
  PENDING: 'var(--status-pending-fg)',
  EXCEPTION: 'var(--status-exception-fg)',
} as const;
const MODES = {
  '': { label: 'All transport', mode: undefined, load: undefined },
  FCL: { label: 'Sea CY/CY', mode: 'SEA', load: 'FCL' },
  LCL: { label: 'Sea LCL', mode: 'SEA', load: 'LCL' },
  AIR: { label: 'Air', mode: 'AIR', load: undefined },
  ROAD: { label: 'Road / truck', mode: 'ROAD', load: undefined },
} as const;
type ModeKey = keyof typeof MODES;

/** Today in Phnom Penh as YYYY-MM-DD. */
function ppToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date());
}
function presetRange(preset: string, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (preset) {
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: iso(new Date(Date.UTC(y, m, 0))) };
    case '3m':
      return { from: iso(new Date(Date.UTC(y, m - 3, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
    case 'ytd':
      return { from: `${y}-01-01`, to: today };
    case 'lastyear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default:
      return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
}

function PlainTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className={dash.tooltipPlain}>
      <div style={{ marginBottom: 2 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: <b>{p.value}</b>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const lookups = useLookups();
  const today = ppToday();
  const preset = params.get('period') ?? 'year';
  const fromP = params.get('from');
  const toP = params.get('to');
  const range = useMemo(
    () =>
      preset === 'custom'
        ? { from: fromP ?? `${today.slice(0, 4)}-01-01`, to: toP ?? today }
        : presetRange(preset, today),
    [preset, fromP, toP, today],
  );
  const modeKey = (params.get('mode') ?? '') as ModeKey;
  const clientKey = params.getAll('clientId').join(',');
  const direction = params.get('direction') || undefined;
  // Stable object so TanStack Query keys only change when a filter really changes.
  const filters: AnalyticsFilters = useMemo(
    () => ({
      ...range,
      clientId: clientKey ? clientKey.split(',') : [],
      direction,
      transportMode: MODES[modeKey]?.mode,
      loadType: MODES[modeKey]?.load,
    }),
    [range, clientKey, direction, modeKey],
  );

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === 'period' && v === 'custom') {
      next.set('from', range.from);
      next.set('to', range.to);
    }
    setParams(next, { replace: true });
  };

  const kpis = useKpis(filters);
  const monthly = useMonthlyVolume(filters);
  const share = useTransportShare(filters);
  const clearance = useClearanceStatus(filters);
  const [countryFlow, setCountryFlow] = useState<'import' | 'export'>('import');
  const countries = useByCountry(filters, countryFlow);
  const fwd = useForwarders(filters);
  const ports = usePorts(filters);
  const accounts = useAccounts(filters);

  const k = kpis.data;
  const kpiCards = k
    ? [
        {
          label: 'Total Shipments',
          val: k.total,
          prev: k.previous.total,
          pct: 100,
          color: 'var(--accent-primary)',
        },
        {
          label: 'Import Shipments',
          val: k.imports,
          prev: k.previous.imports,
          pct: k.total ? (k.imports / k.total) * 100 : 0,
          color: 'var(--accent-cyan)',
        },
        {
          label: 'Export Shipments',
          val: k.exports,
          prev: k.previous.exports,
          pct: k.total ? (k.exports / k.total) * 100 : 0,
          color: 'var(--accent-blue)',
        },
        {
          label: 'Customs Cleared',
          val: k.cleared,
          prev: k.previous.cleared,
          pct: k.total ? (k.cleared / k.total) * 100 : 0,
          color: 'var(--accent-emerald)',
          note: `${k.clearancePending} still pending`,
        },
      ]
    : [];
  const monthlyData = (monthly.data ?? []).map((m) => ({
    ...m,
    label:
      monthly.data!.length > 12
        ? `${monthLabel(m.month)} ${m.month.slice(2, 4)}`
        : monthLabel(m.month),
  }));
  const shareData = share.data
    ? [
        { name: 'Import', value: share.data.imports, color: 'var(--accent-cyan)' },
        { name: 'Export', value: share.data.exports, color: 'var(--accent-blue)' },
      ]
    : [];
  const clearTotal = (clearance.data ?? []).reduce((s, r) => s + r.count, 0);
  const periodLabel = `${range.from} → ${range.to}`;

  return (
    <section className="view active" id="view-analytics">
      <div className="an-head-row">
        <div>
          <h1>Analytics — Full Operations Breakdown</h1>
          <div className="an-sub">
            Every figure is calculated from the shipments in the database for the filters below (by
            ETA month).
          </div>
        </div>
        <div className={dash.filters} role="group" aria-label="Analytics filters">
          <select
            className={dash.filterInput}
            value={preset}
            onChange={(e) => set('period', e.target.value)}
            aria-label="Period"
          >
            <option value="month">This month</option>
            <option value="3m">Last 3 months</option>
            <option value="ytd">Year to date ({today.slice(0, 4)})</option>
            <option value="year">Full year {today.slice(0, 4)}</option>
            <option value="lastyear">{Number(today.slice(0, 4)) - 1}</option>
            <option value="custom">Custom dates…</option>
          </select>
          {preset === 'custom' && (
            <>
              <input
                type="date"
                className={dash.filterInput}
                value={range.from}
                max={range.to}
                onChange={(e) => set('from', e.target.value)}
                aria-label="From"
              />
              <input
                type="date"
                className={dash.filterInput}
                value={range.to}
                min={range.from}
                onChange={(e) => set('to', e.target.value)}
                aria-label="To"
              />
            </>
          )}
          <select
            className={dash.filterInput}
            value={params.get('clientId') ?? ''}
            onChange={(e) => set('clientId', e.target.value)}
            aria-label="Client"
          >
            <option value="">All clients</option>
            {lookups.data?.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
          <select
            className={dash.filterInput}
            value={params.get('direction') ?? ''}
            onChange={(e) => set('direction', e.target.value)}
            aria-label="Import or export"
          >
            <option value="">Import &amp; export</option>
            <option value="IMPORT">Import only</option>
            <option value="EXPORT">Export only</option>
          </select>
          <select
            className={dash.filterInput}
            value={modeKey}
            onChange={(e) => set('mode', e.target.value)}
            aria-label="Transport mode"
          >
            {Object.entries(MODES).map(([key, m]) => (
              <option key={key} value={key}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="an-kpi-row">
        {kpis.isLoading &&
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="an-kpi-card" style={{ minHeight: 110 }} />
          ))}
        {kpiCards.map((c) => {
          const ch = changePct(c.val, c.prev);
          return (
            <div className="an-kpi-card" key={c.label}>
              <div className="an-kpi-top">
                <span className="an-kpi-label">{c.label}</span>
                <span className="an-kpi-dot" style={{ background: c.color }} />
              </div>
              <div className="an-kpi-val">{c.val.toLocaleString()}</div>
              <div className="an-kpi-meta">
                <span
                  className="meta-positive"
                  style={ch && !ch.up ? { color: 'var(--accent-rose)' } : undefined}
                >
                  {c.note ??
                    (ch ? `${ch.text} vs previous period` : 'No data in the previous period')}
                </span>
              </div>
              <div className="an-mini-bar-track">
                <div
                  className="an-mini-bar-fill"
                  style={{ width: `${c.pct}%`, background: c.color }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="an-section-title-row">
          <div>
            <h3>Monthly Shipment Volume — Import vs Export</h3>
            <div className="an-section-sub">
              Shipments per ETA month, split by flow direction. {periodLabel}
            </div>
          </div>
        </div>
        <ChartState
          loading={monthly.isLoading}
          error={monthly.error}
          empty={!monthlyData.some((m) => m.total)}
          height={240}
        >
          <ResponsiveContainer width="100%" height={250}>
            <BarChart
              data={monthlyData}
              barGap={3}
              margin={{ top: 10, right: 8, bottom: 0, left: -16 }}
            >
              <CartesianGrid vertical={false} stroke="var(--border-subtle)" strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: 'var(--border-subtle)' }}
                tick={{ fontSize: 11, fontWeight: 700, fill: 'var(--text-tertiary)' }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fontWeight: 700, fill: 'var(--text-tertiary)' }}
              />
              <Tooltip content={<PlainTooltip />} cursor={{ fill: 'var(--bg-subtle)' }} />
              <Legend
                iconType="square"
                wrapperStyle={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}
              />
              <Bar
                dataKey="imports"
                name="Import"
                fill="var(--accent-primary)"
                radius={[4, 4, 0, 0]}
                maxBarSize={22}
              />
              <Bar
                dataKey="exports"
                name="Export"
                fill="var(--accent-blue)"
                radius={[4, 4, 0, 0]}
                maxBarSize={22}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartState>
      </div>

      <div className="an-grid-2col">
        <div className="card">
          <div className="an-section-title-row">
            <div>
              <h3>Import vs Export Share</h3>
              <div className="an-section-sub">
                Share of shipments in the selected period by flow direction.
              </div>
            </div>
          </div>
          <ChartState
            loading={share.isLoading}
            error={share.error}
            empty={!share.data?.total}
            height={150}
          >
            <div className="an-donut-wrap">
              <div style={{ position: 'relative', width: 132, height: 132, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={shareData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={66}
                      startAngle={90}
                      endAngle={-270}
                      stroke="none"
                    >
                      {shareData.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<PlainTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    placeItems: 'center',
                    pointerEvents: 'none',
                  }}
                >
                  <div className="an-donut-center">
                    <div className="val">{share.data?.total.toLocaleString()}</div>
                    <div className="lbl">Total</div>
                  </div>
                </div>
              </div>
              <div className="an-donut-legend">
                {shareData.map((d) => (
                  <div className="an-donut-legend-row" key={d.name}>
                    <span className="an-donut-legend-name">
                      <span className="an-donut-legend-dot" style={{ background: d.color }} />
                      {d.name}
                    </span>
                    <span className="an-donut-legend-val">
                      {d.value.toLocaleString()} ·{' '}
                      {share.data?.total ? ((d.value / share.data.total) * 100).toFixed(1) : 0}%
                    </span>
                  </div>
                ))}
                {share.data?.byMode.map((m) => (
                  <div className="an-donut-legend-row" key={m.mode} style={{ opacity: 0.8 }}>
                    <span className="an-donut-legend-name">{m.mode}</span>
                    <span className="an-donut-legend-val">{m.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </ChartState>
        </div>
        <div className="card">
          <div className="an-section-title-row">
            <div>
              <h3>Customs Clearance Status</h3>
              <div className="an-section-sub">Clearance stage of every shipment in the period.</div>
            </div>
          </div>
          <ChartState
            loading={clearance.isLoading}
            error={clearance.error}
            empty={!clearTotal}
            height={150}
          >
            <HBarList
              rows={(clearance.data ?? []).map((r) => ({
                key: r.status,
                name: CLEARANCE_STATUS_LABEL[r.status],
                value: r.count,
                max: clearTotal,
                color: CLEARANCE_COLOR[r.status],
                display: `${r.count.toLocaleString()} · ${((r.count / clearTotal) * 100).toFixed(1)}%`,
              }))}
            />
          </ChartState>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="an-section-title-row">
          <div>
            <h3>Shipments by {countryFlow === 'import' ? 'Origin' : 'Destination'} Country</h3>
            <div className="an-section-sub">
              Imports by country of origin, exports by destination country.
            </div>
          </div>
          <div className="an-seg-control" role="tablist">
            {(['import', 'export'] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={countryFlow === f}
                className={`an-seg-btn${countryFlow === f ? ' active' : ''}`}
                onClick={() => setCountryFlow(f)}
              >
                {f === 'import' ? 'Import' : 'Export'}
              </button>
            ))}
          </div>
        </div>
        <ChartState
          loading={countries.isLoading}
          error={countries.error}
          empty={!countries.data?.length}
          height={120}
        >
          <HBarList
            rows={(countries.data ?? []).map((c) => ({
              key: c.iso2,
              name: c.name,
              value: c.count,
              display: `${c.count} · ${c.pct}%`,
            }))}
          />
        </ChartState>
      </div>

      <div className="an-grid-2col-rev">
        <div className="card">
          <div className="an-section-title-row">
            <div>
              <h3>Forwarder Performance Ranking</h3>
              <div className="an-section-sub">
                Ranked by shipments; on-time = arrived on or before ETA.
              </div>
            </div>
          </div>
          <ChartState
            loading={fwd.isLoading}
            error={fwd.error}
            empty={!fwd.data?.length}
            height={150}
          >
            <HBarList
              rows={(fwd.data ?? []).map((f) => ({
                key: f.id,
                name: f.name,
                value: f.shipments,
                display: `${f.shipments} shipments · ${f.onTimePct === null ? 'no arrivals yet' : `${f.onTimePct}% on time`}${f.avgDelayDays ? ` · ${f.avgDelayDays}d avg delay` : ''}`,
                color:
                  f.onTimePct === null
                    ? 'var(--text-tertiary)'
                    : f.onTimePct >= 85
                      ? 'var(--accent-emerald)'
                      : f.onTimePct >= 70
                        ? 'var(--accent-amber)'
                        : 'var(--accent-rose)',
              }))}
            />
          </ChartState>
        </div>
        <div className="card">
          <div className="an-section-title-row">
            <div>
              <h3>Port of Discharge — Import vs Export</h3>
              <div className="an-section-sub">
                Shipment volume per clearance port, compared across both flows.
              </div>
            </div>
          </div>
          <ChartState
            loading={ports.isLoading}
            error={ports.error}
            empty={!ports.data?.length}
            height={230}
          >
            <ResponsiveContainer width="100%" height={250}>
              <BarChart
                data={ports.data ?? []}
                barGap={3}
                margin={{ top: 10, right: 8, bottom: 0, left: -16 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border-subtle)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="shortName"
                  tickLine={false}
                  interval={0}
                  axisLine={{ stroke: 'var(--border-subtle)' }}
                  tick={{ fontSize: 10, fontWeight: 700, fill: 'var(--text-tertiary)' }}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fontWeight: 700, fill: 'var(--text-tertiary)' }}
                />
                <Tooltip content={<PlainTooltip />} cursor={{ fill: 'var(--bg-subtle)' }} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
                <Bar
                  dataKey="imports"
                  name="Import"
                  fill="var(--accent-primary)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={22}
                />
                <Bar
                  dataKey="exports"
                  name="Export"
                  fill="var(--accent-blue)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={22}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartState>
        </div>
      </div>

      <div className="card">
        <div className="an-section-title-row">
          <div>
            <h3>Key Logistics Accounts — Full Breakdown</h3>
            <div className="an-section-sub">
              Every account, every flow and every shipment type in one table.
            </div>
          </div>
        </div>
        <div className="an-table-wrap">
          <ChartState
            loading={accounts.isLoading}
            error={accounts.error}
            empty={!accounts.data?.length}
            height={120}
          >
            <table className="an-detail-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th className="center">Total</th>
                  <th className="center">Import Total</th>
                  <th className="center">Export Total</th>
                  <th className="center">CY / CY</th>
                  <th className="center">LCL</th>
                  <th className="center">AIR</th>
                </tr>
              </thead>
              <tbody>
                {accounts.data?.map((a) => (
                  <tr key={a.clientId}>
                    <td className="an-client-name">
                      <Link to={`/clients/${a.clientId}`}>{a.name}</Link>
                    </td>
                    <td className="center">{a.all.total}</td>
                    <td className="center">{a.import.total}</td>
                    <td className="center">{a.export.total}</td>
                    <td className="center">{a.all.cy}</td>
                    <td className="center">{a.all.lcl}</td>
                    <td className="center">{a.all.air}</td>
                  </tr>
                ))}
                {accounts.data && accounts.data.length > 1 && (
                  <tr style={{ fontWeight: 800 }}>
                    <td className="an-client-name">All clients</td>
                    {(['total', 'import', 'export', 'cy', 'lcl', 'air'] as const).map((c) => (
                      <td className="center" key={c}>
                        {accounts.data!.reduce(
                          (s, a) =>
                            s +
                            (c === 'import'
                              ? a.import.total
                              : c === 'export'
                                ? a.export.total
                                : a.all[c]),
                          0,
                        )}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </ChartState>
        </div>
      </div>
    </section>
  );
}
