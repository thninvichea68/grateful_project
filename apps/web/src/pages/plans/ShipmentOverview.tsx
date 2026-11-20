import type { ReactNode } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { type LookupsResponse, type ShipmentDetail } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useDocuments } from '../../features/admin';
import { toNum, type FormValues } from './formModel';
import { shipmentStages, type ShipmentStage } from './shipmentStages';
import s from './ShipmentOverview.module.css';

const PP = 'Asia/Phnom_Penh';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: PP }).format(new Date());
const short = (ymd: string | null | undefined) =>
  ymd
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      }).format(new Date(`${ymd.slice(0, 10)}T00:00:00Z`))
    : '—';
const txt = (v: string | null | undefined) => (v ?? '').trim();
const num = (n: number, d = 0) =>
  n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });

/** A finding on the plan: what is wrong or missing, and the field that fixes it. */
interface Check {
  tone: 'red' | 'amber';
  title: string;
  detail: string;
  field: keyof FormValues | null;
}

const svg = (children: ReactNode, size = 16) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);
const I = {
  check: svg(<path d="m5 12 5 5 9-10" />, 14),
  x: svg(<path d="M18 6 6 18M6 6l12 12" />, 13),
  warn: svg(
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4M12 17h.01" />
    </>,
  ),
  upload: svg(
    <path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />,
  ),
  ship: svg(
    <>
      <path d="M2 20a2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1 2.4 2.4 0 0 1 2-1 2.4 2.4 0 0 1 2 1 2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1 2.4 2.4 0 0 1 2-1 2.4 2.4 0 0 1 2 1 2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1" />
      <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76" />
      <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6M12 10v4M12 2v3" />
    </>,
    18,
  ),
  plane: svg(
    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />,
    18,
  ),
  chevron: svg(<path d="m9 6 6 6-6 6" />),
};

/** Cross-checks between the plan's own fields: dates out of order, totals that disagree. */
function crossChecks(v: FormValues, detail: ShipmentDetail, cleared: boolean): Check[] {
  const out: Check[] = [];
  const now = today();
  const lines = (v.invoices ?? []).flatMap((i) => i.lines ?? []);
  const invCbm = lines.reduce((n, l) => n + toNum(l.cbm), 0);
  const planCbm = toNum(v.cbm);
  if (txt(v.cbm as string) && invCbm > 0 && Math.abs(planCbm - invCbm) > 0.01)
    out.push({
      tone: 'amber',
      title: 'CBM on the plan differs from the invoices',
      detail: `Plan ${num(planCbm, 3)} CBM vs invoice lines ${num(invCbm, 3)} CBM. Every bill prints the plan's CBM.`,
      field: 'cbm',
    });
  const noCtns = (v.invoices ?? []).filter(
    (i) => txt(i.invoiceNo) && (i.lines ?? []).some((l) => toNum(l.ctns) <= 0),
  );
  if (noCtns.length)
    out.push({
      tone: 'amber',
      title: `${noCtns.length === 1 ? 'An invoice has' : `${noCtns.length} invoices have`} lines without ${v.direction === 'EXPORT' ? 'CTNS' : 'PKGS'}`,
      detail: noCtns.map((i) => i.invoiceNo).join(', '),
      field: 'invoices',
    });

  if (v.direction === 'EXPORT') {
    if (txt(v.atd) && !cleared)
      out.push({
        tone: 'red',
        title: 'Departed without a customs declaration',
        detail: `ATD ${short(v.atd)}, but no declaration no. and date are recorded.`,
        field: 'declarations',
      });
    if (txt(v.hblDate) && txt(v.atd) && txt(v.hblDate) < txt(v.atd))
      out.push({
        tone: 'amber',
        title: "BL date is before the ship's departure",
        detail: `BL ${short(v.hblDate)} vs ATD ${short(v.atd)}: check the on-board date.`,
        field: 'hblDate',
      });
    if (txt(v.etd) && !txt(v.atd) && txt(v.etd) < now)
      out.push({
        tone: 'amber',
        title: 'ETD has passed, no ATD',
        detail: `ETD ${short(v.etd)}. Confirm the departure with the forwarder.`,
        field: 'atd',
      });
  } else {
    if (txt(v.eta) && !txt(v.ata) && txt(v.eta) < now)
      out.push({
        tone: 'amber',
        title: 'ETA has passed, no ATA',
        detail: `ETA ${short(v.eta)}. Confirm the arrival with the forwarder.`,
        field: 'ata',
      });
    if (txt(v.arriveFty) && txt(v.ata) && txt(v.arriveFty) < txt(v.ata))
      out.push({
        tone: 'red',
        title: 'Arrive FTY is before ATA',
        detail: `Arrive FTY ${short(v.arriveFty)} vs ATA ${short(v.ata)}.`,
        field: 'arriveFty',
      });
    if (
      v.loadType === 'FCL' &&
      v.transportMode !== 'AIR' &&
      !(v.containers ?? []).some((c) => txt(c.containerNo))
    )
      out.push({
        tone: 'amber',
        title: 'FCL shipment without a container no.',
        detail: 'Add the container numbers and sizes.',
        field: 'containers',
      });
  }
  if (detail.status === 'COMPLETED' && !detail.declarations.some((d) => d.hasLedgerEntry))
    out.push({
      tone: 'amber',
      title: 'Completed, not in the billing ledger yet',
      detail: 'Invoice the client from Accounting → Client Billing.',
      field: null,
    });
  return out;
}

