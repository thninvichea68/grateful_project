import { fmtMoney } from '../../lib/format';
import s from './ProfitBars.module.css';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const W = 196;
const H = 58;
const PAD = 6; // keeps the dots inside the box

/** This month as YYYY-MM on the viewer's clock. */
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** A smooth path through the points (Catmull-Rom turned into cubic Béziers). */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (!pts.length) return '';
  let d = `M${pts[0]!.x},${pts[0]!.y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  return d;
}

/**
 * Total Net Profit → the year month by month as a line: drawn up to this month (months still
 * to come aren't plotted). Hover a month for its figure; click it to show that month.
 */
export function ProfitBars({
  monthly,
  selected,
  onSelect,
}: {
  monthly: { month: string; netProfit: string }[];
  selected: string;
  onSelect: (month: string) => void;
}) {
  const now = thisMonth();
  const shown = monthly.filter((m) => m.month <= now);
  const values = shown.map((m) => Number(m.netProfit));
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const span = hi - lo || 1;
  const step = (W - PAD * 2) / Math.max(1, monthly.length - 1);
  const pts = shown.map((m, i) => ({
    x: PAD + i * step,
    y: PAD + (1 - (Number(m.netProfit) - lo) / span) * (H - PAD * 2),
    m,
  }));
  const zeroY = PAD + (1 - (0 - lo) / span) * (H - PAD * 2);

  return (
    <div className={s.chart} role="img" aria-label="Net profit by month">
      <svg className={s.svg} viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} className={s.grid} x1={0} x2={W} y1={H * f} y2={H * f} />
        ))}
        {lo < 0 && <line className={s.zero} x1={0} x2={W} y1={zeroY} y2={zeroY} />}
        <path className={s.line} d={smoothPath(pts)} />
        {pts.map((p) => (
          <circle
            key={p.m.month}
            className={s.dot}
            data-current={p.m.month === selected || undefined}
            data-loss={Number(p.m.netProfit) < 0 || undefined}
            cx={p.x}
            cy={p.y}
            r={p.m.month === selected ? 4 : 2.6}
          />
        ))}
      </svg>
      {/* One hover column per month, with its initial under the chart. */}
      <div className={s.cols}>
        {monthly.map((m, i) => {
          const future = m.month > now;
          const name = `${MON[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(0, 4)}`;
          return (
            <button
              type="button"
              key={m.month}
              className={s.col}
              style={{ left: PAD + i * step }}
              data-current={m.month === selected || undefined}
              data-future={future || undefined}
              disabled={future}
              aria-pressed={m.month === selected}
              aria-label={`Show ${name}`}
              onClick={() => onSelect(m.month)}
            >
              <span className={s.month}>{MON[Number(m.month.slice(5, 7)) - 1]![0]}</span>
              <span className={s.tip}>
                {name}
                <b>{future ? '—' : fmtMoney(m.netProfit)}</b>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
