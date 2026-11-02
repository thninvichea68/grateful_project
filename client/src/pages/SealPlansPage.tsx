import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  SEAL_PLAN_STAGE_LABEL,
  sealPlanReadiness,
  type SealPlanRow,
  type SealPlanStage,
} from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { useLookups, useSealPlans } from '../features/hooks';
import { TableState, ui } from '../components/ui';
import { SearchBox } from '../components/SearchBox';
import { Pill } from '../components/StatusPill';
import { businessToday, fmtDate, fmtNum } from '../lib/format';
import { NewSealPlanModal } from './sealplans/NewSealPlanModal';
import { SealPlanModal, type SealPlanTarget } from './sealplans/SealPlanModal';
import { SealPlansMenu } from './sealplans/SealPlansMenu';
import { fmtTare, groupByMonth, monthHeading, MONTHS } from './sealplans/sealPlanFormat';
import { HeadCell, SortButton, type SortDir } from './plans/HeadCell';
import p from './plans/PlansTable.module.css';
import s from './sealplans/SealPlansTable.module.css';

const COLS = 11;
const STAGE_TONE: Record<SealPlanStage, 'pending' | 'progress' | 'completed'> = {
  PLANNING: 'pending',
  READY: 'progress',
  LOADED: 'completed',
  DEPARTED: 'completed',
};
type Row = SealPlanRow & { ready: ReturnType<typeof sealPlanReadiness> };

/** A required value left blank reads (and searches) as "Missing" before departure. */
const gapText = (r: Row, label: string) => (r.ready.missing.includes(label) ? 'Missing' : '');
const dateText = (d: string | null) => (d ? `${fmtDate(d)} ${d}` : '');
const STAGE_ORDER: Record<SealPlanStage, number> = {
  PLANNING: 0,
  READY: 1,
  LOADED: 2,
  DEPARTED: 3,
};

/** The table's columns: what each header searches and sorts by. */
const COLUMNS: { key: string; label: string; text: (r: Row) => string; num?: boolean }[] = [
  { key: 'container', label: 'Container', text: (r) => `${r.containerNo} ${r.size ?? ''}` },
  { key: 'client', label: 'Client', text: (r) => `${r.clientCode} ${r.clientName}` },
  { key: 'so', label: 'SO No.', text: (r) => r.bookingNo ?? '' },
  { key: 'vessel', label: 'Vessel', text: (r) => r.vesselName ?? '' },
  { key: 'etd', label: 'ETD', text: (r) => dateText(r.etd) },
  {
    key: 'carrierSeal',
    label: 'Carrier Seal',
    text: (r) => r.linerSeal || gapText(r, 'Carrier seal'),
  },
  {
    key: 'customsSeal',
    label: 'Customs Seal',
    text: (r) => r.customsSeal || gapText(r, 'Customs seal'),
  },
  {
    key: 'loading',
    label: 'Loading',
    text: (r) => dateText(r.loadingDate) || gapText(r, 'Loading date'),
  },
  {
    key: 'truck',
    label: 'Truck',
    text: (r) => [r.truckNo, r.truckBy].filter(Boolean).join(' ') || gapText(r, 'Truck'),
  },
  {
    key: 'tare',
    label: 'Tare',
    text: (r) => r.tareWeightKg ?? gapText(r, 'Tare weight'),
    num: true,
  },
];
/** Sort values: dates as ISO, tare as a number, the rest as text. */
const sortValue = (key: string, r: Row): string | number => {
  if (key === 'etd') return r.etd ?? '';
  if (key === 'loading') return r.loadingDate ?? '';
  if (key === 'tare') return Number(r.tareWeightKg ?? -1);
  if (key === 'status') return STAGE_ORDER[r.ready.stage];
  return (COLUMNS.find((c) => c.key === key)?.text(r) ?? '').toLowerCase();
};

/**
 * Seal Plan — container shipment schedule: every container of an export shipment, by the month
 * it is loaded, with its seals, vessel, trucking and depot (the SEAL PLAN spreadsheet).
 */