export function ShipmentOverview({
  detail,
  lookups,
  onFix,
  onDocs,
  onSchedule,
}: {
  detail: ShipmentDetail;
  lookups: LookupsResponse;
  /** Open the tab holding `field` and put the cursor in it. */
  onFix: (field: keyof FormValues) => void;
  onDocs: () => void;
  onSchedule: () => void;
}) {
  const { can } = useAuth();
  const { control } = useFormContext<FormValues>();
  const v = useWatch({ control }) as FormValues;
  const stages = shipmentStages(v);
  const done = stages.filter((x) => x.complete).length;
  const next = stages.findIndex((x) => !x.complete);
  const cur: ShipmentStage | undefined = stages[next];
  const later = next < 0 ? [] : stages.slice(next + 1).filter((x) => !x.complete);
  const cleared = stages.some((x) => x.label === 'Clearance' && x.complete);
  const checks = crossChecks(v, detail, cleared);
  const isExport = v.direction === 'EXPORT';
  const air = v.transportMode === 'AIR';

  const docs = useDocuments({ shipmentId: detail.id, pageSize: 200 }, can('documents:read'));
  // One complete document set per shipment, uploaded once and kept with its declaration.
  // Due once the declaration is entered (or every stage is done); before that, not yet.
  const files = [...(docs.data?.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const docState: 'have' | 'missing' | 'later' = files.length
    ? 'have'
    : cleared || next < 0
      ? 'missing'
      : 'later';

  // ---------- The summary strip ----------
  const lines = (v.invoices ?? []).flatMap((i) => i.lines ?? []);
  const pcs = lines.reduce((n, l) => n + toNum(l.pcs), 0);
  const cbm = txt(v.cbm as string) ? toNum(v.cbm) : lines.reduce((n, l) => n + toNum(l.cbm), 0);
  const boxes = (v.containers ?? []).filter((c) => txt(c.containerNo));
  const bySize = boxes.reduce<Record<string, number>>((m, c) => {
    const k = c.size || '—';
    m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {});
  const country = (iso?: string | null) =>
    lookups.countries.find((c) => c.iso2 === iso)?.name ?? iso ?? '—';
  const port = lookups.ports.find((p) => p.id === v.clearancePortId);
  const decls = (v.declarations ?? []).filter((d) => txt(d.declareNo));
  const inLedger = detail.declarations.some((d) => d.hasLedgerEntry);
  const cells: { label: string; value: string; sub: string; tone?: 'red' | 'green' }[] = [
    {
      label: 'Cargo',
      value: txt(v.quantity as string)
        ? `${num(toNum(v.quantity))} ${txt(v.quantityUnit)}`.trim()
        : '—',
      sub:
        [pcs ? `${num(pcs)} pcs` : '', cbm ? `${num(cbm, 2)} CBM` : '']
          .filter(Boolean)
          .join(' · ') || 'No invoice lines',
    },
    {
      label: air ? 'Air freight' : v.loadType === 'LCL' ? 'LCL' : 'Containers',
      value: air
        ? txt(v.flightNo) || 'Flight —'
        : v.loadType === 'LCL'
          ? `${num(cbm, 2)} CBM`
          : Object.entries(bySize)
              .map(([k, n]) => `${n}×${k}`)
              .join(', ') || 'None yet',
      sub: air
        ? `Check-in ${short(v.checkInDate)}`
        : boxes.map((c) => c.containerNo).join(', ') || '—',
    },
    {
      label: 'Route',
      value: isExport
        ? `${txt(v.etdPort) || 'KH'} → ${country(v.destinationCountryIso2)}`
        : `${country(v.originCountryIso2)} → ${port?.shortName || port?.name || 'KH'}`,
      sub: [txt(v.vesselName), txt(v.voyageNo)].filter(Boolean).join(' / ') || '—',
    },
    isExport
      ? {
          label: txt(v.atd) ? 'Departed (ATD)' : 'Departs (ETD)',
          value: short(v.atd || v.etd),
          sub: `ETA ${short(v.eta)}`,
        }
      : {
          label: txt(v.ata) ? 'Arrived (ATA)' : 'Arrives (ETA)',
          value: short(v.ata || v.eta),
          sub: `Arrive FTY ${short(v.arriveFty)}`,
        },
    {
      label: 'Customs',
      value: decls.length ? decls.map((d) => d.declareNo).join(', ') : 'Not declared',
      sub: decls.length ? `Declared ${short(decls[0]!.declareDate)}` : port?.name || '—',
      tone: decls.length ? 'green' : undefined,
    },
    {
      label: 'Billing',
      value: inLedger ? 'In ledger' : detail.status === 'COMPLETED' ? 'Not invoiced' : 'Not yet',
      sub: txt(v.thcHblNo) ? `THC ${txt(v.thcHblNo)}` : 'No invoice / THC',
      tone: inLedger ? 'green' : detail.status === 'COMPLETED' ? 'red' : undefined,
    },
  ];

  const issues = (cur?.missing.length ?? 0) + checks.length;
  const pct = Math.round((done / stages.length) * 100);
  const fix = (field: keyof FormValues | null, label = 'Fix') =>
    field && can('shipments:write') ? (
      <button type="button" className={s.fixBtn} onClick={() => onFix(field)}>
        {label}
      </button>
    ) : null;

  return (
    <div className={s.wrap}>
      <div className={s.strip}>
        {cells.map((c) => (
          <div key={c.label} className={s.cell} data-tone={c.tone}>
            <span className={s.cellLabel}>{c.label}</span>
            <span className={s.cellValue} title={c.value}>
              {c.value}
            </span>
            <span className={s.cellSub} title={c.sub}>
              {c.sub}
            </span>
          </div>
        ))}
      </div>

      <section className={s.panel} aria-labelledby="ov-stages">
        <header className={s.head}>
          <div>
            <h3 id="ov-stages">Stage of work</h3>
            <p>
              {done} of {stages.length} stages complete
              {cur ? ` · now at ${cur.label}` : ' · every stage done'}
            </p>
          </div>
          <span className={cur ? s.badgeRed : s.badgeGreen}>
            {cur ? `${stages.length - done} not finished` : 'Complete'}
          </span>
        </header>
        <ol className={s.track}>
          {stages.map((x, i) => {
            const state = x.complete ? 'done' : i === next ? 'current' : 'todo';
            return (
              <li key={x.label} className={s.step} data-state={state}>
                <span className={s.dot}>{x.complete ? I.check : i + 1}</span>
                <span className={s.stepLabel}>{x.label}</span>
                <span className={s.stepSub}>
                  {x.complete ? 'Done' : i === next ? 'In progress' : 'Not started'}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <div className={s.grid}>
        <div className={s.col}>
          <section className={s.panel} aria-labelledby="ov-todo">
            <header className={s.head}>
              <div>
                <h3 id="ov-todo">What&apos;s left to finish</h3>
                <p>The current stage&apos;s missing data, then cross-checks on the plan</p>
              </div>
              <span className={issues ? s.badgeAmber : s.badgeGreen}>
                {issues ? `${issues} to fix` : 'All clear'}
              </span>
            </header>
            <ul className={s.rows}>
              {cur?.missing.map((m) => (
                <li key={m.field} className={s.row} data-tone="red">
                  <span className={s.rowIcon}>{I.warn}</span>
                  <span className={s.rowText}>
                    <strong>
                      {cur.label}: {m.label} missing
                    </strong>
                    <span>Needed to finish the current stage.</span>
                  </span>
                  {fix(m.field, 'Enter now')}
                </li>
              ))}
              {checks.map((c) => (
                <li key={c.title} className={s.row} data-tone={c.tone}>
                  <span className={s.rowIcon}>{I.warn}</span>
                  <span className={s.rowText}>
                    <strong>{c.title}</strong>
                    <span>{c.detail}</span>
                  </span>
                  {fix(c.field)}
                </li>
              ))}
              {later.length > 0 && (
                <li className={s.row} data-tone="grey">
                  <span className={s.rowIcon}>{later.length}</span>
                  <span className={s.rowText}>
                    <strong>Later stages not started</strong>
                    <span>
                      {later
                        .map((x) => `${x.label} (${x.missing.map((m) => m.label).join(', ')})`)
                        .join(' · ')}
                    </span>
                  </span>
                </li>
              )}
              {issues === 0 && (
                <li className={s.row} data-tone="green">
                  <span className={s.rowIcon}>{I.check}</span>
                  <span className={s.rowText}>
                    <strong>{cur ? 'No problems found' : 'Everything is complete'}</strong>
                    <span>Dates, totals and stages on this plan agree.</span>
                  </span>
                </li>
              )}
            </ul>
          </section>

          {can('documents:read') && (
            <section className={s.panel} aria-labelledby="ov-docs">
              <header className={s.head}>
                <div>
                  <h3 id="ov-docs">Declaration documents</h3>
                  <p>One complete set per shipment, uploaded once and kept with the declaration</p>
                </div>
                <span
                  className={
                    docState === 'have'
                      ? s.badgeGreen
                      : docState === 'missing'
                        ? s.badgeRed
                        : s.badgeAmber
                  }
                >
                  {docState === 'have' ? 'On file' : docState === 'missing' ? 'Missing' : 'Not yet'}
                </span>
              </header>
              <ul className={s.rows}>
                <li className={s.docRow} data-state={docState}>
                  <span className={s.docIcon}>
                    {docState === 'have' ? I.check : docState === 'missing' ? I.x : null}
                  </span>
                  <span className={s.rowText}>
                    <strong>
                      Document set
                      {decls.length
                        ? ` · declaration ${decls.map((d) => d.declareNo).join(', ')}`
                        : ''}
                    </strong>
                    <span>
                      {docState === 'have'
                        ? `${files.length} file${files.length === 1 ? '' : 's'} · last added ${short(files[0]!.createdAt)}${files[0]!.uploadedBy ? ` by ${files[0]!.uploadedBy}` : ''} · ${files
                            .slice(0, 3)
                            .map((f) => f.originalName)
                            .join(', ')}${files.length > 3 ? ` +${files.length - 3}` : ''}`
                        : docState === 'missing'
                          ? 'Needed for the declaration: upload the complete set (invoice, packing list, B/L, declaration…) in one go.'
                          : 'Upload it once, when the set is complete (by the clearance stage).'}
                    </span>
                  </span>
                  <button type="button" className={s.uploadBtn} onClick={onDocs}>
                    {docState === 'have' ? (
                      'View'
                    ) : (
                      <>
                        {I.upload}
                        Upload
                      </>
                    )}
                  </button>
                </li>
              </ul>
            </section>
          )}
        </div>

        <aside className={s.col}>
          <section className={s.panel} aria-labelledby="ov-progress">
            <header className={s.head}>
              <div>
                <h3 id="ov-progress">Progress</h3>
                <p>{pct}% of the work done</p>
              </div>
              <span className={pct === 100 ? s.badgeGreen : s.badgeBlue}>{pct}%</span>
            </header>
            <div className={s.progressBody}>
              <div
                className={s.bar}
                role="img"
                aria-label={`${done} of ${stages.length} stages done`}
              >
                <span className={s.barDone} style={{ width: `${pct}%` }} />
              </div>
              <ul className={s.legend}>
                <li data-k="done">
                  Done <strong>{done}</strong>
                </li>
                <li data-k="left">
                  Remaining <strong>{stages.length - done}</strong>
                </li>
                <li data-k="issue">
                  Issues <strong>{checks.length}</strong>
                </li>
              </ul>
            </div>
          </section>

          <section className={s.panel} aria-labelledby="ov-sched">
            <header className={s.head}>
              <div>
                <h3 id="ov-sched">{air ? 'Flight' : 'Vessel'} &amp; schedule</h3>
                <p>{txt(v.bookingNo) ? `Booking ${txt(v.bookingNo)}` : 'No booking no. yet'}</p>
              </div>
            </header>
            <button type="button" className={s.linkRow} onClick={onSchedule}>
              <span className={s.linkIcon}>{air ? I.plane : I.ship}</span>
              <span className={s.rowText}>
                <strong>
                  {air
                    ? txt(v.flightNo) || 'Flight not set'
                    : [txt(v.vesselName), txt(v.voyageNo)].filter(Boolean).join(' / ') ||
                      'Vessel not set'}
                </strong>
                <span>
                  ETD {short(v.etd)}
                  {txt(v.atd) ? ` (ATD ${short(v.atd)})` : ''} · ETA {short(v.eta)}
                  {txt(v.ata) ? ` (ATA ${short(v.ata)})` : ''}
                </span>
                <span>
                  {air ? 'HAWB' : 'HBL'} {txt(v.hblNo) || '—'} · {short(v.hblDate)}
                </span>
              </span>
              <span className={s.chev}>{I.chevron}</span>
            </button>
          </section>

          <section className={s.panel} aria-labelledby="ov-remark">
            <header className={s.head}>
              <div>
                <h3 id="ov-remark">Remark</h3>
                <p>Notes kept with this plan</p>
              </div>
              {fix('remark', txt(v.remark) ? 'Edit' : 'Add')}
            </header>
            <p className={s.remark}>{txt(v.remark) || 'No remark.'}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
