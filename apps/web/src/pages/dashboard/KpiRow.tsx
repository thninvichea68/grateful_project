import { useId, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { KpiResponse, MonthlyVolumeRow } from '@gs/shared';
import { changePct, monthLabel } from './parts';
import s from './KpiRow.module.css';

const svg = (children: ReactNode, size = 18, width = 1.8) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);
const ICONS = {
  arrow: svg(<path d="M7 17 17 7M8 7h9v9" />, 14, 2.6),
  box: svg(
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.3 7 12 12l8.7-5M12 22V12" />
    </>,
  ),
  import: svg(
    <path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />,
  ),
  export: svg(
    <path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />,
  ),
  shield: svg(
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </>,
  ),
};

type Tone = 'cyan' | 'sky' | 'blue' | 'emerald';

function Card({
  tone,
  icon,
  label,
  value,
  meta,
  chart,
  onOpen,
}: {
  tone: Tone;
  icon: ReactNode;
  label: string;
  value: number;
  meta: ReactNode;
  chart: ReactNode;
  onOpen: () => void;
}) {
  return (
    <div className={s.card} data-tone={tone}>
      <div className={s.top}>
        <span className={s.chip}>{icon}</span>
        <span className={s.label}>{label}</span>
        <button type="button" className={s.open} aria-label={`View ${label}`} onClick={onOpen}>
          {ICONS.arrow}
        </button>
      </div>
      <div className={s.body}>
        <div className={s.figures}>
          <div className={s.value}>{value.toLocaleString()}</div>
          <div className={s.meta}>{meta}</div>
        </div>
        <div className={s.chart}>{chart}</div>
      </div>
    </div>
  );
}

/** "↗ 22.2%" pill plus "vs last month", or a note when last month had nothing. */
function Change({ value, prev }: { value: number; prev: number }) {
  const ch = changePct(value, prev);
  if (!ch) return <span className={s.sub}>no data last month</span>;
  return (
    <>
      <span className={s.delta} data-up={ch.up}>
        {ch.text}
      </span>
      <span className={s.sub}>vs last month</span>
    </>
  );
}

/** Mini column chart of the last months; the current month is solid. */
function Bars({ rows }: { rows: { month: string; v: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className={s.bars} aria-hidden="true">
      {rows.map((r, i) => (
        <span
          key={r.month}
          data-now={i === rows.length - 1 || undefined}
          style={{ '--h': `${Math.max(6, (r.v / max) * 100)}%` } as CSSProperties}
          title={`${monthLabel(r.month)}: ${r.v}`}
        />
      ))}
    </div>
  );
}

/** Gradient-filled sparkline in the card's colour. */
function Spark({ rows, color }: { rows: { month: string; v: number }[]; color: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 4, right: 3, bottom: 2, left: 3 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {monthTip}
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${id})`}
          isAnimationActive={false}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0, fill: color }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** This month vs last month as two horizontal bars, labelled with month and count. */
function Compare({ rows }: { rows: { month: string; v: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className={s.compare}>
      {rows.map((r, i) => (
        <div key={r.month} className={s.compareRow} data-now={i === rows.length - 1 || undefined}>
          <span className={s.compareLabel}>{monthLabel(r.month)}</span>
          <span className={s.compareTrack}>
            <span style={{ width: `${Math.max(4, (r.v / max) * 100)}%` }} />
          </span>
          <span className={s.compareVal}>{r.v}</span>
        </div>
      ))}
    </div>
  );
}

const monthTip = (
  <Tooltip
    cursor={false}
    content={({ active, payload }) =>
      active && payload?.[0] ? (
        <div className={s.tip}>
          {monthLabel(payload[0].payload.month)}: <b>{payload[0].value}</b>
        </div>
      ) : null
    }
  />
);

/** Ring showing the share of this month's shipments already cleared. */
function Ring({ rate }: { rate: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className={s.ring} role="img" aria-label={`${rate}% cleared`}>
      <svg viewBox="0 0 56 56">
        <circle className={s.ringTrack} cx="28" cy="28" r={r} />
        <circle
          className={s.ringFill}
          cx="28"
          cy="28"
          r={r}
          strokeDasharray={`${(rate / 100) * c} ${c}`}
          transform="rotate(-90 28 28)"
        />
      </svg>
      <span className={s.ringText}>
        {rate}
        <small>%</small>
      </span>
    </div>
  );
}

export function KpiRow({ k, monthly }: { k: KpiResponse; monthly: MonthlyVolumeRow[] }) {
  const navigate = useNavigate();
  const toPlans = (q: string) => navigate(`/plans?${q}`);
  // The last six months up to the one shown (the year's months come zero-filled).
  const upTo = k.period.from.slice(0, 7);
  const recent = monthly.filter((m) => m.month <= upTo).slice(-6);
  const series = (key: 'total' | 'imports' | 'exports') =>
    recent.map((m) => ({ month: m.month, v: m[key] }));
  const clearTotal = k.cleared + k.clearancePending;
  const rate = clearTotal ? Math.round((k.cleared / clearTotal) * 100) : 0;

  return (
    <div className={s.row}>
      <Card
        tone="cyan"
        icon={ICONS.box}
        label="Total Shipments This Month"
        value={k.total}
        meta={<Change value={k.total} prev={k.previous.total} />}
        chart={recent.length > 1 && <Bars rows={series('total')} />}
        onOpen={() => toPlans('sort=-eta')}
      />
      <Card
        tone="sky"
        icon={ICONS.import}
        label="Import Shipments"
        value={k.imports}
        meta={<Change value={k.imports} prev={k.previous.imports} />}
        chart={recent.length > 1 && <Spark rows={series('imports')} color="#22d3ee" />}
        onOpen={() => toPlans('direction=IMPORT')}
      />
      <Card
        tone="blue"
        icon={ICONS.export}
        label="Export Shipments"
        value={k.exports}
        meta={<Change value={k.exports} prev={k.previous.exports} />}
        chart={
          <Compare
            rows={[
              { month: k.previousPeriod.from.slice(0, 7), v: k.previous.exports },
              { month: upTo, v: k.exports },
            ]}
          />
        }
        onOpen={() => toPlans('direction=EXPORT')}
      />
      <Card
        tone="emerald"
        icon={ICONS.shield}
        label="Customs Cleared"
        value={k.cleared}
        meta={
          <>
            <span className={s.delta} data-warn={k.clearancePending > 0}>
              {k.clearancePending}
            </span>
            <span className={s.sub}>still pending</span>
          </>
        }
        chart={<Ring rate={rate} />}
        onOpen={() => toPlans('status=IN_PROGRESS')}
      />
    </div>
  );
}

/** Placeholder row while the summary loads. */
export function KpiRowSkeleton() {
  return (
    <div className={s.row} aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`${s.card} ${s.skeleton}`} />
      ))}
    </div>
  );
}
