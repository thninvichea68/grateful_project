import { useState } from 'react';
import type { ForwarderRow } from '@gs/shared';
import { ChartState } from '../dashboard/parts';
import s from './ForwarderRankCard.module.css';

/*
 * Analytics → Forwarder Performance Ranking: every forwarder ranked by shipments. Each row
 * has a rank badge (top three filled), a cyan → blue bar sized against the busiest
 * forwarder, the shipment count, and an on-time pill toned by how punctual it is.
 * Hovering a row fades the others back.
 */

const tone = (pct: number | null) =>
  pct === null
    ? 'var(--text-tertiary)'
    : pct >= 85
      ? 'var(--accent-emerald)'
      : pct >= 70
        ? 'var(--accent-amber)'
        : 'var(--accent-rose)';

export function ForwarderRankCard({
  rows,
  loading,
  error,
}: {
  rows: ForwarderRow[] | undefined;
  loading: boolean;
  error: unknown;
}) {
  const [active, setActive] = useState<number | null>(null);
  const list = [...(rows ?? [])].sort((a, b) => b.shipments - a.shipments);
  const max = Math.max(1, ...list.map((f) => f.shipments));

  return (
    <div className="card">
      <div className="an-section-title-row">
        <div>
          <h3>Forwarder Performance Ranking</h3>
          <div className="an-section-sub">
            Ranked by shipments; on-time = arrived on or before ETA.
          </div>
        </div>
      </div>
      <ChartState loading={loading} error={error} empty={!list.length} height={150}>
        {/* Every forwarder, scrolling inside the card's chart height. */}
        <ol className={`an-scroll-list ${s.list}`}>
          {list.map((f, i) => (
            <li
              key={f.id}
              className={s.row}
              data-dim={active !== null && active !== i ? '' : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              <span className={s.rank} data-top={i < 3 ? '' : undefined}>
                {i + 1}
              </span>
              <div className={s.main}>
                <div className={s.top}>
                  <span className={s.name} title={f.name}>
                    {f.name}
                  </span>
                  <span className={s.count}>
                    <b>{f.shipments.toLocaleString()}</b> shipments
                  </span>
                </div>
                <div className={s.bottom}>
                  <span className={s.track}>
                    <span
                      className={s.fill}
                      style={{
                        width: `${(f.shipments / max) * 100}%`,
                        animationDelay: `${Math.min(i, 10) * 50}ms`,
                      }}
                    />
                  </span>
                  <span className={s.pill} style={{ ['--tone' as string]: tone(f.onTimePct) }}>
                    {f.onTimePct === null ? 'No arrivals yet' : `${f.onTimePct}% on time`}
                  </span>
                  {f.avgDelayDays ? (
                    <span className={s.delay}>{f.avgDelayDays}d avg delay</span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </ChartState>
    </div>
  );
}
