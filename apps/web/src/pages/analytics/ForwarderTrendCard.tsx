import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import type { ForwarderMonthRow, ForwarderRow } from '@gs/shared';
import { ChartState } from '../dashboard/parts';
import s from './ForwarderTrendCard.module.css';

/*
 * Analytics → Most Common Forwarders: the 5 busiest forwarders as lines, shipments month by
 * month through the period. Hovering a legend chip spotlights that forwarder's line.
 */

const COLORS = ['#06B6D4', '#2563EB', '#F59E0B', '#8B5CF6', '#F43F5E'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

interface Series {
  code: string;
  total: number;
  color: string;
}

function LinesTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const items = [...payload].sort((a, b) => Number(b.value) - Number(a.value));
  return (
    <div className={s.tip}>
      <b>{monthLabel(String(label))}</b>
      {items.map((p) => (
        <span key={String(p.dataKey)}>
          <i style={{ background: p.color }} />
          {p.dataKey}
          <b>{Number(p.value).toLocaleString()}</b>
        </span>
      ))}
    </div>
  );
}

export function ForwarderTrendCard({
  monthly,
  rows,
  loading,
  error,
}: {
  monthly: ForwarderMonthRow[] | undefined;
  /** Every forwarder's totals, for the share of all shipments. */
  rows: ForwarderRow[] | undefined;
  loading: boolean;
  error: unknown;
}) {
  const [focus, setFocus] = useState<string | null>(null);

  const { data, series } = useMemo(() => {
    const byMonth = new Map<string, Record<string, number | string>>();
    const totals = new Map<string, number>();
    for (const r of monthly ?? []) {
      const m = byMonth.get(r.month) ?? { month: r.month };
      m[r.code] = r.shipments;
      byMonth.set(r.month, m);
      totals.set(r.code, (totals.get(r.code) ?? 0) + r.shipments);
    }
    // Rows arrive busiest forwarder first, so the colours follow the ranking.
    const series: Series[] = [...totals].map(([code, total], i) => ({
      code,
      total,
      color: COLORS[i % COLORS.length]!,
    }));
    return { data: [...byMonth.values()], series };
  }, [monthly]);

  const all = (rows ?? []).reduce((t, f) => t + f.shipments, 0);
  const topShare = all ? Math.round((series.reduce((t, f) => t + f.total, 0) / all) * 100) : 0;

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="an-section-title-row">
        <div>
          <h3>Most Common Forwarders</h3>
          <div className="an-section-sub">
            Shipments month by month for the {series.length || 5} forwarders handling the most in
            the period.
          </div>
        </div>
        {all > 0 && series.length > 0 && (
          <span className={s.pill}>
            Top {series.length} carry {topShare}% of {all.toLocaleString()} shipments
          </span>
        )}
      </div>
      <ChartState loading={loading} error={error} empty={!series.length} height={300}>
        <ul className={s.legend}>
          {series.map((f) => (
            <li key={f.code}>
              <button
                type="button"
                data-dim={(focus && focus !== f.code) || undefined}
                onMouseEnter={() => setFocus(f.code)}
                onMouseLeave={() => setFocus(null)}
                onFocus={() => setFocus(f.code)}
                onBlur={() => setFocus(null)}
              >
                <i style={{ background: f.color }} />
                {f.code}
                <b>{f.total.toLocaleString()}</b>
                {all > 0 && <small>{Math.round((f.total / all) * 100)}%</small>}
              </button>
            </li>
          ))}
        </ul>
        <div className={s.chart}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} stroke="var(--border-subtle)" strokeDasharray="4 4" />
              <XAxis
                dataKey="month"
                tickFormatter={monthLabel}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                dy={6}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
                width={44}
              />
              <Tooltip
                content={<LinesTooltip />}
                cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '4 4' }}
              />
              {series.map((f) => (
                <Line
                  key={f.code}
                  dataKey={f.code}
                  type="monotone"
                  stroke={f.color}
                  strokeWidth={focus === f.code ? 3 : 2}
                  strokeOpacity={!focus || focus === f.code ? 1 : 0.15}
                  dot={{ r: 3, strokeWidth: 0, fill: f.color }}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--bg-surface)' }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartState>
    </div>
  );
}