export function SealPlansPage() {
  const { can } = useAuth();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<SealPlanTarget | null>(null);
  const [picking, setPicking] = useState(false);

  const thisYear = new Date().getFullYear();
  const year = Number(params.get('year')) || thisYear;
  const month = params.get('month') ?? '';
  const clientId = params.get('clientId') ?? '';
  const q = params.get('q') ?? '';
  const list = useSealPlans({
    year,
    month: month || undefined,
    clientId: clientId || undefined,
    q: q || undefined,
  });

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  // Readiness of each container (needs today's business date), then the stage filter.
  const today = businessToday();
  const stage = (params.get('stage') ?? '') as '' | SealPlanStage;
  const rows = useMemo(
    () => (list.data ?? []).map((r) => ({ ...r, ready: sealPlanReadiness(r, today) })),
    [list.data, today],
  );
  const counts = useMemo(() => {
    const c = { PLANNING: 0, READY: 0, LOADED: 0, DEPARTED: 0 } as Record<SealPlanStage, number>;
    for (const r of rows) c[r.ready.stage]++;
    return c;
  }, [rows]);
  // The box under each header (f_container, f_vessel…) and the header sort, from the URL.
  const searches = COLUMNS.map(
    (c) => [c, (params.get(`f_${c.key}`) ?? '').toLowerCase()] as const,
  ).filter(([, v]) => v);
  const sort = params.get('sort') ?? '';
  const sortKey = sort.replace(/^-/, '');
  const sortDir = (key: string): SortDir =>
    sortKey === key ? (sort.startsWith('-') ? 'desc' : 'asc') : null;
  const sortBy = (key: string) => set('sort', sortDir(key) === 'asc' ? `-${key}` : key);
  // Newest month first: what is loading now and next is on top. Sorting is within each month.
  const groups = useMemo(() => {
    const shown = rows.filter(
      (r) =>
        (!stage || r.ready.stage === stage) &&
        searches.every(([c, v]) => c.text(r).toLowerCase().includes(v)),
    );
    const out = groupByMonth(shown).reverse();
    if (sortKey) {
      const dir = sort.startsWith('-') ? -1 : 1;
      for (const g of out)
        g.rows.sort((a, b) => {
          const x = sortValue(sortKey, a);
          const y = sortValue(sortKey, b);
          return (x < y ? -1 : x > y ? 1 : 0) * dir;
        });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, stage, sort, searches.map(([c, v]) => `${c.key}=${v}`).join('&')]);

  const stageTabs: { v: '' | SealPlanStage; label: string; n: number }[] = [
    { v: '', label: 'All', n: rows.length },
    { v: 'PLANNING', label: 'Planning', n: counts.PLANNING },
    { v: 'READY', label: 'Ready to load', n: counts.READY },
    { v: 'LOADED', label: 'Loaded', n: counts.LOADED },
    { v: 'DEPARTED', label: 'Departed', n: counts.DEPARTED },
  ];
  const filtered = !!(q || clientId || month || searches.length);

  return (
    <section className="view active" id="view-sealplans">
      <div className="card">
        {/* Filters on the left, actions on the right. */}
        <div className={p.top}>
          <div className={ui.toolbar} style={{ flex: '1 1 auto' }}>
            <select
              className={ui.input}
              value={year}
              onChange={(e) =>
                set('year', e.target.value === String(thisYear) ? '' : e.target.value)
              }
              aria-label="Year"
            >
              {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <select
              className={ui.input}
              value={month}
              onChange={(e) => set('month', e.target.value)}
              aria-label="Month"
            >
              <option value="">All months</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m.charAt(0) + m.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
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
            <SearchBox
              placeholder="Search container, seal, SO no…"
              defaultValue={q}
              onChange={(e) => set('q', e.target.value.trim())}
              aria-label="Search seal plans"
            />
          </div>
          <div className={ui.toolbar}>
            {can('sealplans:write') && (
              <button type="button" className="new-shipment-btn" onClick={() => setPicking(true)}>
                + New Seal Plan
              </button>
            )}
            <SealPlansMenu
              filters={{ year: String(year), month, clientId, q }}
              count={list.data?.length ?? 0}
            />
          </div>
        </div>

        <div className={p.bar}>
          <div className={p.tabs} role="group" aria-label="Stage">
            {stageTabs.map((x) => (
              <button
                key={x.v || 'all'}
                type="button"
                className={p.tab}
                aria-pressed={stage === x.v}
                data-warn={x.v === 'PLANNING' && x.n > 0}
                title={
                  x.v === 'PLANNING'
                    ? 'Not departed and missing a loading date, a seal, the truck or the tare weight'
                    : undefined
                }
                onClick={() => set('stage', x.v)}
              >
                {x.label}
                <span className={p.count}>{list.data ? fmtNum(x.n) : '…'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={s.scroll}>
          <table className={s.table}>
            {/* Same header as Shipping Plans: each name is its search box, ↕ sorts. */}
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} className={c.num ? s.num : undefined}>
                    <HeadCell
                      label={c.label}
                      value={params.get(`f_${c.key}`) ?? ''}
                      onSearch={(v) => set(`f_${c.key}`, v)}
                      dir={sortDir(c.key)}
                      onSort={() => sortBy(c.key)}
                    />
                  </th>
                ))}
                <th>
                  <div className={p.head} data-filled={!!stage}>
                    <select
                      className={p.headInput}
                      aria-label="Status"
                      value={stage}
                      onChange={(e) => set('stage', e.target.value)}
                    >
                      <option value="">Status</option>
                      <option value="PLANNING">Planning</option>
                      <option value="READY">Ready to load</option>
                      <option value="LOADED">Loaded</option>
                      <option value="DEPARTED">Departed</option>
                    </select>
                    <SortButton
                      label="Status"
                      dir={sortDir('status')}
                      onSort={() => sortBy('status')}
                    />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={COLS}
                loading={list.isLoading}
                error={list.error}
                empty={groups.length === 0 && !list.isLoading}
                emptyText={
                  filtered || stage
                    ? 'No containers match these filters.'
                    : `No seal plans in ${year} yet. Containers of export CY/CY Shipping Plans appear here; “+ New Seal Plan” adds one.`
                }
              />
              {groups.map((g) => (
                <Fragment key={g.month}>
                  <tr className={s.month}>
                    <td colSpan={COLS}>
                      <b>{monthTitle(g.month)}</b>
                      <span>
                        {g.rows.length} container{g.rows.length === 1 ? '' : 's'}
                      </span>
                    </td>
                  </tr>
                  {g.rows.map((r) => (
                    <SealPlanTableRow
                      key={r.id ?? `${r.shipmentId}:${r.containerNo}`}
                      row={r}
                      onOpen={() => setOpen({ kind: 'row', row: r })}
                    />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {picking && (
        <NewSealPlanModal
          onPick={(shipmentId) => {
            setPicking(false);
            setOpen({ kind: 'shipment', shipmentId });
          }}
          onBlank={() => {
            setPicking(false);
            setOpen({ kind: 'blank' });
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {open && <SealPlanModal target={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** "DECEMBER 2026" → "December 2026". */
const monthTitle = (m: string) =>
  monthHeading(m)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * One container on one line. Before it departs, a blank loading date, seal, truck or tare
 * reads "Missing" in its own cell, so what to chase is where it belongs.
 */
function SealPlanTableRow({ row: r, onOpen }: { row: Row; onOpen: () => void }) {
  const { stage, missing } = r.ready;
  const missingSeal = stage === 'LOADED' && missing.some((m) => m.endsWith('seal'));
  const gap = (label: string) =>
    missing.includes(label) ? <span className={s.missing}>Missing</span> : null;
  const val = (v: string | null | undefined, label?: string) =>
    v?.trim() ? v : ((label && gap(label)) ?? <span className={s.muted}>—</span>);
  return (
    <tr
      className={s.row}
      tabIndex={0}
      title={[r.shipmentReference, r.invNo && `Inv ${r.invNo}`, r.other]
        .filter(Boolean)
        .join(' · ')}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <td>
        <span className={s.container}>{r.containerNo}</span>
        {r.size && <span className={s.size}>{r.size}</span>}
      </td>
      <td>
        <span className={s.client} title={r.clientName}>
          {r.clientCode}
        </span>
      </td>
      <td>{val(r.bookingNo)}</td>
      <td className={s.clip} title={r.vesselName ?? undefined}>
        {val(r.vesselName)}
      </td>
      <td>{r.etd ? fmtDate(r.etd) : <span className={s.muted}>—</span>}</td>
      <td>{val(r.linerSeal, 'Carrier seal')}</td>
      <td>{val(r.customsSeal, 'Customs seal')}</td>
      <td>{r.loadingDate ? fmtDate(r.loadingDate) : val(null, 'Loading date')}</td>
      <td className={s.clip} title={[r.truckBy, r.truckNo].filter(Boolean).join(' · ')}>
        {val(r.truckNo || r.truckBy, 'Truck')}
      </td>
      <td className={s.num}>
        {r.tareWeightKg ? fmtTare(r.tareWeightKg) : val(null, 'Tare weight')}
      </td>
      <td title={missing.length ? `Missing: ${missing.join(', ')}` : undefined}>
        <Pill tone={missingSeal ? 'exception' : STAGE_TONE[stage]}>
          {SEAL_PLAN_STAGE_LABEL[stage]}
        </Pill>
      </td>
    </tr>
  );
}
