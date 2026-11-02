import { useSearchParams, Link } from 'react-router-dom';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  ClientHealth,
  InsightMetric,
  InsightRecommendation,
  InsightsResponse,
} from '@gs/shared';
import { useInsights } from '../../features/analytics';
import { useLookups } from '../../features/hooks';
import { ui } from '../../components/ui';
import { fmtDate } from '../../lib/format';
import { monthLabel } from '../dashboard/parts';
import s from './Insights.module.css';

/** Today in Phnom Penh as YYYY-MM-DD. */
const ppToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date());
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Period presets, each compared with the same length of time just before it. */
const PRESETS = {
  '3m': 'Last 3 months',
  '6m': 'Last 6 months',
  '12m': 'Last 12 months',
  ytd: 'This year',
} as const;
type Preset = keyof typeof PRESETS;
function rangeOf(p: Preset, today: string) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  if (p === 'ytd') return { from: `${y}-01-01`, to: today };
  const back = { '3m': 3, '6m': 6, '12m': 12 }[p];
  return { from: iso(new Date(Date.UTC(y, m - back, 1))), to: today };
}

const n1 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 });
const usd = (v: number | string) =>
  `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const HEALTH: Record<ClientHealth, string> = {
  NEW: 'New',
  GROWING: 'Growing',
  STABLE: 'Stable',
  DECLINING: 'Declining',
  AT_RISK: 'At risk',
};

/**
 * Business Insights: what to act on first, then how the service and the business are doing
 * against the period before, which clients and partners drive it, and how the team is loaded.
 */
export function InsightsPage() {
  const [params, setParams] = useSearchParams();
  const lookups = useLookups();
  const preset = (params.get('p') as Preset | null) ?? '12m';
  const clientId = params.get('clientId') ?? '';
  const range = rangeOf(preset in PRESETS ? preset : '12m', ppToday());
  const q = useInsights({ ...range, clientId: clientId ? [clientId] : undefined });
  const d = q.data;
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <section className="view active">
      <div className={s.top}>
        <div className={s.segment} role="group" aria-label="Period">
          {(Object.keys(PRESETS) as Preset[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={preset === p}
              onClick={() => set('p', p === '12m' ? '' : p)}
            >
              {PRESETS[p]}
            </button>
          ))}
        </div>
        <select
          className={ui.input}
          value={clientId}
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
        {d && (
          <span className={s.compare}>
            {fmtDate(d.period.from)} – {fmtDate(d.period.to)}
            <span>vs</span>
            {fmtDate(d.previous.from)} – {fmtDate(d.previous.to)}
          </span>
        )}
      </div>

      {q.isLoading && <div className="card">Working out the figures…</div>}
      {q.error && <div className="card">The insights could not be loaded.</div>}
      {d && (
        <div className={s.stack}>
          <Actions list={d.recommendations} />
          <Scorecard d={d} />
          <Trends d={d} />
          <Clients d={d} />
          <div className={s.two}>
            <Forwarders d={d} />
            <Ports d={d} />
          </div>
          <Team d={d} />
        </div>
      )}
    </section>
  );
}

/* ---------------- What to act on ---------------- */
function Actions({ list }: { list: InsightRecommendation[] }) {
  const counts = {
    high: list.filter((r) => r.severity === 'high').length,
    medium: list.filter((r) => r.severity === 'medium').length,
  };
  return (
    <div className="card">
      <div className={s.head}>
        <h3>What to act on</h3>
        <span className={s.counts}>
          {counts.high > 0 && <b data-tone="high">{counts.high} urgent</b>}
          {counts.medium > 0 && <b data-tone="medium">{counts.medium} to review</b>}
        </span>
      </div>
      {list.length === 0 ? (
        <p className={s.empty}>Nothing needs attention for this period.</p>
      ) : (
        <ul className={s.cards}>
          {list.map((r, i) => (
            <li key={i} className={s.card} data-severity={r.severity}>
              <div className={s.cardTop}>
                <span className={s.area}>{r.area}</span>
                <span className={s.sev}>
                  {r.severity === 'high'
                    ? 'Urgent'
                    : r.severity === 'medium'
                      ? 'Review'
                      : 'Going well'}
                </span>
              </div>
              <b className={s.cardTitle}>{r.title}</b>
              <span className={s.detail}>{r.detail}</span>
              <div className={s.cardDo}>
                <span className={s.doLabel}>Do</span>
                <span>{r.action}</span>
              </div>
              {r.link && (
                <Link to={r.link} className={s.open}>
                  Open →
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- Scorecard ---------------- */
function Delta({ m, unit }: { m: InsightMetric; unit: 'pct' | 'pts' | 'days' }) {
  if (m.value === null) return <span className={s.delta}>No data</span>;
  if (m.previous === null || m.previous === 0)
    return <span className={s.delta}>No earlier data</span>;
  const diff = m.value - m.previous;
  if (Math.abs(diff) < 0.05) return <span className={s.delta}>No change</span>;
  const good = m.better === 'up' ? diff > 0 : diff < 0;
  // From a small base a percentage runs away ("2633%"): say how many times as much instead.
  const times = m.previous > 0 ? m.value / m.previous : 0;
  const text =
    unit === 'pct' && times >= 4
      ? `×${n1(times)}`
      : unit === 'pct'
        ? `${n1(Math.abs((diff / Math.abs(m.previous)) * 100))}%`
        : unit === 'pts'
          ? `${n1(Math.abs(diff))} pts`
          : `${n1(Math.abs(diff))} days`;
  return (
    <span className={s.delta} data-good={good}>
      {diff > 0 ? '▲' : '▼'} {text} <small>vs before</small>
    </span>
  );
}
function Kpi({
  label,
  value,
  m,
  unit,
  hint,
}: {
  label: string;
  value: string;
  m: InsightMetric;
  unit: 'pct' | 'pts' | 'days';
  hint: string;
}) {
  return (
    <div className={s.kpi} title={hint}>
      <span className={s.kpiLabel}>{label}</span>
      <b className={s.kpiValue}>{m.value === null ? '–' : value}</b>
      <Delta m={m} unit={unit} />
    </div>
  );
}
function Scorecard({ d }: { d: InsightsResponse }) {
  const c = d.scorecard;
  const v = (m: InsightMetric, suffix = '') => (m.value === null ? '–' : `${n1(m.value)}${suffix}`);
  return (
    <div className={s.scorecard}>
      <div className={s.group}>
        <h4>Service</h4>
        <div className={s.kpis}>
          <Kpi
            label="Shipments"
            value={v(c.shipments)}
            m={c.shipments}
            unit="pct"
            hint="Shipments in the period, by clearance date"
          />
          <Kpi
            label="Arrival → declared"
            value={v(c.clearanceDays, ' days')}
            m={c.clearanceDays}
            unit="days"
            hint="Imports: days from arrival (ATA, else ETA) to the first declare date. 0 = declared on or before arrival"
          />
          <Kpi
            label="Cleared → factory"
            value={v(c.deliveryDays, ' days')}
            m={c.deliveryDays}
            unit="days"
            hint="Imports: days from clearance to arrival at the factory"
          />
          <Kpi
            label="Delivered ≤ 2 days"
            value={v(c.onTimeDeliveryPct, '%')}
            m={c.onTimeDeliveryPct}
            unit="pts"
            hint="Imports delivered to the factory within 2 days of clearance"
          />
          <Kpi
            label="Customs exceptions"
            value={v(c.exceptionPct, '%')}
            m={c.exceptionPct}
            unit="pts"
            hint="Share of shipments with a customs exception"
          />
          <Kpi
            label="Follow-ups on time"
            value={v(c.followUpOnTimePct, '%')}
            m={c.followUpOnTimePct}
            unit="pts"
            hint="Follow-ups closed by hand in the period before their due time"
          />
        </div>
      </div>
      {d.money && c.netProfit && c.marginPct && c.profitPerDeclaration && (
        <div className={s.group}>
          <h4>Business</h4>
          <div className={s.kpis} style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <Kpi
              label="Net profit"
              value={usd(c.netProfit.value ?? 0)}
              m={c.netProfit}
              unit="pct"
              hint="Billed ledger rows, by invoice date"
            />
            <Kpi
              label="Margin"
              value={v(c.marginPct, '%')}
              m={c.marginPct}
              unit="pts"
              hint="Net profit ÷ income (INV + DIS + DN)"
            />
            <Kpi
              label="Profit / declaration"
              value={
                c.profitPerDeclaration.value === null ? '–' : usd(c.profitPerDeclaration.value)
              }
              m={c.profitPerDeclaration}
              unit="pct"
              hint="Net profit ÷ declarations billed"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Trends ---------------- */
function Trends({ d }: { d: InsightsResponse }) {
  const data = d.trend.map((t) => ({
    month: monthLabel(t.month),
    Shipments: t.shipments,
    'Cleared → factory (days)': t.deliveryDays,
    'Arrival → declared (days)': t.clearanceDays,
    'Net profit': t.netProfit === undefined ? undefined : Number(t.netProfit),
  }));
  const axis = { fontSize: 11, fill: 'var(--text-tertiary)' };
  return (
    <div className={s.two}>
      <div className="card">
        <div className={s.head}>
          <h3>Volume and service time</h3>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
            <YAxis
              yAxisId="n"
              tick={axis}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <YAxis yAxisId="d" orientation="right" tick={axis} axisLine={false} tickLine={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar
              yAxisId="n"
              dataKey="Shipments"
              fill="var(--accent-primary)"
              opacity={0.35}
              radius={[4, 4, 0, 0]}
            />
            <Line
              yAxisId="d"
              dataKey="Cleared → factory (days)"
              stroke="var(--status-pending-fg)"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <Line
              yAxisId="d"
              dataKey="Arrival → declared (days)"
              stroke="var(--status-exception-fg)"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {d.money && (
        <div className="card">
          <div className={s.head}>
            <h3>Net profit by month</h3>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
              <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
              <YAxis
                tick={axis}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
              />
              <Tooltip formatter={(v) => usd(Number(v))} />
              <Bar dataKey="Net profit" fill="var(--status-completed-fg)" radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/* ---------------- Clients ---------------- */
function Clients({ d }: { d: InsightsResponse }) {
  const c = d.concentration;
  return (
    <div className="card">
      <div className={s.head}>
        <h3>Client portfolio</h3>
        {c.topCode && (
          <span
            className={s.conc}
            data-warn={c.topPct >= 40}
            title={`Share of ${c.by} from the top client and the top 3`}
          >
            Top client {c.topCode} <b>{n1(c.topPct)}%</b> · Top 3 <b>{n1(c.top3Pct)}%</b> of {c.by}
          </span>
        )}
      </div>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Client</th>
              <th>Health</th>
              <th className={s.r}>Shipments</th>
              <th className={s.r}>Change</th>
              <th className={s.r}>Last shipment</th>
              {d.money && (
                <>
                  <th className={s.r}>Income</th>
                  <th className={s.r}>Net profit</th>
                  <th className={s.r}>Margin</th>
                  <th className={s.r}>Profit / decl.</th>
                  <th>Share of profit</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {d.clients.map((x) => (
              <tr key={x.clientId}>
                <td>
                  <Link to={`/clients/${x.clientId}`} className={s.client} title={x.name}>
                    {x.code}
                  </Link>
                  <span className={s.clientName}>{x.name}</span>
                </td>
                <td>
                  <span className={s.health} data-health={x.health}>
                    {HEALTH[x.health]}
                  </span>
                </td>
                <td className={s.r}>
                  {x.shipments}
                  <small className={s.prev}> / {x.prevShipments}</small>
                </td>
                <td className={s.r}>
                  {x.growthPct === null ? (
                    <span className={s.muted}>–</span>
                  ) : (
                    <span data-good={x.growthPct >= 0} className={s.growth}>
                      {x.growthPct > 0 ? '+' : ''}
                      {x.growthPct}%
                    </span>
                  )}
                </td>
                <td
                  className={s.r}
                  title={x.usualGapDays ? `Usually every ${x.usualGapDays} days` : undefined}
                >
                  {x.daysSinceLast === null ? '–' : `${x.daysSinceLast} days ago`}
                </td>
                {d.money && (
                  <>
                    <td className={s.r}>{usd(x.revenue ?? 0)}</td>
                    <td className={s.r} data-neg={Number(x.netProfit) < 0}>
                      <b>{usd(x.netProfit ?? 0)}</b>
                    </td>
                    <td className={s.r}>{x.marginPct === null ? '–' : `${n1(x.marginPct!)}%`}</td>
                    <td className={s.r}>
                      {x.profitPerDeclaration ? usd(x.profitPerDeclaration) : '–'}
                    </td>
                    <td>
                      <span className={s.bar}>
                        <i style={{ width: `${Math.max(0, x.sharePct ?? 0)}%` }} />
                      </span>
                      <span className={s.barText}>{n1(x.sharePct ?? 0)}%</span>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Partners ---------------- */
function Forwarders({ d }: { d: InsightsResponse }) {
  return (
    <div className="card">
      <div className={s.head}>
        <h3>Forwarder scorecard</h3>
      </div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Forwarder</th>
            <th
              title="On time 50%, no exceptions 30%, quick clearance 20%"
              style={{ width: '34%' }}
            >
              Score
            </th>
            <th className={s.r}>Shipments</th>
            <th className={s.r}>On time</th>
            <th className={s.r}>Avg delay</th>
          </tr>
        </thead>
        <tbody>
          {d.forwarders.map((f) => (
            <tr key={f.id}>
              <td className={s.clip}>{f.name}</td>
              <td>
                <span
                  className={s.bar}
                  data-score={f.score >= 80 ? 'good' : f.score >= 65 ? 'ok' : 'low'}
                >
                  <i style={{ width: `${f.score}%` }} />
                </span>
                <span className={s.barText}>{f.score}</span>
              </td>
              <td className={s.r}>{f.shipments}</td>
              <td className={s.r}>{f.onTimePct === null ? '–' : `${n1(f.onTimePct)}%`}</td>
              <td className={s.r}>{f.avgDelayDays === null ? '–' : `${n1(f.avgDelayDays)} d`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Ports({ d }: { d: InsightsResponse }) {
  return (
    <div className="card">
      <div className={s.head}>
        <h3>Service by port</h3>
      </div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Port</th>
            <th className={s.r}>Shipments</th>
            <th className={s.r}>Arrival → declared</th>
            <th className={s.r}>Cleared → factory</th>
            <th className={s.r}>Exceptions</th>
          </tr>
        </thead>
        <tbody>
          {d.ports.map((p) => (
            <tr key={p.code}>
              <td>
                <b>{p.code}</b> <span className={s.muted}>{p.name}</span>
              </td>
              <td className={s.r}>{p.shipments}</td>
              <td className={s.r}>{p.clearanceDays === null ? '–' : `${n1(p.clearanceDays)} d`}</td>
              <td className={s.r}>{p.deliveryDays === null ? '–' : `${n1(p.deliveryDays)} d`}</td>
              <td className={s.r}>{n1(p.exceptionPct)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Team ---------------- */
function Team({ d }: { d: InsightsResponse }) {
  const max = Math.max(1, ...d.team.map((t) => t.active));
  return (
    <div className="card">
      <div className={s.head}>
        <h3>Team workload</h3>
      </div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Staff</th>
            <th style={{ width: '36%' }}>Active shipments</th>
            <th className={s.r}>Handled in period</th>
            <th className={s.r}>Open follow-ups</th>
            <th className={s.r}>Overdue</th>
          </tr>
        </thead>
        <tbody>
          {d.team.map((t) => (
            <tr key={t.userId}>
              <td>{t.name}</td>
              <td>
                <span className={s.bar}>
                  <i style={{ width: `${(100 * t.active) / max}%` }} />
                </span>
                <span className={s.barText}>{t.active}</span>
              </td>
              <td className={s.r}>{t.handled}</td>
              <td className={s.r}>{t.openFollowUps}</td>
              <td className={s.r} data-neg={t.overdueFollowUps > 0}>
                {t.overdueFollowUps}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
