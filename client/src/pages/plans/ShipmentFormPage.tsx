import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  FormProvider,
  useFieldArray,
  useForm,
  useFormContext,
  useWatch,
  type FieldErrors,
} from 'react-hook-form';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BackLink, backRow } from '../../components/BackLink';
import {
  addBusinessDays,
  CLEARANCE_STATUS_LABEL,
  clearanceStatusOf,
  CONTAINER_SIZES,
  PERMIT_STATUS_LABEL,
  PERMIT_STATUSES,
  shipmentStatusOf,
  SHIPMENT_STATUS_LABEL,
  shipmentInputSchema,
  type LookupsResponse,
  type OverImportViolation,
  type PortKind,
  type ShipmentDetail,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { usePublicHolidays } from '../../features/admin';
import { fmtDate } from '../../lib/format';
import {
  useAddForwarder,
  useAuthorizeLetter,
  useDeleteShipment,
  useLookups,
  useSaveShipment,
  useShipment,
} from '../../features/hooks';
import { ErrorBanner, FieldError } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import { ApiError } from '../../lib/api';
import { downloadFile } from '../../lib/files';
import { printInPlace } from '../../lib/printInPlace';
import { formResolver } from '../../lib/zodForm';
import { AddNewSelect } from './AddNewSelect';
import { InvoicesSection, ItemsSection, ITEMS_ANCHOR } from './CargoSection';
import { DeclarationsSection } from './DeclarationsSection';
import { DocumentsTab } from './DocumentsTab';
import { PermitSetCard } from './PermitSetCard';
import { PartiesSection } from './PartiesSection';
import { stagesOf, Tracker, type Stage, type StageKey } from './Tracker';
import {
  blankContainer,
  cleanForSubmit,
  emptyForm,
  fromDetail,
  type FormValues,
} from './formModel';
import f from './ShipmentForm.module.css';

interface Step {
  /** The workflow stage this tab is for; General has none. */
  stage?: StageKey;
  label: string;
  /** Top-level form fields shown in this tab (used to jump to the first error). */
  fields: (keyof FormValues)[];
  render: () => ReactNode;
}

/** Where the invoice errors are: on the invoice itself, or on its items. */
const invoiceErrorsOf = (errs: FieldErrors<FormValues>) => {
  const inv = errs.invoices as unknown;
  if (!inv) return { head: false, lines: false, firstLines: -1 };
  if (!Array.isArray(inv)) return { head: true, lines: false, firstLines: -1 };
  const list = inv as ({ lines?: unknown } & Record<string, unknown>)[];
  return {
    head: list.some((e) => e && Object.keys(e).some((k) => k !== 'lines')),
    lines: list.some((e) => e?.lines),
    firstLines: list.findIndex((e) => e?.lines),
  };
};

const FREIGHT = [
  { value: 'SEA', label: 'Sea' },
  { value: 'AIR', label: 'Air' },
  { value: 'ROAD', label: 'Truck' },
];
const TERMS = [
  { value: 'FCL', label: 'CY / CY' },
  { value: 'LCL', label: 'CFS / CFS (LCL)' },
];
type Mode = FormValues['transportMode'];
/**
 * What the shared fields mean for each freight mode: the house bill, carrier and trip fields
 * are stored in the same columns (hblNo, vesselName, voyageNo) but named as the documents are.
 * `portKinds` are the clearance points offered first; a saved port of another kind stays listed.
 */
const MODE: Record<
  Mode,
  {
    bl: string;
    carrier: string;
    trip: string;
    port: string;
    eta: string;
    noun: string;
    /** Where it arrives: "Arrival at the port". */
    place: string;
    portKinds: PortKind[];
  }
> = {
  SEA: {
    bl: 'HBL No.',
    carrier: 'Vessel Name',
    trip: 'Voyage No.',
    port: 'Clearance Port',
    eta: 'ETA Port',
    noun: 'Vessel',
    place: 'port',
    portKinds: ['SEA', 'DRY', 'RAIL'],
  },
  AIR: {
    bl: 'HAWB No.',
    carrier: 'Airline',
    trip: 'Flight No.',
    port: 'Clearance Airport',
    eta: 'ETA Airport',
    noun: 'Flight',
    place: 'airport',
    portKinds: ['AIR'],
  },
  ROAD: {
    bl: 'CMR / Waybill No.',
    carrier: 'Truck Plate No.',
    trip: 'Trip No.',
    port: 'Border Checkpoint',
    eta: 'ETA Border',
    noun: 'Truck',
    place: 'border',
    portKinds: ['LAND', 'DRY'],
  },
  // Not offered in the form; kept so a rail shipment still reads correctly.
  RAIL: {
    bl: 'Rail Waybill No.',
    carrier: 'Train / Wagon No.',
    trip: 'Trip No.',
    port: 'Clearance Station',
    eta: 'ETA Station',
    noun: 'Train',
    place: 'station',
    portKinds: ['RAIL', 'DRY'],
  },
};

/** Clearance points for a mode, plus the one already chosen if it is of another kind. */
const portsFor = (lookups: LookupsResponse, mode: Mode, current?: string | null) =>
  lookups.ports
    .filter((p) => MODE[mode].portKinds.includes(p.kind) || p.id === current)
    .map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }));

const DIRECTIONS = [
  { value: 'EXPORT', label: 'Export', sub: 'Goods shipped out of Cambodia', icon: '↗' },
  { value: 'IMPORT', label: 'Import', sub: 'Goods arriving into Cambodia', icon: '↙' },
];

const TONE: Record<string, string> = {
  COMPLETED: 'done',
  CLEARED: 'done',
  IN_PROGRESS: 'progress',
  PENDING: 'pending',
  EXCEPTION: 'exception',
};

