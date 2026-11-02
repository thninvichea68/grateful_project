import { clearanceStatusOf, PERMIT_STATUS_LABEL } from '@gs/shared';
import { fmtDate } from '../../lib/format';
import { toNum, type FormValues } from './formModel';
import f from './ShipmentForm.module.css';

export type StageKey =
  // Import
  | 'hbl'
  | 'invpl'
  | 'permit'
  | 'release'
  | 'charge'
  | 'authorize'
  | 'clearance'
  | 'delivery'
  // Export
  | 'booking'
  | 'container'
  | 'departure'
  | 'bl'
  | 'co';

export interface Stage {
  key: StageKey;
  label: string;
  done: boolean;
  /** What marked it done (a number or date), shown under the label. */
  hint: string;
  /** Stuck: it cannot go on until someone acts (a rejected permit). */
  blocked?: boolean;
}

type Mode = FormValues['transportMode'];

/** The house bill is named as the document is for each freight mode. */
const BILL: Record<Mode, { imp: string; exp: string }> = {
  SEA: { imp: 'HBL Release', exp: 'BL Release' },
  AIR: { imp: 'AWB Release', exp: 'AWB Release' },
  ROAD: { imp: 'Waybill Release', exp: 'Waybill Release' },
  RAIL: { imp: 'Waybill Release', exp: 'Waybill Release' },
};

const hintOf = (no: string | null | undefined, date: string | null | undefined) =>
  [no?.trim(), date ? fmtDate(date) : ''].filter(Boolean).join(' · ');

/**
 * The shipment's workflow, in order. A stage is done as soon as its data is entered, so the
 * tracker follows the form as it is typed:
 *  - Import: HBL/AWB release → Invoice/PL → Permit → Arrival & DO (arrival notice, charge
 *    invoice and DO/EDO) → Authorize → Clearance → Delivery.
 *  - Export: Booking → Invoice/PL → Container & Seal (CY/CY sea or truck only) → Clearance
 *    → Departure → BL/AWB release → Invoice charge → CO.
 */
export function stagesOf(v: Partial<FormValues>): Stage[] {
  const mode = v.transportMode ?? 'SEA';
  const invoices = (v.invoices ?? []).filter(
    (i) =>
      !!i.invoiceNo?.trim() && i.lines.some((l) => toNum(l.pcs) || l.cdcNo || l.poNo || l.styleNo),
  );
  const decls = v.declarations ?? [];
  const cleared = clearanceStatusOf({ declarations: decls }) === 'CLEARED';
  const declared = decls.find((d) => d.declareNo?.trim());
  const containers = (v.containers ?? []).filter((c) => c.containerNo?.trim());

  const invpl: Stage = {
    key: 'invpl',
    label: 'Invoice / PL',
    done: invoices.length > 0,
    hint: invoices.length ? `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}` : '',
  };
  const clearance: Stage = {
    key: 'clearance',
    label: 'Clearance',
    done: cleared,
    hint: hintOf(declared?.declareNo, declared?.declareDate),
  };
  const charge: Stage = {
    key: 'charge',
    label: 'Invoice Charge',
    done: !!(v.thcHblNo?.trim() || v.thcHblDate),
    hint: hintOf(v.thcHblNo, v.thcHblDate),
  };
  const bill = (key: 'hbl' | 'bl', label: string): Stage => ({
    key,
    label,
    done: !!v.hblNo?.trim(),
    hint: v.hblNo?.trim() ?? '',
  });
  const dated = (
    key: StageKey,
    label: string,
    no: string | null | undefined,
    date: string | null | undefined,
  ): Stage => ({ key, label, done: !!date, hint: hintOf(no, date) });

  // Import: the ETA, the forwarder's THC invoice and the DO; done once all three are in.
  const release = (): Stage => {
    const n = [!!v.eta, charge.done, !!v.doDate].filter(Boolean).length;
    return {
      key: 'release',
      label: 'Arrival & DO',
      done: n === 3,
      hint: n === 3 ? `DO ${fmtDate(v.doDate!)}` : n ? `${n} of 3 in` : '',
    };
  };

  if (v.direction === 'EXPORT')
    return [
      { key: 'booking', label: 'Booking', done: !!v.bookingNo?.trim(), hint: v.bookingNo ?? '' },
      invpl,
      // Containers are recorded for CY/CY (FCL) only; air has none.
      ...(mode !== 'AIR' && v.loadType === 'FCL'
        ? [
            {
              key: 'container' as const,
              label: 'Container & Seal',
              done: containers.length > 0,
              hint: containers.length
                ? `${containers.length} container${containers.length === 1 ? '' : 's'}`
                : '',
            },
          ]
        : []),
      clearance,
      dated('departure', 'Departure', '', v.atd),
      bill('bl', BILL[mode].exp),
      charge,
      { key: 'co', label: 'CO', done: !!v.coNumber?.trim(), hint: v.coNumber ?? '' },
    ];
  return [
    bill('hbl', BILL[mode].imp),
    invpl,
    {
      key: 'permit',
      label: 'Permit',
      // Approved, or none needed; a rejected permit holds the shipment up.
      done: v.permitStatus === 'APPROVED' || v.permitStatus === 'NOT_REQUIRED',
      blocked: v.permitStatus === 'REJECTED',
      hint: v.permitStatus
        ? [PERMIT_STATUS_LABEL[v.permitStatus], v.permitDate ? fmtDate(v.permitDate) : '']
            .filter(Boolean)
            .join(' · ')
        : hintOf(v.permitNo, v.permitDate),
    },
    release(),
    dated('authorize', 'Authorize', v.authorizeNo, v.authorizeDate),
    clearance,
    {
      key: 'delivery',
      label: 'Delivery',
      done: !!v.arriveFty,
      hint: v.arriveFty
        ? fmtDate(v.arriveFty) + (v.podReceived ? ' · POD' : '')
        : v.truckNo?.trim()
          ? `Truck ${v.truckNo.trim()}`
          : '',
    },
  ];
}

/**
 * The workflow across the top: a dot per stage, green once done, with the first open stage
 * marked as next. Clicking a stage opens its tab.
 */
export function Tracker({
  stages,
  open,
  onOpen,
}: {
  stages: Stage[];
  /** The stage whose tab is open, if any. */
  open: StageKey | undefined;
  onOpen: (key: StageKey) => void;
}) {
  const next = stages.findIndex((s) => !s.done);
  const doneCount = stages.filter((s) => s.done).length;
  return (
    <div className={f.tracker}>
      <div className={f.trackerHead}>
        <span>Workflow</span>
        <b>
          {doneCount} of {stages.length} done
        </b>
      </div>
      <ol className={f.trackerList} aria-label="Shipment workflow">
        {stages.map((s, i) => {
          const state = s.done ? 'done' : s.blocked ? 'block' : i === next ? 'next' : 'todo';
          return (
            <li key={s.key} className={f.trackerStage} data-state={state}>
              <button
                type="button"
                onClick={() => onOpen(s.key)}
                aria-current={open === s.key ? 'step' : undefined}
                title={`${s.label}: ${s.done ? 'done' : s.blocked ? 'blocked' : 'not done yet'}`}
              >
                <span className={f.trackerDot} aria-hidden="true">
                  {s.done ? '✓' : s.blocked ? '!' : i + 1}
                </span>
                <span className={f.trackerLabel}>{s.label}</span>
                <small className={f.trackerHint}>
                  {s.hint || (state === 'next' ? 'Next' : '—')}
                </small>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
