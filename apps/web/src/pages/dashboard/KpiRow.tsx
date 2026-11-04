import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { KpiResponse } from '@gs/shared';
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

/** A KPI: its figure only (charts and comparisons are for the Analytics page). */
function Card({
  tone,
  icon,
  label,
  value,
  meta,
  onOpen,
}: {
  tone: Tone;
  icon: ReactNode;
  label: string;
  value: number;
  meta?: ReactNode;
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
          {meta && <div className={s.meta}>{meta}</div>}
        </div>
      </div>
    </div>
  );
}

export function KpiRow({
  k,
  fullYear = false,
}: {
  k: KpiResponse;
  /** The KPIs cover January to the month shown. */
  fullYear?: boolean;
}) {
  const navigate = useNavigate();
  const toPlans = (q: string) => navigate(`/plans?${q}`);

  return (
    <div className={s.row}>
      <Card
        tone="cyan"
        icon={ICONS.box}
        label={fullYear ? 'Total Shipments This Year' : 'Total Shipments This Month'}
        value={k.total}
        onOpen={() => toPlans('sort=-eta')}
      />
      <Card
        tone="cyan"
        icon={ICONS.import}
        label="Import Shipments"
        value={k.imports}
        onOpen={() => toPlans('direction=IMPORT')}
      />
      <Card
        tone="blue"
        icon={ICONS.export}
        label="Export Shipments"
        value={k.exports}
        onOpen={() => toPlans('direction=EXPORT')}
      />
      <Card
        tone="blue"
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
