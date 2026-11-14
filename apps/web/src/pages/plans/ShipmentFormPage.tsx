import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  FormProvider,
  useFieldArray,
  useForm,
  useController,
  useFormContext,
  useWatch,
  type Control,
  type FieldErrors,
} from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { BackLink, backRow } from '../../components/BackLink';
import {
  CLEARANCE_STATUS_LABEL,
  clearanceStatusFor,
  clearanceStatusOf,
  COMPLETION_MILESTONE_LABEL,
  CONTAINER_SIZES,
  DEFAULT_COMPLETION,
  INCOTERM_LABEL,
  INCOTERMS,
  shipmentStatusOf,
  SHIPMENT_STATUS_LABEL,
  shipmentInputSchema,
  type LookupsResponse,
  type OverImportViolation,
  type ShipmentDetail,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import {
  useAddCoForm,
  useAddMaterial,
  useAddConsignee,
  useAddForwarder,
  useDeleteShipment,
  useLookups,
  useSaveShipment,
  useShipment,
} from '../../features/hooks';
import { CountrySelect } from '../../components/CountrySelect';
import { ErrorBanner, FieldError } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import { ApiError } from '../../lib/api';
import { downloadFile } from '../../lib/files';
import { formResolver } from '../../lib/zodForm';
import { AddNewSelect } from './AddNewSelect';
import { CargoSection, DotsMenu } from './CargoSection';
import { DeclarationsSection } from './DeclarationsSection';
import { SupportDocumentsModal } from './SupportDocuments';
import {
  blankContainer,
  cleanForSubmit,
  DEFAULT_BROKER,
  emptyForm,
  fromDetail,
  toNum,
  type FormValues,
} from './formModel';
import f from './ShipmentForm.module.css';
import { fi, type FormIcon } from './formIcons';

interface Step {
  label: string;
  /** Top-level form fields shown in this step (used to jump to the first error). */
  fields: (keyof FormValues)[];
  /** `general` is the General Information card, for a tab that places it itself. */
  render: (general: ReactNode) => ReactNode;
  /** The tab lays out the General Information card itself (an import's first tab). */
  placesGeneral?: boolean;
}

type Choice = { value: string; label: string };
/** Freight methods: named in full in the dropdown, short in the header ("By Sea"). */
const FREIGHT: (Choice & { short: string })[] = [
  { value: 'SEA', short: 'By Sea', label: 'Ocean Freight (Sea)' },
  { value: 'AIR', short: 'By Air', label: 'Air Freight' },
  { value: 'ROAD', short: 'By Truck', label: 'Road Freight (Truck)' },
  { value: 'RAIL', short: 'By Rail', label: 'Rail Freight' },
];
/** Shipping terms: spelled out in the dropdown, short in the header. */
const TERMS: (Choice & { short: string })[] = [
  { value: 'FCL', short: 'CY / CY', label: 'CY / CY (FCL, Full Container Load)' },
  { value: 'LCL', short: 'CFS / CFS (LCL)', label: 'CFS / CFS (LCL, Less Than Container Load)' },
];
/** Air freight has no CY / CY or LCL terms. */
const AIR_TERMS: Choice[] = [{ value: 'NONE', label: 'None (air freight)' }];
const DIRECTIONS: Choice[] = [
  { value: 'IMPORT', label: 'Import' },
  { value: 'EXPORT', label: 'Export' },
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
  const { can } = useAuth();
  const save = useSaveShipment();
  const del = useDeleteShipment();
  const firstActiveClient = lookups.clients.find((c) => c.status !== 'INACTIVE')?.id ?? '';
  const methods = useForm<FormValues>({
    resolver: formResolver(shipmentInputSchema),
    defaultValues: detail ? fromDetail(detail) : emptyForm('EXPORT', firstActiveClient),
    mode: 'onTouched',
  });
  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors, isDirty },
  } = methods;
  const [direction, transportMode, loadType, clientId, decls, storedClearance] = useWatch({
    control,
    name: ['direction', 'transportMode', 'loadType', 'clientId', 'declarations', 'clearanceStatus'],
  });
  const [step, setStep] = useState(0);
  const [violations, setViolations] = useState<OverImportViolation[] | null>(null);
  // A saved shipment opens for viewing; ⋯ → Edit unlocks it. New ones start editable.
  const [editing, setEditing] = useState(!detail);
  const [supportDocs, setSupportDocs] = useState(false);
  const readOnly = !can('shipments:write') || !editing;
  const clientLocked = !!detail && detail.declarations.some((d) => d.hasLedgerEntry);

  // Air has no terms (stored as NONE, so neither option shows selected).
  useEffect(() => {
    if (transportMode === 'AIR') setValue('loadType', 'NONE');
  }, [transportMode, setValue]);

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

  // An export's shipper is the client itself, by its legal name in English: set when the client
  // or direction is picked, replacing one that was blank or filled in this way. A saved shipment
  // is left as it was until its client is changed; an import's shipper is its supplier, typed.
  const autoShipper = useRef<string | null>(null);
  const firstShipperPick = useRef(true);
  useEffect(() => {
    const skip = firstShipperPick.current && !!detail;
    firstShipperPick.current = false;
    if (skip) return;
    const now = methods.getValues('shipperName') ?? '';
    const replaceable = !now.trim() || now === autoShipper.current;
    if (!replaceable) return;
    const client = lookups.clients.find((c) => c.id === clientId);
    const legal = direction === 'EXPORT' ? client?.legalName?.trim() || client?.name || '' : '';
    autoShipper.current = legal || null;
    if (legal !== now) setValue('shipperName', legal, { shouldDirty: !!detail });
  }, [clientId, direction, detail, lookups.clients, methods, setValue]);

  const steps = useMemo(
    () => buildSteps(direction, transportMode, lookups, detail, readOnly),
    [direction, transportMode, lookups, detail, readOnly],
  );
  const current = Math.min(step, steps.length - 1);
  const isLast = current === steps.length - 1;

  const onInvalid = (errs: FieldErrors<FormValues>) => {
    const keys = Object.keys(errs) as (keyof FormValues)[];
    const target = steps.findIndex((s) => s.fields.some((k) => keys.includes(k)));
    if (target >= 0) setStep(target);
    toast(`Check ${keys.length} highlighted field${keys.length === 1 ? '' : 's'} before saving.`);
  };

  const onValid = async (values: FormValues) => {
    setViolations(null);
    try {
      const saved = await save.mutateAsync({ id: detail?.id, body: values });
      toast(detail ? `${saved.reference} saved.` : `Shipment ${saved.reference} created.`);
      // A saved shipment goes back to viewing, with the saved values as the new starting point.
      if (detail) {
        methods.reset(fromDetail(saved));
        setEditing(false);
      }
      navigate(`/plans/${saved.id}`, { replace: true });
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.details as { rule?: string } | undefined)?.rule === 'CUT_STOCK_OVER_IMPORT'
      ) {
        setViolations((e.details as { violations: OverImportViolation[] }).violations);
        // The invoice items step, where the quantities and override reasons are entered.
        const itemsStep = steps.findIndex((s) => s.fields.includes('invoices'));
        if (itemsStep >= 0) setStep(itemsStep);
      }
    }
  };
  const submit = handleSubmit((v) => onValid(cleanForSubmit(v)), onInvalid);

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
        ? detail.direction === 'EXPORT'
          ? 'Add the cargo invoices first (Cargo, Pricing & FOB)'
          : 'Add the cargo invoices first (Item, Costing & Forwarding)'
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

  /** ⋯ → Cancel Edit: drop the changes and go back to viewing. */
  const cancelEdit = () => {
    if (isDirty && !window.confirm('Discard your changes?')) return;
    methods.reset();
    setViolations(null);
    setEditing(false);
  };

  // Worked out from the dates and declarations as they are typed (the server does the same).
  const shipStatus = useLiveShipmentStatus(control, lookups).status;
  const clearStatus = clearanceStatusFor({ clearanceStatus: storedClearance, declarations: decls });
  const clientName =
    lookups.clients.find((c) => c.id === clientId)?.name ?? detail?.clientName ?? '';
  const metaParts = [
    clientName,
    DIRECTIONS.find((d) => d.value === direction)?.label,
    FREIGHT.find((x) => x.value === transportMode)?.short,
    TERMS.find((t) => t.value === loadType)?.short,
  ].filter(Boolean);
  // Editing an existing record: save from any step. New record: walk the steps, create at the end.
  const canSaveHere = !!detail || isLast;

  // Ctrl+S (⌘S on a Mac) does what the Save button does; when it can't save, it says why
  // instead of opening the browser's "Save page" dialog.
  const saveShortcut = useRef<() => void>(() => {});
  saveShortcut.current = () => {
    if (!can('shipments:write')) toast('View only: this shipment cannot be changed.');
    else if (readOnly) toast('Choose Edit in the ⋯ menu to make changes.');
    else if (!canSaveHere) toast('Fill in each tab; the shipment is created on the last one.');
    else if (!save.isPending) void submit();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 's')
        return;
      e.preventDefault();
      if (!e.repeat) saveShortcut.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const updatedAt =
    detail &&
    new Date(detail.updatedAt).toLocaleString('en-GB', {
      timeZone: 'Asia/Phnom_Penh',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  const statusBadges = detail ? (
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
  );

  // The client as the title, the shipment's details under it, and icon buttons
  // (⋯ Edit / Delete, Export INV + PL, Save, Next tab) on the right.
  const menuActions = [
    ...(detail && can('shipments:write')
      ? [
          editing
            ? { label: 'Cancel Edit', icon: icons.close({}), onClick: cancelEdit }
            : { label: 'Edit', icon: icons.edit({}), onClick: () => setEditing(true) },
        ]
      : []),
    // A saved shipment's files (each up to 10 MB), viewable without entering Edit.
    ...(detail && can('documents:read')
      ? [
          {
            label: 'Support Documents',
            icon: icons.paperclip({}),
            onClick: () => setSupportDocs(true),
          },
        ]
      : []),
    ...(detail && can('shipments:delete')
      ? [
          {
            label: 'Delete Shipment',
            icon: icons.trash({}),
            onClick: () => void remove(),
            disabled: del.isPending,
            danger: true,
          },
        ]
      : []),
  ];
  const header = (
    <div className={`${backRow} ${f.topBar}`}>
      <BackLink to="/plans" label="Shipping Plans" />
      <div className={f.header}>
        <div style={{ minWidth: 0 }}>
          <div className={f.titleRow}>
            <h2 className={`${f.title} ${f.titleCaps}`}>{clientName || 'New shipment'}</h2>
            {statusBadges}
            {isDirty && !readOnly && <span className={f.dirty}>Unsaved changes</span>}
          </div>
          <div className={`${f.meta} ${f.metaCaps}`}>
            <span className={f.metaItem}>
              <strong>{detail?.reference ?? 'New shipment'}</strong>
            </span>
            <span className={f.metaItem}>{metaParts.slice(1).join(' • ')}</span>
            {updatedAt && (
              <span className={f.metaItem}>
                {fi.clock({})}
                Updated {updatedAt}
              </span>
            )}
          </div>
        </div>
        <div className={f.toolbar}>
          {menuActions.length > 0 && (
            <DotsMenu label="More actions" className={f.iconBtn} actions={menuActions} />
          )}
          <button
            type="button"
            className={f.iconBtn}
            onClick={() => void exportInvPl()}
            disabled={!detail || exporting || !!exportBlocked}
            aria-label="Export INV + PL"
            title={
              !detail
                ? 'Export INV + PL: create the shipment first'
                : exportBlocked
                  ? `Export INV + PL: ${exportBlocked.toLowerCase()}`
                  : detail.direction === 'IMPORT'
                    ? 'Export INV + PL: invoice + packing list, customs cover letter and transfer of rights in Excel'
                    : 'Export INV + PL: invoice + packing list in Excel, one sheet per invoice'
            }
          >
            {exporting ? <span className={f.spinner} aria-hidden /> : icons.download({})}
          </button>
          <button
            type="button"
            className={f.iconBtn}
            onClick={() => void submit()}
            disabled={readOnly || save.isPending || !canSaveHere}
            aria-label={detail ? 'Save changes' : 'Create shipment'}
            title={
              !can('shipments:write')
                ? 'View only'
                : readOnly
                  ? 'Choose Edit in the ⋯ menu to make changes'
                  : !canSaveHere
                    ? 'Fill in each tab; the shipment is created on the last one'
                    : save.isPending
                      ? 'Saving…'
                      : detail
                        ? 'Save changes (Ctrl+S)'
                        : 'Create shipment (Ctrl+S)'
            }
          >
            {fi.save({})}
          </button>
          <button
            type="button"
            className={f.iconBtn}
            onClick={() => setStep(current + 1)}
            disabled={isLast}
            aria-label="Next tab"
            title={isLast ? 'Last tab' : `Next: ${steps[current + 1]!.label}`}
          >
            {fi.arrowRight({})}
          </button>
        </div>
      </div>
    </div>
  );

  // The card is half the page wide (Parties sits beside it): the shipment number on its own
  // row, then two fields a row. Imports and exports alike.
  const half = true;
  const referenceField = (
    <div className="form-field-group" style={spanStyle(half ? 'full' : 2)}>
      <FieldLabel name="reference" label="Shipment Number" />
      <input
        id="f-reference"
        className={`form-field-box ${f.refBox}`}
        value={detail?.reference ?? ''}
        placeholder="Assigned when the shipment is created"
        readOnly
        tabIndex={-1}
      />
    </div>
  );
  const generalCard = (
    <Card title="General Information" icon="idCard" cols={half ? 2 : 4}>
      {half && referenceField}
      <div className="form-field-group" style={spanStyle(half ? 1 : 2)}>
        <FieldLabel name="clientId" label="Client" />
        <select
          id="f-clientId"
          className={`form-select-box ${f.clientHi}`}
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
      {!half && referenceField}
      <Select
        name="direction"
        label="Shipment Type"
        options={DIRECTIONS}
        onChange={() => setStep(0)}
        span={half ? 1 : 2}
      />
      <Select
        name="transportMode"
        label="Freight Method"
        options={FREIGHT}
        span={half ? 1 : 2}
        // Switching away from Air: pick CY / CY so Sea and Truck have terms.
        onChange={() => loadType === 'NONE' && setValue('loadType', 'FCL')}
      />
      <Select
        name="loadType"
        label="Shipping Terms"
        options={transportMode === 'AIR' ? AIR_TERMS : TERMS}
        disabled={transportMode === 'AIR'}
      />
      <Select
        name="incoterm"
        label="Incoterms"
        options={INCOTERMS.map((t) => ({ value: t, label: `${t} – ${INCOTERM_LABEL[t]}` }))}
        placeholder="Select incoterm"
      />
      <Field
        name="receivedDocumentDate"
        label="Received Document Date"
        type="date"
        span={half ? 1 : 2}
      />
    </Card>
  );

  return (
    <section className="view active caps-values caps-labels">
      <FormProvider {...methods}>
        <form
          className={f.page}
          // Enter in a field moves to the next step; only the last step saves on Enter.
          onSubmit={(e) => {
            e.preventDefault();
            if (isLast) void submit();
            else setStep(current + 1);
          }}
          noValidate
        >
          {/* ---------- Header, then where the shipment has got to, then the form's tabs ---------- */}
          {header}
          <Milestones direction={direction} />
          <CargoQuantityFromInvoices />
          <nav className={f.tabs} role="tablist" aria-label="Form sections">
            {steps.map((s, i) => (
              <button
                type="button"
                key={s.label}
                role="tab"
                className={f.tab}
                aria-selected={i === current}
                data-error={s.fields.some((k) => k in errors)}
                onClick={() => setStep(i)}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <fieldset
            disabled={readOnly}
            className={readOnly ? f.viewing : undefined}
            style={{ border: 'none', minWidth: 0, padding: 0 }}
          >
            <div className={f.stack}>
              {/* ---------- General information: client, shipment number and the shipment
                  choices, on the first tab only ---------- */}
              {current === 0 && !steps[0]!.placesGeneral && generalCard}

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
                    fontWeight: 600,
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

              {steps[current]!.render(generalCard)}
            </div>
          </fieldset>
        </form>
      </FormProvider>
      {supportDocs && detail && (
        <SupportDocumentsModal
          title={detail.reference}
          link={{ shipmentId: detail.id }}
          clientId={detail.clientId}
          onClose={() => setSupportDocs(false)}
        />
      )}
    </section>
  );
}

// By air both directions track the air waybills (HAWB in the HBL no., MAWB in the booking no.).
const MILESTONES = {
  IMPORT: ['Received INV & PL', 'HBL', 'ETA Port', 'Clearance', 'Arrive Factory'],
  EXPORT: ['Received INV & PL', 'Booking', 'ETD', 'Clearance', 'Departed'],
  AIR_IMPORT: ['Received INV & PL', 'HAWB / MAWB', 'ETA Port', 'Clearance', 'Arrive Factory'],
  AIR_EXPORT: ['Received INV & PL', 'HAWB / MAWB', 'ETD', 'Clearance', 'Departed'],
};

/**
 * The shipment's progress, read from what has been filled in. Import: an invoice no., the HBL
 * no., the ETA Port date, a cleared declaration and the ETA Factory date. Export: an invoice
 * no., the booking / SO no., the ETD, a cleared declaration and the ATD. By air the second is
 * a HAWB or MAWB no. The first one still missing is the current milestone.
 */
/**
 * A shipment's Cargo Quantity is the Pkgs (an export's CTNS) total of its invoice lines, kept in
 * step as lines change (on any tab). Until a line has Pkgs the saved quantity stays: most older
 * imports only have the quantity typed on the shipment.
 */
function CargoQuantityFromInvoices() {
  const { control, getValues, setValue } = useFormContext<FormValues>();
  const invoices = useWatch({ control, name: 'invoices' });
  const pkgs = (invoices ?? []).reduce(
    (n, inv) => n + (inv.lines ?? []).reduce((m, l) => m + toNum(l.ctns), 0),
    0,
  );
  useEffect(() => {
    if (pkgs <= 0 || toNum(getValues('quantity')) === pkgs) return;
    setValue('quantity', String(pkgs), { shouldDirty: true, shouldValidate: true });
  }, [pkgs, getValues, setValue]);
  return null;
}

/**
 * The shipment's CBM: typed here, or left blank for its invoice lines' CBM total (shown as the
 * hint). Every bill to the client prints this same CBM.
 */
function CbmField() {
  const { control } = useFormContext<FormValues>();
  const [invoices, mode] = useWatch({ control, name: ['invoices', 'transportMode'] });
  const lines = (invoices ?? []).reduce(
    (n, inv) => n + (inv.lines ?? []).reduce((m, l) => m + toNum(l.cbm), 0),
    0,
  );
  return (
    <Field
      name="cbm"
      label={mode === 'AIR' ? 'CBM (bills show NON by air)' : 'CBM'}
      // Blank = the invoice lines' total.
      placeholder={lines ? `${+lines.toFixed(3)} (from invoices)` : '0.000'}
      decimals={3}
    />
  );
}

function Milestones({ direction }: { direction: FormValues['direction'] }) {
  const { control } = useFormContext<FormValues>();
  const [invoices, hblNo, eta, arriveFty, bookingNo, etd, atd, declarations, mode] = useWatch({
    control,
    name: [
      'invoices',
      'hblNo',
      'eta',
      'arriveFty',
      'bookingNo',
      'etd',
      'atd',
      'declarations',
      'transportMode',
    ],
  });
  const isExport = direction === 'EXPORT';
  // An air export has no ATD field: it has departed once its flight date has come.
  const departed =
    !!atd || (mode === 'AIR' && !!etd && etd <= new Date().toISOString().slice(0, 10));
  const reached = [
    (invoices ?? []).some((i) => !!i.invoiceNo?.trim()),
    mode === 'AIR'
      ? !!bookingNo?.trim() || !!hblNo?.trim()
      : isExport
        ? !!bookingNo?.trim()
        : !!hblNo?.trim(),
    isExport ? !!etd : !!eta,
    clearanceStatusOf({ declarations }) === 'CLEARED',
    isExport ? departed : !!arriveFty,
  ];
  const next = reached.indexOf(false);
  return (
    <ol className={f.track} aria-label="Shipment progress">
      {MILESTONES[`${mode === 'AIR' ? 'AIR_' : ''}${isExport ? 'EXPORT' : 'IMPORT'}`].map(
        (label, i) => {
          const state = reached[i] ? 'done' : i === next ? 'current' : 'todo';
          return (
            <li
              key={label}
              className={f.mile}
              data-state={state}
              data-linked={!!reached[i] && !!reached[i + 1]}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className={f.mileDot}>{state === 'done' ? fi.check({}) : i + 1}</span>
              <span className={f.mileLabel}>{label}</span>
            </li>
          );
        },
      )}
    </ol>
  );
}

/* ------------------------------ Field helpers ------------------------------ */

type Span = number | 'full';
const spanStyle = (span?: Span): CSSProperties | undefined =>
  span === 'full' ? { gridColumn: '1 / -1' } : span ? { gridColumn: `span ${span}` } : undefined;

/** Quantity, with its unit (CTNS…) shown as a tag inside the box. */
/** A field's label, in capitals (ShipmentForm.module.css). */
function FieldLabel({ name, label }: { name: string; label: string }) {
  return (
    <label htmlFor={`f-${name}`} className={f.label}>
      {label}
    </label>
  );
}

function Field({
  name,
  label,
  type = 'text',
  span,
  placeholder,
  decimals,
  suffix,
  rows,
  hideLabel,
  readOnly,
}: {
  name: keyof FormValues;
  label: string;
  type?: string;
  span?: Span;
  placeholder?: string;
  /** A number field (digits only, shown with commas) with at most this many decimals. */
  decimals?: number;
  /** A tag at the right end of the box, e.g. the quantity's unit. */
  suffix?: string;
  /** A text box this many lines tall (e.g. the remark), instead of a one-line field. */
  rows?: number;
  /** No label above the box (the card title already names it); screen readers still get it. */
  hideLabel?: boolean;
  /** Filled in by the form (e.g. Cargo Quantity from the invoices): shown, not typed. */
  readOnly?: boolean;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const err = errors[name] as { message?: string } | undefined;
  return (
    <div className="form-field-group" style={spanStyle(span)}>
      {!hideLabel && <FieldLabel name={name} label={label} />}
      <div className={suffix ? f.affix : f.plain}>
        {rows ? (
          <textarea
            id={`f-${name}`}
            aria-label={hideLabel ? label : undefined}
            rows={rows}
            className={`form-field-box ${f.textarea}`}
            placeholder={placeholder ?? label}
            {...register(name)}
            aria-invalid={!!err}
          />
        ) : decimals !== undefined ? (
          <NumberInput
            id={`f-${name}`}
            decimals={decimals}
            className={readOnly ? `form-field-box ${f.refBox} ${f.autoBox}` : 'form-field-box'}
            placeholder={placeholder ?? label}
            {...register(name)}
            readOnly={readOnly}
            tabIndex={readOnly ? -1 : undefined}
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
        {suffix && <span className={f.suffix}>{suffix}</span>}
      </div>
      <FieldError message={err?.message} />
    </div>
  );
}

/** An export's Shipper: the client's legal name in English (an older value stays selectable). */
function ExportShipperSelect({ lookups, span = 2 }: { lookups: LookupsResponse; span?: Span }) {
  const [clientId, current] = useWatch<FormValues, ['clientId', 'shipperName']>({
    name: ['clientId', 'shipperName'],
  });
  const client = lookups.clients.find((c) => c.id === clientId);
  const legal = client?.legalName?.trim() || client?.name || '';
  const names = [legal, current ?? ''].filter(
    (v, i, all) => v.trim() && all.findIndex((x) => x === v) === i,
  );
  return (
    <Select
      name="shipperName"
      label="Shipper"
      options={names.map((v) => ({ value: v, label: v }))}
      placeholder="Select shipper"
      span={span}
    />
  );
}

/**
 * Broker: us by default, or any broker already used on a shipment; "+ Add New" types another
 * (it is kept as text on the shipment, so it joins the list once saved).
 */
function BrokerSelect({
  lookups,
  label = 'Broker',
  span = 2,
}: {
  lookups: LookupsResponse;
  label?: string;
  span?: Span;
}) {
  const { field } = useController<FormValues, 'broker'>({ name: 'broker' });
  const current = field.value ?? '';
  const names = [DEFAULT_BROKER, ...lookups.brokers, ...(current.trim() ? [current] : [])].filter(
    (v, i, all) => all.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i,
  );
  return (
    <div className="form-field-group" style={spanStyle(span)}>
      <FieldLabel name="broker" label={label} />
      <AddNewSelect
        id="f-broker"
        label={label}
        placeholder="Select broker"
        addFirst
        value={field.value}
        onChange={field.onChange}
        onBlur={field.onBlur}
        options={names.map((v) => ({ value: v, label: v }))}
        onCreate={async (name) => name.trim()}
      />
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

/**
 * CO Form: the MoC CO system's form list ("Form AB"…, stored as the code AB), with "+ Add New"
 * first. A code not in the list stays selectable until changed.
 */
function CoFormSelect({ lookups }: { lookups: LookupsResponse }) {
  const { field } = useController<FormValues, 'coForm'>({ name: 'coForm' });
  const { can } = useAuth();
  const addCoForm = useAddCoForm();
  const current = field.value ?? '';
  const options = lookups.values.CO_FORM.map((v) => ({ value: v.value, label: v.label }));
  if (current && !options.some((o) => o.value === current))
    options.push({ value: current, label: current });
  return (
    <div className="form-field-group">
      <FieldLabel name="coForm" label="CO Form" />
      <AddNewSelect
        id="f-coForm"
        label="CO Form"
        placeholder="Select form"
        addFirst
        value={field.value}
        onChange={field.onChange}
        onBlur={field.onBlur}
        options={options}
        onCreate={
          can('shipments:write')
            ? async (label) => (await addCoForm.mutateAsync({ label })).value
            : undefined
        }
      />
    </div>
  );
}

/**
 * The import or export type (Garments & Apparel…), kept in the material field, with "+ Add new…"
 * for a type not in the list. A plan workbook import fills it with the CDC groups ("RAW
 * MATERIAL, ACCESSORY"), which stays selectable until changed.
 */
/** What each import / export type covers, shown in brackets in its list (not saved). */
const MATERIAL_HINT: Record<string, string> = {
  'Garments & Apparel': 'Clothing, shirts, trousers, jackets, uniforms',
  Footwear: 'Shoes, sneakers, sandals, boots',
  'Textiles & Fabrics': 'Fabric, yarn, thread, cotton, polyester',
  'Vehicles & Automotive': 'Cars, motorbikes, trucks, spare parts',
  'Machinery & Equipment': 'Industrial machines, sewing machines, tools',
  'Electronics & Electrical Goods': 'Phones, computers, cables, appliances',
  'Food & Beverages': 'Packaged food, drinks, snacks',
  'Agricultural Products': 'Rice, cassava, rubber, fruit, seeds',
  Chemicals: 'Dyes, solvents, resins, industrial chemicals',
  'Pharmaceuticals & Medical Supplies': 'Medicines, masks, gloves, medical devices',
};

function CargoTypeSelect({
  label,
  options: listed,
  span = 2,
}: {
  label: string;
  options: { value: string; label: string }[];
  span?: Span;
}) {
  const { field } = useController<FormValues, 'material'>({ name: 'material' });
  const { can } = useAuth();
  const addMaterial = useAddMaterial();
  const current = field.value ?? '';
  const options =
    current && !listed.some((o) => o.value === current)
      ? [...listed, { value: current, label: current }]
      : listed;
  return (
    <div className="form-field-group" style={spanStyle(span)}>
      <FieldLabel name="material" label={label} />
      <AddNewSelect
        id="f-material"
        label={label}
        placeholder="Select type"
        value={field.value}
        onChange={field.onChange}
        onBlur={field.onBlur}
        options={options.map((o) => ({ ...o, hint: MATERIAL_HINT[o.value] }))}
        onCreate={
          can('shipments:write')
            ? async (name) => (await addMaterial.mutateAsync({ label: name })).value
            : undefined
        }
      />
    </div>
  );
}

/** A country, picked from every country in the world with its flag; type to search. */
function CountryField({
  name,
  label,
  countries,
  span,
}: {
  name: 'destinationCountryIso2' | 'originCountryIso2';
  label: string;
  countries: LookupsResponse['countries'];
  span?: Span;
}) {
  const { field, fieldState } = useController<FormValues, typeof name>({ name });
  return (
    <div className="form-field-group" style={spanStyle(span)}>
      <FieldLabel name={name} label={label} />
      <CountrySelect
        id={`f-${name}`}
        value={field.value}
        onChange={field.onChange}
        onBlur={field.onBlur}
        countries={countries}
        invalid={!!fieldState.error}
      />
      <FieldError message={fieldState.error?.message} />
    </div>
  );
}

function Select({
  name,
  label,
  options,
  placeholder,
  span,
  disabled,
  onChange,
}: {
  name: keyof FormValues;
  label: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  span?: Span;
  disabled?: boolean;
  onChange?: () => void;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const err = errors[name] as { message?: string } | undefined;
  return (
    <div className="form-field-group" style={spanStyle(span)}>
      <FieldLabel name={name} label={label} />
      <div className={f.plain}>
        <select
          id={`f-${name}`}
          className="form-select-box"
          {...register(name, { onChange })}
          disabled={disabled}
          aria-invalid={!!err}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <FieldError message={err?.message} />
    </div>
  );
}

/** One status as a tile: what it is, its badge, and how it is worked out. */
function StatusTile({
  icon,
  label,
  tone,
  value,
  children,
}: {
  icon: FormIcon;
  label: string;
  tone: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className={f.statusTile}>
      <div className={f.statusHead}>
        <span className={f.statusIcon}>{fi[icon]({})}</span>
        <span className={f.statusLabel}>{label}</span>
        <span className={f.badge} data-tone={tone}>
          {value}
        </span>
      </div>
      <p className={f.statusHint}>{children}</p>
    </div>
  );
}

/** The status under the chosen client's completion rule, as the form is filled in. */
function useLiveShipmentStatus(control: Control<FormValues>, lookups: LookupsResponse) {
  const [
    clientId,
    direction,
    atd,
    ata,
    arriveFty,
    doDate,
    receivedDocumentDate,
    declarations,
    clearanceStatus,
  ] = useWatch({
    control,
    name: [
      'clientId',
      'direction',
      'atd',
      'ata',
      'arriveFty',
      'doDate',
      'receivedDocumentDate',
      'declarations',
      'clearanceStatus',
    ],
  });
  const client = lookups.clients.find((c) => c.id === clientId);
  const custom = direction === 'IMPORT' ? client?.importCompleteOn : client?.exportCompleteOn;
  const rule = custom?.length ? custom : DEFAULT_COMPLETION[direction];
  const status = shipmentStatusOf(
    { direction, atd, ata, arriveFty, doDate, receivedDocumentDate, declarations, clearanceStatus },
    rule,
  );
  return { status, rule };
}

/** The shipment status is not chosen: it is shown as it follows from the shipment's data. */
function ShipmentStatusField({ lookups }: { lookups: LookupsResponse }) {
  const { control } = useFormContext<FormValues>();
  const { status, rule } = useLiveShipmentStatus(control, lookups);
  const done = rule.map((m) => COMPLETION_MILESTONE_LABEL[m]).join(' and ');
  return (
    <StatusTile
      icon="activity"
      label="Status"
      tone={TONE[status]!}
      value={SHIPMENT_STATUS_LABEL[status]}
    >
      {status === 'EXCEPTION' ? (
        'Exception while the shipment is marked as one we don’t clear (switch at the top right).'
      ) : (
        <>
          Completed once {done} {rule.length > 1 ? 'are' : 'is'} in, In Progress once a declaration
          is recorded, otherwise Pending.
        </>
      )}
    </StatusTile>
  );
}

/**
 * The Shipment Status card's top-right switch: Exception, for a shipment we don't clear. It
 * sets the clearance status (kept until switched off), and with it the shipment's status.
 */
function ExceptionSwitch() {
  const { control, setValue } = useFormContext<FormValues>();
  const [declarations, stored] = useWatch({ control, name: ['declarations', 'clearanceStatus'] });
  return (
    <label className={f.exceptionToggle} title="For a shipment we don't clear">
      <input
        type="checkbox"
        role="switch"
        checked={stored === 'EXCEPTION'}
        onChange={(e) =>
          setValue(
            'clearanceStatus',
            e.target.checked ? 'EXCEPTION' : clearanceStatusOf({ declarations }),
            { shouldDirty: true },
          )
        }
      />
      <span className={f.exceptionTrack} aria-hidden />
      <b>Exception</b>
    </label>
  );
}

/**
 * The clearance status follows from the customs declarations, except Exception: switched on by
 * hand (ExceptionSwitch) for a shipment we don't clear, and kept until it is switched off.
 */
function ClearanceStatusField() {
  const { control } = useFormContext<FormValues>();
  const [declarations, stored] = useWatch({ control, name: ['declarations', 'clearanceStatus'] });
  const status = clearanceStatusFor({ clearanceStatus: stored, declarations });
  return (
    <StatusTile
      icon="badge"
      label="Clearance Status"
      tone={TONE[status]!}
      value={CLEARANCE_STATUS_LABEL[status]}
    >
      {status === 'EXCEPTION'
        ? 'Marked as Exception by hand. Switch it off to go back to the automatic status.'
        : 'Customs Cleared once a declaration has its Declare No. and Date, In Progress once a Declare No. is entered, otherwise Pending Review.'}
    </StatusTile>
  );
}

/** A titled section card; `cols` sets the grid (fields span 1 unless told otherwise). */
function Card({
  title,
  icon,
  cols = 4,
  action,
  children,
}: {
  title: string;
  icon: FormIcon;
  cols?: number;
  /** At the top right of the card, e.g. Shipment Status's Exception switch. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="cx-card">
      <div className="cx-card-head">
        <div className="cx-title">
          <span className="cx-title-icon">{fi[icon]({ width: 18, height: 18 })}</span>
          <h3>{title}</h3>
        </div>
        {action}
      </div>
      <div className={f.grid} style={{ '--cols': cols } as CSSProperties}>
        {children}
      </div>
    </div>
  );
}

function PartiesFields({
  lookups,
  which,
  span = 2,
}: {
  lookups: LookupsResponse;
  which: 'consignee' | 'forwarder';
  span?: Span;
}) {
  const { control } = useFormContext<FormValues>();
  const { field: consignee } = useController<FormValues, 'consigneeId'>({ name: 'consigneeId' });
  const { field: forwarder } = useController<FormValues, 'forwarderId'>({ name: 'forwarderId' });
  const { can } = useAuth();
  const clientId = useWatch({ control, name: 'clientId' });
  const addConsignee = useAddConsignee();
  const addForwarder = useAddForwarder();
  if (which === 'consignee') {
    const opts = [...lookups.consignees].sort(
      (a, b) => Number(b.clientId === clientId) - Number(a.clientId === clientId),
    );
    return (
      <div className="form-field-group" style={spanStyle(span)}>
        <FieldLabel name="consigneeId" label="Consignee" />
        <AddNewSelect
          id="f-consigneeId"
          label="Consignee"
          placeholder="Consignee"
          value={consignee.value}
          onChange={consignee.onChange}
          onBlur={consignee.onBlur}
          options={opts.map((c) => ({ value: c.id, label: c.name }))}
          onCreate={
            can('shipments:write')
              ? async (name) => (await addConsignee.mutateAsync({ name })).id
              : undefined
          }
        />
      </div>
    );
  }
  return (
    <div className="form-field-group" style={spanStyle(span)}>
      <FieldLabel name="forwarderId" label="Forwarder" />
      <AddNewSelect
        id="f-forwarderId"
        label="Forwarder"
        placeholder="Forwarder"
        value={forwarder.value}
        onChange={forwarder.onChange}
        onBlur={forwarder.onBlur}
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

/**
 * An export's schedule, dated by its departure (no ETA or ETD port). By air: the flight, its
 * check-in and cut-off, and the flight date (kept as the ETD), with no containers.
 */
function ExportSchedule() {
  const mode = useWatch<FormValues, 'transportMode'>({ name: 'transportMode' });
  if (mode === 'AIR')
    return (
      <Card title="Schedule" icon="calendar" cols={2}>
        <Field name="flightNo" label="Flight No." placeholder="e.g. CZ 3054" />
        <Field name="checkInDate" label="Check-in Date" type="date" />
        <Field name="cutOffDate" label="Cut-off" type="date" />
        <Field name="etd" label="Flight Date" type="date" />
      </Card>
    );
  return (
    <Card title="Schedule" icon="calendar" cols={2}>
      <Field name="etd" label="ETD" type="date" />
      <Field name="atd" label="ATD (Actual Departure)" type="date" />
    </Card>
  );
}

function ContainersCard() {
  const {
    control,
    register,
    getValues,
    formState: { errors },
  } = useFormContext<FormValues>();
  const loadType = useWatch({ control, name: 'loadType' });
  const direction = useWatch({ control, name: 'direction' });
  const byTruck = useWatch({ control, name: 'transportMode' }) === 'ROAD';
  const arr = useFieldArray({ control, name: 'containers' });
  const errs = errors.containers as unknown as
    (Record<number, Record<string, { message?: string }>> & { message?: string }) | undefined;
  const lcl = loadType === 'LCL';
  // LCL containers are optional: switching to LCL drops the untouched blank rows, so the card
  // starts empty (its "+ Add Container" is at the top right).
  useEffect(() => {
    if (!lcl) return;
    const rows = getValues('containers') ?? [];
    if (rows.length && rows.every((c) => !c.containerNo?.trim() && !c.linerSeal?.trim()))
      arr.replace([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lcl]);
  if (loadType !== 'FCL' && !lcl)
    return (
      <Card title="Containers" icon="container" cols={1}>
        <p className={f.note}>
          Containers are recorded for CY / CY (FCL) and LCL shipments only. Change Shipping Terms on
          the Shipment Information tab to add them.
        </p>
      </Card>
    );
  return (
    <Card
      title="Containers"
      icon="container"
      cols={1}
      // At the top right, level with the title, as on Customs Declarations.
      action={
        <div className="cargo-actions">
          <button
            type="button"
            className="cargo-btn cargo-btn-primary"
            onClick={() => arr.append(blankContainer())}
          >
            + Add Container
          </button>
        </div>
      }
    >
      <div>
        {lcl && arr.fields.length === 0 && (
          <p className={f.note}>Optional for LCL: add the container if you know it.</p>
        )}
        {arr.fields.length > 0 && (
          <div className="cdc-lines-wrap">
            <table className="cdc-lines-table">
              <thead>
                <tr>
                  <th>Container No.</th>
                  <th>Size</th>
                  <th>Liner Seal</th>
                  {direction === 'EXPORT' && <th>Customs Seal</th>}
                  {byTruck && <th>Truck No.</th>}
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
                    <td>
                      <input
                        className="form-field-box"
                        placeholder="Liner Seal"
                        {...register(`containers.${i}.linerSeal`)}
                      />
                    </td>
                    {direction === 'EXPORT' && (
                      <td>
                        <input
                          className="form-field-box"
                          placeholder="Customs Seal"
                          {...register(`containers.${i}.customsSeal`)}
                        />
                      </td>
                    )}
                    {byTruck && (
                      <td>
                        <input
                          className="form-field-box"
                          placeholder="e.g. 3A-1234"
                          {...register(`containers.${i}.truckNo`)}
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
      </div>
    </Card>
  );
}

/* ------------------------------ Steps ------------------------------ */

function buildSteps(
  direction: FormValues['direction'],
  mode: FormValues['transportMode'],
  lookups: LookupsResponse,
  detail: ShipmentDetail | undefined,
  readOnly: boolean,
): Step[] {
  const ports = lookups.ports.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }));
  const units = lookups.values.QUANTITY_UNIT.map((v) => ({ value: v.value, label: v.label }));
  const materials = lookups.values.MATERIAL.map((v) => ({ value: v.value, label: v.label }));

  const statusCard = (
    <Card title="Shipment Status" icon="activity" cols={2} action={<ExceptionSwitch />}>
      <ShipmentStatusField lookups={lookups} />
      <ClearanceStatusField />
    </Card>
  );
  // An import's sits in half the page: the number on its own row, then date and amount.
  const thcCard = (
    <Card title="Invoice / THC" icon="receipt" cols={2}>
      <Field name="thcHblNo" label="Invoice / THC No." span="full" />
      <Field name="thcHblDate" label="Invoice / THC Date" type="date" />
      <Field name="thcHblAmount" label="Amount (USD)" placeholder="0.00" decimals={2} />
    </Card>
  );
  // By air there is no vessel, voyage or container, and the bills are air waybills.
  const air = mode === 'AIR';
  const hblDateLabel = air ? 'HAWB / MAWB Date' : 'HBL Date';
  const remarkCard = (
    <Card title="Remark" icon="message" cols={1}>
      <Field
        name="remark"
        label="Remark"
        span="full"
        placeholder="Optional note"
        rows={5}
        hideLabel
      />
    </Card>
  );

  if (direction === 'EXPORT') {
    // The same four tabs as an import, in the same open sections (no card boxes, two a row):
    // the shipment, its cargo invoices, its booking and departure, then customs.
    return [
      {
        label: 'Shipment Information',
        fields: [
          'clientId',
          'shipperName',
          'consigneeId',
          'forwarderId',
          'broker',
          'destinationCountryIso2',
          'quantity',
          'quantityUnit',
          'cbm',
          'material',
          'receivedDocumentDate',
        ],
        // General Information | Parties, then Cargo | Quantity & Unit.
        placesGeneral: true,
        render: (general) => (
          <div className={`${f.columns} ${f.open}`}>
            {general}
            <Card title="Parties" icon="users" cols={1}>
              <ExportShipperSelect lookups={lookups} span={1} />
              <PartiesFields lookups={lookups} which="consignee" span={1} />
              <PartiesFields lookups={lookups} which="forwarder" span={1} />
              <BrokerSelect lookups={lookups} label="Customs Broker" span={1} />
            </Card>
            <Card title="Cargo" icon="box" cols={2}>
              <CountryField
                name="destinationCountryIso2"
                label="Destination Country"
                countries={lookups.countries}
                span={1}
              />
              <CargoTypeSelect label="Export Type" options={materials} span={1} />
            </Card>
            <Card title="Quantity, Unit & CBM" icon="box" cols={2}>
              <Field
                name="quantity"
                // Filled in from the invoices' CTNS total (Cargo, Pricing & FOB), as on an import.
                label="Quantity Pkgs (Automatic)"
                placeholder="0"
                decimals={3}
                readOnly
              />
              <Select name="quantityUnit" label="Unit" options={units} placeholder="Select unit" />
              <CbmField />
            </Card>
          </div>
        ),
      },
      {
        label: 'Cargo, Pricing & FOB',
        fields: ['invoices'],
        render: () => (
          <div className={f.open}>
            <CargoSection shipmentId={detail?.id} readOnly={readOnly} />
          </div>
        ),
      },
      {
        label: air ? 'Air Waybill & Schedule' : 'Booking, Schedule & Vessel',
        fields: [
          'bookingNo',
          'crd',
          'hblNo',
          'hblDate',
          'etd',
          'atd',
          'flightNo',
          'checkInDate',
          'cutOffDate',
          'containers',
          'loadType',
          'vesselName',
          'voyageNo',
          'coForm',
          'coNumber',
          'coStatus',
        ],
        // Schedule | Vessel, Booking | Containers, then Certificate of Origin. By air:
        // Schedule | Air Waybill, then Certificate of Origin. The clearance port is with the
        // customs declarations (last tab), as on an import.
        render: () => (
          <div className={`${f.columns} ${f.open}`}>
            <ExportSchedule />
            {!air && (
              <Card title="Vessel" icon="ship" cols={2}>
                <Field name="vesselName" label="Vessel Name" />
                <Field name="voyageNo" label="Voyage No." />
              </Card>
            )}
            <Card title={air ? 'Air Waybill' : 'Booking'} icon={air ? 'plane' : 'file'} cols={2}>
              {/* By air the HAWB comes first, then the MAWB. */}
              {air ? (
                <>
                  <Field name="hblNo" label="HAWB No." />
                  <Field name="bookingNo" label="MAWB No." />
                </>
              ) : (
                <>
                  <Field name="bookingNo" label="Booking / SO No." />
                  <Field name="hblNo" label="HBL No." />
                </>
              )}
              <Field name="hblDate" label={hblDateLabel} type="date" />
              <Field name="crd" label="CRD" type="date" />
            </Card>
            {!air && <ContainersCard />}
            <Card title="Certificate of Origin" icon="file" cols={2}>
              <CoFormSelect lookups={lookups} />
              <CoStatusSelect />
              <Field name="coNumber" label="CO Number" span="full" />
            </Card>
          </div>
        ),
      },
      {
        label: 'Customs Declaration',
        fields: [
          'clearancePortId',
          'declarations',
          'thcHblNo',
          'thcHblDate',
          'thcHblAmount',
          'remark',
        ],
        // Customs Declarations | Invoice / THC, then Remark | Shipment Status.
        render: () => (
          <div className={`${f.columns} ${f.open}`}>
            <DeclarationsSection
              original={detail}
              port={
                <Select
                  name="clearancePortId"
                  label="Clearance Port"
                  options={ports}
                  placeholder="Select port"
                />
              }
            />
            {thcCard}
            {remarkCard}
            {statusCard}
          </div>
        ),
      },
    ];
  }

  return [
    {
      label: 'Shipment Information',
      fields: [
        'clientId',
        'shipperName',
        'consigneeId',
        'quantity',
        'quantityUnit',
        'cbm',
        'forwarderId',
        'broker',
        'originCountryIso2',
        'material',
        'receivedDocumentDate',
      ],
      // Open sections (no card box), two a row: General Information | Parties, then
      // Cargo | Quantity & Unit.
      placesGeneral: true,
      render: (general) => (
        <div className={`${f.columns} ${f.open}`}>
          {general}
          <Card title="Parties" icon="users" cols={1}>
            <Field name="shipperName" label="Shipper Name" placeholder="Supplier name" />
            <PartiesFields lookups={lookups} which="consignee" span={1} />
            <PartiesFields lookups={lookups} which="forwarder" span={1} />
            <BrokerSelect lookups={lookups} label="Customs Broker" span={1} />
          </Card>
          <Card title="Cargo" icon="box" cols={2}>
            <CountryField
              name="originCountryIso2"
              label="Origin Country"
              countries={lookups.countries}
              span={1}
            />
            <CargoTypeSelect label="Import Type" options={materials} span={1} />
          </Card>
          <Card title="Quantity, Unit & CBM" icon="box" cols={2}>
            <Field
              name="quantity"
              // Filled in from the invoices' Pkgs total (Item, Costing & Forwarding).
              label="Quantity Pkgs (Automatic)"
              placeholder="0"
              decimals={3}
              readOnly
            />
            <Select name="quantityUnit" label="Unit" options={units} placeholder="Select unit" />
            <CbmField />
          </Card>
        </div>
      ),
    },
    {
      label: 'Item, Costing & Forwarding',
      fields: ['invoices'],
      // An open section like the other tabs (no box around the invoices).
      render: () => (
        <div className={f.open}>
          <CargoSection shipmentId={detail?.id} readOnly={readOnly} />
        </div>
      ),
    },
    {
      label: air ? 'Origin, Destination & Air Waybill' : 'Origin, Destination & Vessel',
      fields: [
        'bookingNo',
        'hblNo',
        'hblDate',
        'doDate',
        'eta',
        'arriveFty',
        'vesselName',
        'voyageNo',
        'containers',
        'loadType',
      ],
      // Open sections like the first tab, two a row: Schedule | Vessel, then Bill of Lading &
      // Delivery Order | Containers. By air: Schedule | Air Waybill.
      render: () => (
        <div className={`${f.columns} ${f.open}`}>
          <Card title="Schedule" icon="calendar" cols={2}>
            <Field name="eta" label="ETA Port" type="date" />
            <Field name="arriveFty" label="ETA Factory" type="date" />
          </Card>
          {/* The clearance port is with the customs declarations (last tab). */}
          {!air && (
            <Card title="Vessel" icon="ship" cols={2}>
              <Field name="vesselName" label="Vessel Name" />
              <Field name="voyageNo" label="Voyage No." />
            </Card>
          )}
          {/* The bill's number on its own row, then its dates. */}
          <Card
            title={air ? 'Air Waybill & Delivery Order' : 'Bill of Lading & Delivery Order'}
            icon={air ? 'plane' : 'file'}
            cols={2}
          >
            <Field name="hblNo" label={air ? 'HAWB No.' : 'HBL No.'} span={air ? 1 : 'full'} />
            {air && <Field name="bookingNo" label="MAWB No." />}
            <Field name="hblDate" label={hblDateLabel} type="date" />
            <Field name="doDate" label="DO / EDO Released Date" type="date" />
          </Card>
          {!air && <ContainersCard />}
        </div>
      ),
    },
    {
      label: 'Weights & Declaration',
      fields: [
        'clearancePortId',
        'declarations',
        'thcHblNo',
        'thcHblDate',
        'thcHblAmount',
        'remark',
      ],
      // Open sections like the first tab: Customs Declarations | Invoice / THC, then
      // Remark | Shipment Status.
      render: () => (
        <div className={`${f.columns} ${f.open}`}>
          <DeclarationsSection
            original={detail}
            port={
              <Select
                name="clearancePortId"
                label="Clearance Port"
                options={ports}
                placeholder="Select port"
              />
            }
          />
          {thcCard}
          {remarkCard}
          {statusCard}
        </div>
      ),
    },
  ];
}