export function ShipmentFormPage() {
  const { id } = useParams();
  const existing = useShipment(id);
  const lookups = useLookups();
  if ((id && existing.isLoading) || lookups.isLoading)
    return (
      <section className="view active">
        <div className="card">Loading…</div>
      </section>
    );
  if (existing.error || lookups.error)
    return (
      <section className="view active">
        <ErrorBanner error={existing.error ?? lookups.error} />
        <BackLink to="/plans" label="Back to Shipping Plans" />
      </section>
    );
  return <ShipmentForm key={id ?? 'new'} detail={existing.data} lookups={lookups.data!} />;
}

function ShipmentForm({
  detail,
  lookups,
}: {
  detail?: ShipmentDetail | undefined;
  lookups: LookupsResponse;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const { can, user } = useAuth();
  const save = useSaveShipment();
  const del = useDeleteShipment();
  const firstActiveClient = lookups.clients.find((c) => c.status !== 'INACTIVE')?.id ?? '';
  const methods = useForm<FormValues>({
    resolver: formResolver(shipmentInputSchema),
    // A new shipment starts assigned to whoever creates it.
    defaultValues: detail
      ? fromDetail(detail)
      : { ...emptyForm('EXPORT', firstActiveClient), assignedToId: user?.id ?? '' },
    mode: 'onTouched',
  });
  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors, isDirty },
  } = methods;
  const [direction, transportMode, loadType, clientId, atd, arriveFty, decls] = useWatch({
    control,
    name: [
      'direction',
      'transportMode',
      'loadType',
      'clientId',
      'atd',
      'arriveFty',
      'declarations',
    ],
  });
  // "?tab=documents" (from the list's row menu) opens the last tab, Documents.
  const [search] = useSearchParams();
  const [step, setStep] = useState(() => (search.get('tab') === 'documents' ? 99 : 0));
  const [violations, setViolations] = useState<OverImportViolation[] | null>(null);
  const readOnly = !can('shipments:write');
  const clientLocked = !!detail && detail.declarations.some((d) => d.hasLedgerEntry);

  // Air has no terms (stored as NONE, so neither option shows selected).
  useEffect(() => {
    if (transportMode === 'AIR') setValue('loadType', 'NONE');
  }, [transportMode, setValue]);

  // Picking another freight mode: a clearance point of the wrong kind is cleared, or replaced
  // by the only one that fits (Air → the airport).
  const changeMode = () => {
    const mode = methods.getValues('transportMode');
    if (loadType === 'NONE' && mode !== 'AIR') setValue('loadType', 'FCL');
    const fits = portsFor(lookups, mode);
    const port = methods.getValues('clearancePortId');
    if (port && fits.some((p) => p.value === port)) return;
    setValue('clearancePortId', fits.length === 1 ? fits[0]!.value : '', { shouldDirty: true });
  };

  // An import's consignee starts as the client itself (its factory-side consignee) when the
  // client or direction is picked, replacing one that was blank, filled in this way, or
  // another client's own. Any other consignee chosen by hand is kept; a saved shipment is
  // left as it was until its client is changed.
  const autoConsignee = useRef<string | null>(null);
  const firstPick = useRef(true);
  useEffect(() => {
    const skip = firstPick.current && !!detail;
    firstPick.current = false;
    if (skip || direction !== 'IMPORT') return;
    // The one named as the client's legal name, else its Cambodian one, else any of its own.
    const legal = lookups.clients
      .find((c) => c.id === clientId)
      ?.legalName?.trim()
      .toLowerCase();
    const own =
      (legal && lookups.consignees.find((c) => c.name.trim().toLowerCase() === legal)) ||
      lookups.consignees.find((c) => c.clientId === clientId && c.countryIso2 === 'KH') ||
      lookups.consignees.find((c) => c.clientId === clientId);
    const now = methods.getValues('consigneeId') ?? '';
    const owner = lookups.consignees.find((c) => c.id === now)?.clientId;
    const replaceable = !now || now === autoConsignee.current || (!!owner && owner !== clientId);
    if (!replaceable) return;
    autoConsignee.current = own?.id ?? null;
    setValue('consigneeId', own?.id ?? '', { shouldDirty: !!detail });
  }, [clientId, direction, detail, lookups.clients, lookups.consignees, methods, setValue]);

  // Which invoice the items list shows; "Enter items →" opens it and scrolls down to it.
  const [cargoInvoice, setCargoInvoice] = useState(0);
  const openItems = (gi: number) => {
    setCargoInvoice(gi);
    requestAnimationFrame(() =>
      document.getElementById(ITEMS_ANCHOR)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };

  // The workflow and the status boxes follow the whole form as it is typed.
  const values = useWatch({ control }) as Partial<FormValues>;
  const stages = stagesOf(values);
  const assignee = lookups.staff.find((u) => u.id === values.assignedToId);

  // Client, Import / Export, freight mode and terms: the first thing on the General tab.
  const setup = (
    <div className="cx-card">
      <div className={f.setupClient}>
        <div className={f.setupField}>
          <label className={f.cap} htmlFor="f-clientId">
            Client
          </label>
          <select
            id="f-clientId"
            className={`form-select-box ${f.clientSelect}`}
            {...register('clientId')}
            disabled={clientLocked}
            title={
              clientLocked
                ? 'Locked: a declaration of this shipment is already in the ledger'
                : undefined
            }
          >
            {lookups.clients
              .filter((c) => c.status !== 'INACTIVE' || c.id === detail?.clientId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        <div className={f.setupField}>
          <label className={f.cap} htmlFor="f-assignedToId">
            Assigned Staff
          </label>
          <select id="f-assignedToId" className="form-select-box" {...register('assignedToId')}>
            <option value="">Not assigned</option>
            {lookups.staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <label className={f.checkRow}>
          <input type="checkbox" {...register('isUrgent')} />
          Urgent
        </label>
      </div>
      <div className={f.setupChoices}>
        <DirectionTiles onChange={() => setStep(0)} />
        <Segmented name="transportMode" label="Freight" options={FREIGHT} onChange={changeMode} />
        <Segmented
          name="loadType"
          label="Terms"
          options={TERMS}
          disabled={transportMode === 'AIR'}
        />
      </div>
    </div>
  );

  const steps = buildSteps(direction, transportMode, lookups, detail, stages, {
    setup,
    cargoInvoice,
    setCargoInvoice,
    openItems,
    // Declared below with the other save handlers; looked up when clicked.
    saveNow: () => saveNow(),
  });
  const current = Math.min(step, steps.length - 1);
  const isLast = current === steps.length - 1;
  const tabOf = (key: StageKey) => steps.findIndex((s) => s.stage === key);

  const onInvalid = (errs: FieldErrors<FormValues>) => {
    const keys = Object.keys(errs) as (keyof FormValues)[];
    const target = steps.findIndex((s) => s.fields.some((k) => keys.includes(k)));
    // Errors on invoice items: show the first invoice with one.
    const inv = invoiceErrorsOf(errs);
    if (inv.lines && !inv.head) setCargoInvoice(inv.firstLines);
    if (target >= 0) setStep(target);
    toast(`Check ${keys.length} highlighted field${keys.length === 1 ? '' : 's'} before saving.`);
  };

  /** Saves; true when it went through. */
  const onValid = async (values: FormValues): Promise<boolean> => {
    setViolations(null);
    try {
      const saved = await save.mutateAsync({ id: detail?.id, body: values });
      toast(detail ? `${saved.reference} saved.` : `Shipment ${saved.reference} created.`);
      // What is on screen is now what is saved: no longer "Unsaved changes".
      methods.reset(methods.getValues());
      navigate(`/plans/${saved.id}`, { replace: true });
      return true;
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.details as { rule?: string } | undefined)?.rule === 'CUT_STOCK_OVER_IMPORT'
      ) {
        setViolations((e.details as { violations: OverImportViolation[] }).violations);
        // The Invoice / PL tab, where the quantities and override reasons are entered.
        const itemsTab = tabOf('invpl');
        if (itemsTab >= 0) setStep(itemsTab);
      }
      return false;
    }
  };
  const submit = handleSubmit(async (v) => void (await onValid(cleanForSubmit(v))), onInvalid);
  /** Save from inside a tab (e.g. before printing a letter); true when it went through. */
  const saveNow = async () => {
    let ok = false;
    await handleSubmit(async (v) => {
      ok = await onValid(cleanForSubmit(v));
    }, onInvalid)();
    return ok;
  };

  const remove = async () => {
    if (
      !detail ||
      !window.confirm(
        `Delete ${detail.reference}? Its CDC lines will be released back to the cut-stock balance.`,
      )
    )
      return;
    try {
      await del.mutateAsync(detail.id);
      toast(`${detail.reference} deleted.`);
      navigate('/plans');
    } catch {
      /* shown in banner */
    }
  };

  const [exporting, setExporting] = useState(false);
  /** Why Export INV + PL can't run yet (shown as the button's tooltip), or null when it can. */
  const exportBlocked = !detail
    ? null
    : isDirty
      ? 'Save your changes first'
      : detail.invoices.length === 0
        ? 'Add the cargo invoices first (Invoice / PL tab)'
        : null;
  /**
   * JR's "INV + PL" workbook: the commercial invoice and packing list side by side; for an
   * import also the customs cover letter and the transfer of rights to the broker.
   */
  const exportInvPl = async () => {
    if (!detail) return;
    setExporting(true);
    try {
      await downloadFile(`/shipments/${detail.id}/invoice-packing-list.xlsx`);
    } catch {
      toast('Export failed. Check the cargo invoices and try again.');
    } finally {
      setExporting(false);
    }
  };

  const cancel = () => {
    if (isDirty && !window.confirm('Discard your changes?')) return;
    if (detail) navigate('/plans');
    else navigate(-1);
  };

  // Worked out from the dates and declarations as they are typed (the server does the same).
  const shipStatus = shipmentStatusOf({ direction, atd, arriveFty, declarations: decls });
  const clearStatus = clearanceStatusOf({ declarations: decls });
  const clientName =
    lookups.clients.find((c) => c.id === clientId)?.name ?? detail?.clientName ?? '';
  const metaParts = [
    clientName,
    DIRECTIONS.find((d) => d.value === direction)?.label,
    `By ${FREIGHT.find((x) => x.value === transportMode)?.label.toLowerCase() ?? ''}`,
    TERMS.find((t) => t.value === loadType)?.label,
  ].filter(Boolean);

  return (
    <section className="view active">
      <FormProvider {...methods}>
        <form
          className={f.page}
          // Enter in a field moves to the next tab; only the last tab saves on Enter.
          onSubmit={(e) => {
            e.preventDefault();
            if (isLast) void submit();
            else setStep(current + 1);
          }}
          noValidate
        >
          {/* ---------- Header ---------- */}
          <div className={backRow}>
            <BackLink to="/plans" label="Shipping Plans" />
            <div className={f.header}>
              <div style={{ minWidth: 0 }}>
                <div className={f.titleRow}>
                  <h2 className={f.title}>{detail ? detail.reference : 'New shipment'}</h2>
                  {detail ? (
                    <>
                      <span className={f.badge} data-tone={TONE[shipStatus]}>
                        {SHIPMENT_STATUS_LABEL[shipStatus]}
                      </span>
                      <span className={f.badge} data-tone={TONE[clearStatus]}>
                        {CLEARANCE_STATUS_LABEL[clearStatus]}
                      </span>
                    </>
                  ) : (
                    <span className={f.badge} data-tone="draft">
                      Draft
                    </span>
                  )}
                  {values.isUrgent && (
                    <span className={f.badge} data-tone="exception">
                      Urgent
                    </span>
                  )}
                </div>
                <div className={f.meta}>
                  <span>
                    <strong>{metaParts[0]}</strong>
                    {metaParts.length > 1 ? ` · ${metaParts.slice(1).join(' · ')}` : ''}
                  </span>
                  {detail && (
                    <span>
                      Updated{' '}
                      {new Date(detail.updatedAt).toLocaleString('en-GB', {
                        timeZone: 'Asia/Phnom_Penh',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>
              </div>
              <div className={f.headerActions}>
                <div className={f.owner}>
                  <span className={f.avatar} aria-hidden="true">
                    {assignee ? initialsOf(assignee.name) : '–'}
                  </span>
                  <span>
                    <b>{assignee?.name ?? 'Not assigned'}</b>
                    Assigned staff
                  </span>
                </div>
                {detail && (
                  <button
                    type="button"
                    className={f.exportBtn}
                    onClick={() => void exportInvPl()}
                    // Always shown on a saved shipment; greyed out (with the reason) until it can run.
                    disabled={exporting || !!exportBlocked}
                    title={
                      exportBlocked ??
                      (detail.direction === 'IMPORT'
                        ? 'Invoice + packing list, customs cover letter and transfer of rights in Excel'
                        : 'Invoice + packing list in Excel, one sheet per invoice')
                    }
                  >
                    {icons.download({})}
                    {exporting ? 'Exporting…' : 'Export INV + PL'}
                  </button>
                )}
                {detail && can('shipments:delete') && (
                  <button
                    type="button"
                    className={f.deleteBtn}
                    onClick={() => void remove()}
                    disabled={del.isPending}
                  >
                    {icons.trash({})}
                    Delete shipment
                  </button>
                )}
              </div>
            </div>
          </div>

          <fieldset disabled={readOnly} style={{ border: 'none', minWidth: 0, padding: 0 }}>
            <div className={f.stack}>
              <Tracker
                stages={stages}
                open={steps[current]!.stage}
                onOpen={(key) => setStep(Math.max(0, tabOf(key)))}
              />
              {shipStatus === 'COMPLETED' && clearStatus !== 'CLEARED' && (
                <div role="alert" className={f.warn}>
                  This shipment counts as Completed, but customs is not cleared yet: add the Declare
                  No. and Declare Date.{' '}
                  <button
                    type="button"
                    className="filter-mini-link"
                    onClick={() => setStep(Math.max(0, tabOf('clearance')))}
                  >
                    Go to Clearance
                  </button>
                </div>
              )}

              {/* ---------- Tabs: General, then one per workflow stage ---------- */}
              <div className={f.tabs} role="tablist" aria-label="Shipment sections">
                {steps.map((s, i) => {
                  const done = !!s.stage && !!stages.find((x) => x.key === s.stage)?.done;
                  const hasError = s.fields.some((k) => k in errors);
                  return (
                    <button
                      type="button"
                      role="tab"
                      key={s.label}
                      className={f.tab}
                      aria-selected={i === current}
                      data-done={done}
                      data-error={hasError}
                      onClick={() => setStep(i)}
                    >
                      <span className={f.tabIcon} aria-hidden="true">
                        {hasError ? '!' : done ? '✓' : ''}
                      </span>
                      {s.label}
                    </button>
                  );
                })}
              </div>

              <ErrorBanner error={violations ? null : (save.error ?? del.error)} />
              {violations && (
                <div
                  role="alert"
                  style={{
                    borderRadius: 8,
                    padding: '10px 14px',
                    background: 'var(--status-exception-bg)',
                    color: 'var(--status-exception-fg)',
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  These invoice items exceed the remaining CDC balance:
                  <ul style={{ margin: '6px 0 0 18px', fontWeight: 600 }}>
                    {violations.map((v) => (
                      <li key={v.cutStockItemId}>
                        {v.declareRef} {v.itemName}: balance {v.balance}, importing {v.requested}
                      </li>
                    ))}
                  </ul>
                  {can('cutstock:override')
                    ? 'Lower the quantity, or enter a reason on the item to approve it.'
                    : 'Lower the quantity, or ask a Manager to approve the extra quantity.'}
                </div>
              )}

              {steps[current]!.render()}
            </div>
          </fieldset>

          {/* ---------- Sticky action bar ---------- */}
          <div className={f.actionBar}>
            <div className={f.progress}>
              <span>
                Tab <strong>{current + 1}</strong> of {steps.length} ·{' '}
                <strong>{steps[current]!.label}</strong>
              </span>
              {isDirty && !readOnly && <span className={f.dirty}>Unsaved changes</span>}
            </div>
            <div className={f.buttons}>
              <button type="button" className="btn-cancel-shipment" onClick={cancel}>
                {readOnly ? 'Close' : 'Cancel'}
              </button>
              {current > 0 && (
                <button
                  type="button"
                  className="btn-cancel-shipment"
                  onClick={() => setStep(current - 1)}
                >
                  ← Back
                </button>
              )}
              {!isLast && (
                <button
                  type="button"
                  className={f.secondaryNext}
                  onClick={() => setStep(current + 1)}
                >
                  Next →
                </button>
              )}
              {!readOnly && (
                <button
                  type="button"
                  className="btn-create-submit"
                  disabled={save.isPending}
                  onClick={() => void submit()}
                >
                  {save.isPending ? 'Saving…' : detail ? 'Save changes' : 'Create shipment'}
                </button>
              )}
            </div>
          </div>
        </form>
      </FormProvider>
    </section>
  );
}

/* ------------------------------ Field helpers ------------------------------ */

/**
 * Authorize: the transfer of rights to us as customs broker. Once the invoice, the B/L, the
 * clearance port and this date are saved, the letter downloads as a PDF (the print dialog's
 * Save as PDF), worded and dated in Khmer like the customs form.
 */
function AuthorizeCard({
  shipmentId,
  saveNow,
}: {
  shipmentId: string | undefined;
  saveNow: () => Promise<boolean>;
}) {
  const {
    formState: { isDirty },
  } = useFormContext<FormValues>();
  const toast = useToast();
  const letter = useAuthorizeLetter(shipmentId);
  const [busy, setBusy] = useState(false);
  const missing = !shipmentId ? ['Create the shipment first'] : (letter.data?.missing ?? []);
  // Unsaved changes are saved on the click, so they may be what fills in a missing item.
  const blocked = !shipmentId
    ? 'Create the shipment first'
    : letter.isLoading
      ? 'Checking…'
      : !isDirty && missing.length
        ? 'Fill in what is listed below first'
        : null;

  /** View in a new tab, or download (the print dialog's Save as PDF); saves first if needed. */
  const open = async (how: 'view' | 'download') => {
    if (!shipmentId) return;
    // Opened inside the click, before anything is awaited, so the browser allows the tab.
    const tab = how === 'view' ? window.open('about:blank', '_blank') : null;
    setBusy(true);
    try {
      if (isDirty && !(await saveNow())) {
        tab?.close();
        return;
      }
      const fresh = (await letter.refetch()).data;
      if (!fresh || fresh.missing.length) {
        tab?.close();
        toast(`The letter still needs: ${(fresh?.missing ?? ['the saved shipment']).join(', ')}`);
        return;
      }
      const url = `/print/authorize/${shipmentId}`;
      if (tab) tab.location.href = url;
      else printInPlace(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cx-card">
      <div className="cx-card-head">
        <div className="cx-title">
          <div>
            <h3>Authorize</h3>
          </div>
        </div>
        <div className="cargo-actions">
          <button
            type="button"
            className="cargo-btn"
            disabled={!!blocked || busy}
            title={blocked ?? 'Opens the letter in a new tab'}
            onClick={() => void open('view')}
          >
            View
          </button>
          <button
            type="button"
            className="cargo-btn cargo-btn-primary"
            disabled={!!blocked || busy}
            title={blocked ?? 'Opens the print dialog: choose Save as PDF'}
            onClick={() => void open('download')}
          >
            {busy ? 'Preparing…' : isDirty ? '⇣ Save & Download PDF' : '⇣ Download PDF'}
          </button>
        </div>
      </div>
      <div className={f.formCols} style={{ gridTemplateColumns: '1fr 1fr' }}>
        <FormSection title="Letter">
          <Field name="authorizeNo" label="Authorize No." />
          <Field name="authorizeDate" label="Authorize Date" type="date" />
        </FormSection>
        <FormSection title="Taken from this shipment">
          {missing.length ? (
            <ul className={f.checklist}>
              {missing.map((m) => (
                <li key={m} data-ok="false">
                  {m}
                </li>
              ))}
            </ul>
          ) : (
            <ul className={f.checklist}>
              {letter.data?.letter?.documents.map((d) => (
                <li key={d.label} data-ok="true">
                  {d.label.replace('លេខ', '')}: <b>{d.no}</b>
                </li>
              ))}
              <li data-ok="true">{letter.data?.letter?.office}</li>
            </ul>
          )}
          {isDirty && (
            <p className={f.note}>Unsaved changes are saved when you view or download.</p>
          )}
        </FormSection>
      </div>
    </div>
  );
}

/** One titled column of a form, with a rule under the title (as on the NSW forms). */
function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={f.formSection}>
      <h4 className={f.formSectionTitle}>{title}</h4>
      {children}
    </section>
  );
}

/** "Sokha Chan" → "SC". */
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Permit status as one row of choices. */
function PermitStatusPicker() {
  const { register } = useFormContext<FormValues>();
  return (
    <fieldset className={f.setupField} style={{ gridColumn: '1 / -1' }}>
      <legend className={f.cap} style={{ marginBottom: 8 }}>
        Permit Status
      </legend>
      <div className={f.segmented}>
        {PERMIT_STATUSES.map((v) => (
          <label key={v} className={f.segOpt}>
            <input type="radio" value={v} {...register('permitStatus')} />
            <span>{PERMIT_STATUS_LABEL[v]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PodField() {
  const { register } = useFormContext<FormValues>();
  return (
    <div className="form-field-group">
      <label htmlFor="f-podReceived">Proof of Delivery</label>
      <label className={f.checkRow}>
        <input id="f-podReceived" type="checkbox" {...register('podReceived')} />
        POD received
      </label>
    </div>
  );
}

type Span = number | 'full';
const spanStyle = (span?: Span): CSSProperties | undefined =>
  span === 'full' ? { gridColumn: '1 / -1' } : span ? { gridColumn: `span ${span}` } : undefined;

/** Export / Import as two large tiles, so the shipment type can't be mistaken for the client. */
function DirectionTiles({ onChange }: { onChange: () => void }) {
  const { register } = useFormContext<FormValues>();
  return (
    <fieldset className={f.setupField}>
      <legend className={f.cap} style={{ marginBottom: 8 }}>
        Shipment type
      </legend>
      <div className={f.typeTiles}>
        {DIRECTIONS.map((o) => (
          <label key={o.value} className={f.typeTile}>
            <input type="radio" value={o.value} {...register('direction', { onChange })} />
            <span>
              <i aria-hidden="true">{o.icon}</i>
              <b>{o.label}</b>
              <small>{o.sub}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Segmented({
  name,
  label,
  options,
  disabled,
  onChange,
}: {
  name: 'direction' | 'transportMode' | 'loadType';
  label: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange?: () => void;
}) {
  const { register } = useFormContext<FormValues>();
  return (
    <fieldset className={f.setupField} disabled={disabled}>
      <legend className={f.cap} style={{ marginBottom: 8 }}>
        {label}
      </legend>
      <div className={f.segmented}>
        {options.map((o) => (
          <label key={o.value} className={f.segOpt}>
            <input type="radio" value={o.value} {...register(name, { onChange })} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Field({
  name,
  label,
  type = 'text',
  span,
  placeholder,
  decimals,
}: {
  name: keyof FormValues;
  label: string;
  type?: string;
  span?: Span;
  placeholder?: string;
  /** A number field (digits only, shown with commas) with at most this many decimals. */
  decimals?: number;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const err = errors[name] as { message?: string } | undefined;
  return (
    <div className="form-field-group" style={spanStyle(span)}>
      <label htmlFor={`f-${name}`}>{label}</label>
      {decimals !== undefined ? (
        <NumberInput
          id={`f-${name}`}
          decimals={decimals}
          className="form-field-box"
          placeholder={placeholder ?? label}
          {...register(name)}
          aria-invalid={!!err}
        />
      ) : (
        <input
          id={`f-${name}`}
          type={type}
          className="form-field-box"
          placeholder={placeholder ?? label}
          title={type === 'text' ? undefined : label}
          {...register(name)}
          aria-invalid={!!err}
        />
      )}
      <FieldError message={err?.message} />
    </div>
  );
}

const CO_STATUSES = ['Pending', 'Draft', 'Submitted', 'Approved'];

/** CO Status: one of the four stages; an older free-text value stays selectable until changed. */
function CoStatusSelect() {
  const current = useWatch<FormValues, 'coStatus'>({ name: 'coStatus' }) ?? '';
  const options = [...CO_STATUSES, ...(current && !CO_STATUSES.includes(current) ? [current] : [])];
  return (
    <Select
      name="coStatus"
      label="CO Status"
      options={options.map((v) => ({ value: v, label: v }))}
      placeholder="Select status"
    />
  );
}

function Select({
  name,
  label,
  options,
  placeholder,
  span,
}: {
  name: keyof FormValues;
  label: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  span?: Span;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const err = errors[name] as { message?: string } | undefined;
  return (
    <div className="form-field-group" style={spanStyle(span)}>
      <label htmlFor={`f-${name}`}>{label}</label>
      <select id={`f-${name}`} className="form-select-box" {...register(name)} aria-invalid={!!err}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldError message={err?.message} />
    </div>
  );
}

/** The shipment status is not chosen: it is shown as it follows from the shipment's data. */
function ShipmentStatusField() {
  const { control } = useFormContext<FormValues>();
  const [direction, atd, arriveFty, declarations] = useWatch({
    control,
    name: ['direction', 'atd', 'arriveFty', 'declarations'],
  });
  const status = shipmentStatusOf({ direction, atd, arriveFty, declarations });
  const done = direction === 'IMPORT' ? 'ETA Factory' : 'ATD';
  return (
    <div className="form-field-group">
      <label>Shipment Status</label>
      <div>
        <span
          className={f.badge}
          data-tone={TONE[status]}
          title={`Set automatically: Completed once ${done} is filled in, In Progress once a customs declaration is recorded, otherwise Pending.`}
        >
          {SHIPMENT_STATUS_LABEL[status]}
        </span>
      </div>
    </div>
  );
}

/** The clearance status is not chosen either: it follows from the customs declarations. */
function ClearanceStatusField() {
  const { control } = useFormContext<FormValues>();
  const declarations = useWatch({ control, name: 'declarations' });
  const status = clearanceStatusOf({ declarations });
  return (
    <div className="form-field-group">
      <label>Clearance Status</label>
      <div>
        <span
          className={f.badge}
          data-tone={TONE[status]}
          title="Set automatically: Customs Cleared once a declaration has its Declare No. and Declare Date, In Progress once a Declare No. is entered, otherwise Pending Review."
        >
          {CLEARANCE_STATUS_LABEL[status]}
        </span>
      </div>
    </div>
  );
}

/** ETA + 2 working days (no Saturdays, Sundays or public holidays): when to unstuff. */
function EstUnstuffing() {
  const { control } = useFormContext<FormValues>();
  const eta = useWatch({ control, name: 'eta' });
  const year = Number(eta?.slice(0, 4)) || new Date().getFullYear();
  // The 2 days can run into January.
  const h1 = usePublicHolidays(year);
  const h2 = usePublicHolidays(year + 1);
  const holidays = new Set([...(h1.data ?? []), ...(h2.data ?? [])].map((h) => h.holidayDate));
  const date = eta ? addBusinessDays(eta, 2, holidays) : '';
  const weekday = date
    ? new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
        weekday: 'short',
        timeZone: 'UTC',
      })
    : '';
  return (
    <div className="form-field-group">
      <label>Est. Unstuffing</label>
      <div
        className={f.roBox}
        title="ETA + 2 working days (Saturdays, Sundays and public holidays not counted)"
      >
        {date ? `${weekday} ${fmtDate(date)}` : '—'}
      </div>
    </div>
  );
}

/** A titled section card; `cols` sets the grid (fields span 1 unless told otherwise). */
function Card({
  title,
  cols = 4,
  children,
}: {
  title: string;
  cols?: number;
  children: ReactNode;
}) {
  return (
    <div className="cx-card">
      <div className="cx-card-head">
        <div className="cx-title">
          <div>
            <h3>{title}</h3>
          </div>
        </div>
      </div>
      <div className={f.grid} style={{ '--cols': cols } as CSSProperties}>
        {children}
      </div>
    </div>
  );
}

/** The forwarder moving the goods; the shipper and consignee are on the Parties cards. */
function ForwarderField({ lookups }: { lookups: LookupsResponse }) {
  const { register } = useFormContext<FormValues>();
  const { can } = useAuth();
  const addForwarder = useAddForwarder();
  return (
    <div className="form-field-group" style={spanStyle(2)}>
      <label htmlFor="f-forwarderId">Forwarder</label>
      <AddNewSelect
        id="f-forwarderId"
        label="Forwarder"
        placeholder="Forwarder"
        registration={register('forwarderId')}
        options={lookups.forwarders.map((x) => ({ value: x.id, label: x.name }))}
        onCreate={
          can('shipments:write')
            ? async (name) => (await addForwarder.mutateAsync({ name })).id
            : undefined
        }
      />
    </div>
  );
}

function ContainersCard() {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const loadType = useWatch({ control, name: 'loadType' });
  const direction = useWatch({ control, name: 'direction' });
  const transportMode = useWatch({ control, name: 'transportMode' });
  const arr = useFieldArray({ control, name: 'containers' });
  const errs = errors.containers as unknown as
    (Record<number, Record<string, { message?: string }>> & { message?: string }) | undefined;
  // Air freight has no containers.
  if (transportMode === 'AIR') return null;
  if (loadType !== 'FCL')
    return (
      <Card title="Containers" cols={1}>
        <p className={f.note}>
          Containers are recorded for CY / CY (FCL) shipments only. Change Terms above to add them.
        </p>
      </Card>
    );
  return (
    <Card title="Containers" cols={1}>
      <div>
        {arr.fields.length > 0 && (
          <div className="cdc-lines-wrap">
            <table className="cdc-lines-table">
              <thead>
                <tr>
                  <th>Container No.</th>
                  <th>Size</th>
                  {direction === 'EXPORT' && <th>Liner Seal</th>}
                  {direction === 'EXPORT' && <th>Customs Seal</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {arr.fields.map((row, i) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        className="form-field-box"
                        placeholder="e.g. MRKU8974303"
                        {...register(`containers.${i}.containerNo`)}
                        aria-invalid={!!errs?.[i]?.containerNo}
                      />
                      <FieldError message={errs?.[i]?.containerNo?.message} />
                    </td>
                    <td>
                      <select className="form-field-box" {...register(`containers.${i}.size`)}>
                        <option value="">Size</option>
                        {CONTAINER_SIZES.map((s) => (
                          <option key={s} value={s}>
                            {s.replace(/^(\d\d)/, "$1'")}
                          </option>
                        ))}
                      </select>
                    </td>
                    {direction === 'EXPORT' && (
                      <td>
                        <input
                          className="form-field-box"
                          placeholder="Liner Seal"
                          {...register(`containers.${i}.linerSeal`)}
                        />
                      </td>
                    )}
                    {direction === 'EXPORT' && (
                      <td>
                        <input
                          className="form-field-box"
                          placeholder="Customs Seal"
                          {...register(`containers.${i}.customsSeal`)}
                        />
                      </td>
                    )}
                    <td>
                      <button
                        type="button"
                        className="cdc-remove-line-btn"
                        title="Remove container"
                        onClick={() => arr.remove(i)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <FieldError message={errs?.message} />
        <button
          type="button"
          className="cdc-add-line-btn"
          onClick={() => arr.append(blankContainer())}
        >
          + Add Container
        </button>
      </div>
    </Card>
  );
}

/* ------------------------------ Tabs ------------------------------ */

/** What the tabs need from the form: the setup card and which invoice's items are shown. */
interface TabContext {
  setup: ReactNode;
  cargoInvoice: number;
  setCargoInvoice: (gi: number) => void;
  openItems: (gi: number) => void;
  saveNow: () => Promise<boolean>;
}

/** General first, then one tab per workflow stage, in the tracker's order. */
function buildSteps(
  direction: FormValues['direction'],
  transportMode: Mode,
  lookups: LookupsResponse,
  detail: ShipmentDetail | undefined,
  stages: Stage[],
  ctx: TabContext,
): Step[] {
  const m = MODE[transportMode];
  const isImport = direction === 'IMPORT';
  const ports = portsFor(lookups, transportMode, detail?.clearancePortId);
  const units = lookups.values.QUANTITY_UNIT.map((v) => ({ value: v.value, label: v.label }));
  const materials = lookups.values.MATERIAL.map((v) => ({ value: v.value, label: v.label }));
  const coForms = lookups.values.CO_FORM.map((v) => ({ value: v.value, label: v.label }));

  const general: Step = {
    label: 'General',
    fields: isImport
      ? [
          'clientId',
          'loadType',
          'assignedToId',
          'isUrgent',
          'shipperName',
          'consigneeId',
          'originCountryIso2',
          'forwarderId',
          'broker',
          'quantity',
          'quantityUnit',
          'remark',
        ]
      : [
          'clientId',
          'loadType',
          'assignedToId',
          'isUrgent',
          'consigneeId',
          'destinationCountryIso2',
          'forwarderId',
          'quantity',
          'quantityUnit',
          'material',
          'remark',
        ],
    render: () => (
      <>
        {ctx.setup}
        <PartiesSection lookups={lookups} />
        {isImport ? (
          <Card title="Agents & Cargo">
            <ForwarderField lookups={lookups} />
            <Field name="broker" label="Broker" span={2} placeholder="Customs broker" />
            <Field name="quantity" label="Quantity" placeholder="0" decimals={3} />
            <Select name="quantityUnit" label="Unit" options={units} placeholder="Select unit" />
          </Card>
        ) : (
          <Card title="Forwarder & Cargo">
            <ForwarderField lookups={lookups} />
            <Field name="quantity" label="Quantity" placeholder="0" decimals={3} />
            <Select name="quantityUnit" label="Unit" options={units} placeholder="Select unit" />
            <Select
              name="material"
              label="Material"
              options={materials}
              placeholder="Select material"
              span={2}
            />
          </Card>
        )}
        <Card title="Remark" cols={1}>
          <Field name="remark" label="Remark" span="full" placeholder="Optional note" />
        </Card>
      </>
    ),
  };

  type Content = Omit<Step, 'label' | 'stage'>;
  const invpl: Content = {
    fields: ['invoices'],
    render: () => (
      <>
        <InvoicesSection
          shipmentId={detail?.id}
          active={ctx.cargoInvoice}
          onOpenItems={ctx.openItems}
        />
        <ItemsSection active={ctx.cargoInvoice} onActive={ctx.setCargoInvoice} />
        {/* Imports: the set handed in to apply for the import permit. */}
        {isImport && <PermitSetCard shipmentId={detail?.id} saveNow={ctx.saveNow} />}
      </>
    ),
  };
  const charge: Content = {
    fields: ['thcHblNo', 'thcHblDate', 'thcHblAmount'],
    render: () => (
      <Card title="Invoice Charge">
        <Field name="thcHblNo" label="Invoice / THC No." span={2} />
        <Field name="thcHblDate" label="Invoice / THC Date" type="date" />
        <Field name="thcHblAmount" label="Amount (USD)" placeholder="0.00" decimals={2} />
      </Card>
    ),
  };
  const clearance: Content = {
    fields: ['declarations'],
    render: () => (
      <>
        <DeclarationsSection ports={lookups.ports} original={detail} />
        <Card title="Status" cols={2}>
          <ShipmentStatusField />
          <ClearanceStatusField />
        </Card>
      </>
    ),
  };

  const content: Partial<Record<StageKey, Content>> = isImport
    ? {
        hbl: {
          fields: ['hblNo', 'vesselName', 'voyageNo', 'clearancePortId', 'coNumber', 'containers'],
          render: () => (
            <>
              <Card title={`${m.noun} & House Bill`}>
                <Field name="hblNo" label={m.bl} span={2} />
                <Select
                  name="clearancePortId"
                  label={m.port}
                  options={ports}
                  placeholder="Select"
                  span={2}
                />
                <Field name="vesselName" label={m.carrier} span={2} />
                <Field name="voyageNo" label={m.trip} />
                <Field name="coNumber" label="CO Number" />
              </Card>
              <ContainersCard />
            </>
          ),
        },
        invpl,
        permit: {
          fields: ['permitStatus', 'permitNo', 'permitDate'],
          render: () => (
            <Card title="Permit" cols={2}>
              <PermitStatusPicker />
              <Field name="permitNo" label="Permit No." />
              <Field name="permitDate" label="Permit Date" type="date" />
            </Card>
          ),
        },
        // Released together by the forwarder, so entered in one form.
        // The arrival notice only matters for its ETA (unstuffing is 2 working days later);
        // then the forwarder's THC invoice and the DO date.
        release: {
          fields: ['eta', 'thcHblNo', 'thcHblDate', 'thcHblAmount', 'doDate'],
          render: () => (
            <div className="cx-card">
              <div className="cx-card-head">
                <div className="cx-title">
                  <div>
                    <h3>Arrival &amp; DO</h3>
                  </div>
                </div>
              </div>
              <div className={f.formCols}>
                <FormSection title="Arrival">
                  <Field name="eta" label={m.eta} type="date" />
                  <EstUnstuffing />
                </FormSection>
                <FormSection title="Invoice / THC">
                  <Field name="thcHblNo" label="Invoice / THC No." />
                  <Field name="thcHblDate" label="Invoice / THC Date" type="date" />
                  <Field name="thcHblAmount" label="Amount (USD)" placeholder="0.00" decimals={2} />
                </FormSection>
                <FormSection title="DO / EDO">
                  <Field name="doDate" label="DO / EDO Date" type="date" />
                </FormSection>
              </div>
            </div>
          ),
        },
        authorize: {
          fields: ['authorizeNo', 'authorizeDate'],
          render: () => <AuthorizeCard shipmentId={detail?.id} saveNow={ctx.saveNow} />,
        },
        clearance,
        delivery: {
          fields: ['truckNo', 'driverName', 'driverPhone', 'arriveFty', 'podReceived'],
          render: () => (
            <Card title="Delivery">
              <Field name="truckNo" label="Truck Plate No." placeholder="e.g. 3A-2291" />
              <Field name="driverName" label="Driver" />
              <Field name="driverPhone" label="Driver Phone" placeholder="012 345 678" />
              <Field name="arriveFty" label="Arrive Factory" type="date" />
              <PodField />
              <ShipmentStatusField />
            </Card>
          ),
        },
      }
    : {
        booking: {
          fields: ['bookingNo', 'crd', 'cutOffAt', 'etd', 'clearancePortId'],
          render: () => (
            <Card title="Booking">
              <Field name="bookingNo" label="Booking / SO No." span={2} />
              <Field name="crd" label="CRD (Cargo Ready)" type="date" />
              <Field name="etd" label="ETD" type="date" />
              {/* Air: the airline's cut-off; a follow-up reminds 48 hours before it. */}
              {transportMode === 'AIR' && (
                <Field name="cutOffAt" label="Cut-off (Date & Time)" type="datetime-local" />
              )}
              <Select
                name="clearancePortId"
                label={m.port}
                options={ports}
                placeholder="Select"
                span={2}
              />
            </Card>
          ),
        },
        invpl,
        container: { fields: ['containers'], render: () => <ContainersCard /> },
        clearance,
        departure: {
          fields: ['vesselName', 'voyageNo', 'atd'],
          render: () => (
            <Card title="Departure">
              <Field name="vesselName" label={m.carrier} span={2} />
              <Field name="voyageNo" label={m.trip} />
              <Field name="atd" label="ATD (Actual Departure)" type="date" />
            </Card>
          ),
        },
        bl: {
          fields: ['hblNo'],
          render: () => (
            <Card title={m.bl.replace(' No.', ' Release')} cols={2}>
              <Field name="hblNo" label={m.bl} />
            </Card>
          ),
        },
        charge,
        co: {
          fields: ['coForm', 'coNumber', 'coStatus'],
          render: () => (
            <Card title="Certificate of Origin">
              <Select name="coForm" label="CO Form" options={coForms} placeholder="Select form" />
              <Field name="coNumber" label="CO Number" span={2} />
              <CoStatusSelect />
            </Card>
          ),
        },
      };

  // Every shipment ends with its documents, whatever its workflow.
  const documents: Step = {
    label: 'Documents',
    fields: [],
    render: () => <DocumentsTab shipmentId={detail?.id} reference={detail?.reference} />,
  };
  return [
    general,
    ...stages.map((st) => ({ stage: st.key, label: st.label, ...content[st.key]! })),
    documents,
  ];
}
