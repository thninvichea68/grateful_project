import { useMemo, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import type { AccountRow, MonthlyVolumeRow } from '@gs/shared';
import { useMonthlyVolume } from '../../features/analytics';
import { CardDropdown, MONTHS_LONG, monthLabel } from './parts';
import s from './SingleClientVolume.module.css';

const IMPORT = 'var(--accent-primary)';
const EXPORT = 'var(--accent-blue)';

type View = 'month' | 'quarter';
type Point = {
  key: string;
  label: string;
  name: string;
  imports: number;
  exports: number;
  total: number;
};

/**
 * "Shipments by Client" when the user sees one client: their year by month or quarter
 * (import and export stacked), with the totals and the figures people ask about next.
 * Monthly/Quarterly and this year/last year are chosen at the top right.
 */
export function SingleClientVolume({
  a,
  year,
  monthly,
  currentMonth,
}: {
  a: AccountRow;
  year: number;
  monthly: MonthlyVolumeRow[];
  currentMonth: string;
}) {
  const [view, setView] = useState<View>('month');
  const [shown, setShown] = useState(String(year));
  const isCurrent = shown === String(year);
  // This year comes with the Overview; another year is fetched (scoped to the user's clients).
  const other = useMonthlyVolume({ from: `${shown}-01-01`, to: `${shown}-12-31` });
  const rows = isCurrent ? monthly : (other.data ?? []);

  const points = useMemo<Point[]>(() => {
    if (view === 'month')
      return rows.map((m) => ({
        key: m.month,
        label: monthLabel(m.month).slice(0, 1),
        name: `${MONTHS_LONG[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(0, 4)}`,
        imports: m.imports,
        exports: m.exports,
        total: m.total,
      }));
    return [1, 2, 3, 4].map((q) => {
      const ms = rows.filter((m) => Math.ceil(Number(m.month.slice(5, 7)) / 3) === q);
      const imports = ms.reduce((n, m) => n + m.imports, 0);
      const exports = ms.reduce((n, m) => n + m.exports, 0);
      return {
        key: `${shown}-Q${q}`,
        label: `Q${q}`,
        name: `Q${q} ${shown}`,
        imports,
        exports,
        total: imports + exports,
      };
    });
  }, [rows, view, shown]);

  const imports = rows.reduce((n, m) => n + m.imports, 0);
  const exports = rows.reduce((n, m) => n + m.exports, 0);
  const total = imports + exports;
  const share = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  // The highlighted bar: this month / this quarter (only in the current year).
  const nowKey = !isCurrent
    ? null
    : view === 'month'
      ? currentMonth
      : `${shown}-Q${Math.ceil(Number(currentMonth.slice(5, 7)) / 3)}`;
  const now = points.find((p) => p.key === nowKey);
  // Months / quarters after the current one ("2026-11" > "2026-10", "2026-Q4" > "2026-Q3").
  const upcoming = (p: Point) => !!nowKey && p.key > nowKey;
  // Months not reached yet keep their letter on the axis but draw no bar.
  const chartData = points.map((p) => (upcoming(p) ? { ...p, imports: 0, exports: 0 } : p));
  // Average over the periods so far (all of them for a past year).
  const elapsed = nowKey ? points.findIndex((p) => p.key === nowKey) + 1 : points.length;
  const avg = elapsed ? total / elapsed : 0;
  const busiest = points
    .slice(0, elapsed)
    .reduce<Point | null>((b, p) => (p.total > (b?.total ?? 0) ? p : b), null);
  const quietest = points
    .slice(0, elapsed)
    .reduce<Point | null>((q, p) => (!q || p.total < q.total ? p : q), null);
  const unit = view === 'month' ? 'month' : 'quarter';
  const short = (p: Point) => (view === 'month' ? monthLabel(p.key) : p.label);

  return (
    <div className={`rc-card ga-revenue ${s.card}`}>
      <div className={s.head}>
        <div className={s.titles}>
          <div className="rc-title">Shipments · {a.name}</div>
          <div className="rc-subtitle">
            {view === 'month' ? 'Month by month' : 'Quarter by quarter'}, {shown}
          </div>
        </div>
        <div className={s.controls}>
          <CardDropdown
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'month', label: 'Monthly' },
              { value: 'quarter', label: 'Quarterly' },
            ]}
          />
          <CardDropdown
            label="Year"
            value={shown}
            onChange={setShown}
            options={[0, 1, 2].map((d) => ({ value: String(year - d), label: String(year - d) }))}
          />
        </div>
      </div>

      <div className={s.hero}>
        <div>
          <div className={s.total}>{total.toLocaleString()}</div>
          <div className={s.totalLabel}>shipments in {shown}</div>
        </div>
        <div className={s.legend}>
          <span>
            <i style={{ background: IMPORT }} /> Import <b>{imports}</b>
            <small>{share(imports)}%</small>
          </span>
          <span>
            <i style={{ background: EXPORT }} /> Export <b>{exports}</b>
            <small>{share(exports)}%</small>
          </span>
        </div>
      </div>

      <div
        className={s.chart}
        role="img"
        aria-label={`Shipments per ${unit} in ${shown}`}
        aria-busy={!isCurrent && other.isLoading}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
            barCategoryGap={view === 'month' ? '22%' : '30%'}
          >
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval={0}
              tick={({
                x,
                y,
                index,
                payload,
              }: {
                x: number;
                y: number;
                index: number;
                payload: { value: string };
              }) => {
                const p = points[index];
                return (
                  <text
                    x={x}
                    y={y + 10}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill={p && upcoming(p) ? 'var(--border-strong)' : 'var(--text-tertiary)'}
                  >
                    {payload.value}
                  </text>
                );
              }}
            />
            <Tooltip
              cursor={{ fill: 'var(--bg-subtle)', radius: 4 }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as Point | undefined) : undefined;
                return p ? (
                  <div className={s.tip}>
                    <b>{p.name}</b>
                    {upcoming(p) ? (
                      <span>Not available</span>
                    ) : (
                      <span>
                        Import {p.imports} · Export {p.exports}
                      </span>
                    )}
                  </div>
                ) : null;
              }}
            />
            {(['imports', 'exports'] as const).map((k) => (
              <Bar
                key={k}
                dataKey={k}
                stackId="v"
                fill={k === 'imports' ? IMPORT : EXPORT}
                radius={k === 'exports' ? [3, 3, 0, 0] : undefined}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className={s.stats}>
        {now ? (
          <div>
            <span>This {unit}</span>
            <b>{now.total}</b>
          </div>
        ) : (
          <div>
            <span>Quietest {unit}</span>
            <b>
              {quietest ? (
                <>
                  {short(quietest)} <small>{quietest.total}</small>
                </>
              ) : (
                '—'
              )}
            </b>
          </div>
        )}
        <div>
          <span>Average per {unit}</span>
          <b>{avg.toFixed(1)}</b>
        </div>
        <div>
          <span>Busiest {unit}</span>
          <b>
            {busiest ? (
              <>
                {short(busiest)} <small>{busiest.total}</small>
              </>
            ) : (
              '—'
            )}
          </b>
        </div>
      </div>
    </div>
  );
}
