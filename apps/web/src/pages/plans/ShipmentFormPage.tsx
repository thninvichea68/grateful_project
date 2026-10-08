import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  FormProvider,
  useFieldArray,
  useForm,
  useFormContext,
  useWatch,
  type FieldErrors,
} from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CLEARANCE_STATUSES,
  CLEARANCE_STATUS_LABEL,
  CONTAINER_SIZES,
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABEL,
  shipmentInputSchema,
  type LookupsResponse,
  type OverImportViolation,
  type ShipmentDetail,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import {
  useAddConsignee,
  useAddForwarder,
  useDeleteShipment,
  useLookups,
  useSaveShipment,
  useShipment,
} from '../../features/hooks';
import { ErrorBanner, FieldError } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import { ApiError } from '../../lib/api';
import { formResolver } from '../../lib/zodForm';
import { AddNewSelect } from './AddNewSelect';
import { CargoSection } from './CargoSection';
import { DeclarationsSection } from './DeclarationsSection';
import { cleanForSubmit, emptyForm, fromDetail, type FormValues } from './formModel';
import f from './ShipmentForm.module.css';

interface Step {
  label: string;
  /** Top-level form fields shown in this step (used to jump to the first error). */
  fields: (keyof FormValues)[];
  render: () => ReactNode;
}

const FREIGHT = [
  { value: 'SEA', label: 'Sea' },
  { value: 'AIR', label: 'Air' },
  { value: 'ROAD', label: 'Truck' },
  { value: 'RAIL', label: 'Rail' },
];
const TERMS = [
  { value: 'FCL', label: 'CY / CY' },
  { value: 'LCL', label: 'CFS / CFS (LCL)' },
  { value: 'NONE', label: 'Loose' },
];
const DIRECTIONS = [
  { value: 'EXPORT', label: 'Export' },
  { value: 'IMPORT', label: 'Import' },
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
        <Link to="/plans" className="filter-btn" style={{ display: 'inline-flex' }}>
          ← Back to Shipping Plans
        </Link>
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
  const [direction, transportMode, loadType, clientId, status, clearanceStatus] = useWatch({
    control,
    name: ['direction', 'transportMode', 'loadType', 'clientId', 'status', 'clearanceStatus'],
  });
  const [step, setStep] = useState(0);
  const [violations, setViolations] = useState<OverImportViolation[] | null>(null);
  const readOnly = !can('shipments:write');
  const clientLocked = !!detail && detail.declarations.some((d) => d.hasLedgerEntry);

  // Air has no CY/CY or LCL load type.
  useEffect(() => {
    if (transportMode === 'AIR') setValue('loadType', 'NONE');
  }, [transportMode, setValue]);

  const steps = useMemo(() => buildSteps(direction, lookups, detail), [direction, lookups, detail]);
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
      navigate(`/plans/${saved.id}`, { replace: true });
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.details as { rule?: string } | undefined)?.rule === 'CUT_STOCK_OVER_IMPORT'
      ) {
        setViolations((e.details as { violations: OverImportViolation[] }).violations);
        setStep(steps.length - 1);
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

  const cancel = () => {
    if (isDirty && !window.confirm('Discard your changes?')) return;
    if (detail) navigate('/plans');
    else navigate(-1);
  };

  const shipStatus = status ?? 'PENDING';
  const clearStatus = clearanceStatus ?? 'PENDING';
  const clientName =
    lookups.clients.find((c) => c.id === clientId)?.name ?? detail?.clientName ?? '';
  const metaParts = [
    clientName,
    DIRECTIONS.find((d) => d.value === direction)?.label,
    `By ${FREIGHT.find((x) => x.value === transportMode)?.label.toLowerCase() ?? ''}`,
    TERMS.find((t) => t.value === loadType)?.label,
  ].filter(Boolean);
  // Editing an existing record: save from any step. New record: walk the steps, create at the end.
  const canSaveHere = !!detail || isLast;

  return (
    <section className="view active">
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
          {/* ---------- Header ---------- */}
          <div>
            <Link to="/plans" className={f.back}>
              ← Shipping Plans
            </Link>
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

          <fieldset disabled={readOnly} style={{ border: 'none', minWidth: 0, padding: 0 }}>
            <div className={f.stack}>
              {/* ---------- Setup ---------- */}
              <div className="cx-card">
                <div className={f.setup}>
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
                  <Segmented
                    name="direction"
                    label="Shipment type"
                    options={DIRECTIONS}
                    onChange={() => setStep(0)}
                  />
                  <Segmented name="transportMode" label="Freight" options={FREIGHT} />
                  <Segmented
                    name="loadType"
                    label="Terms"
                    options={TERMS}
                    disabled={transportMode === 'AIR'}
                  />
                </div>
              </div>

              {/* ---------- Stepper ---------- */}
              <nav className={f.stepper} aria-label="Form steps">
                {steps.map((s, i) => {
                  const hasError = s.fields.some((k) => k in errors);
                  const state = i === current ? 'active' : i < current ? 'done' : 'todo';
                  return (
                    <button
                      type="button"
                      key={s.label}
                      className={f.step}
                      data-state={state}
                      data-error={hasError}
                      aria-current={i === current ? 'step' : undefined}
                      onClick={() => setStep(i)}
                    >
                      <span className={f.dot}>
                        {hasError ? '!' : state === 'done' ? '✓' : i + 1}
                      </span>
                      <span className={f.stepLabel}>{s.label}</span>
                    </button>
                  );
                })}
              </nav>

              <ErrorBanner error={violations ? null : (save.error ?? del.error)} />
              {violations && (
                <div
                  role="alert"
                  style={{
                    borderRadius: 10,
                    padding: '10px 14px',
                    background: 'var(--status-exception-bg)',
                    color: 'var(--status-exception-fg)',
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  These CDC lines exceed the remaining cut-stock balance:
                  <ul style={{ margin: '6px 0 0 18px', fontWeight: 600 }}>
                    {violations.map((v) => (
                      <li key={v.cutStockItemId}>
                        {v.declareRef} {v.itemName}: balance {v.balance}, declaring {v.requested}
                      </li>
                    ))}
                  </ul>
                  {can('cutstock:override')
                    ? 'Lower the quantity, or enter a reason on the line to approve it.'
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
                Step <strong>{current + 1}</strong> of {steps.length} ·{' '}
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
              {!isLast && (detail || readOnly) && (
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
                  onClick={() => (canSaveHere ? void submit() : setStep(current + 1))}
                >
                  {!canSaveHere
                    ? 'Next →'
                    : save.isPending
                      ? 'Saving…'
                      : detail
                        ? 'Save changes'
                        : 'Create shipment'}
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

type Span = number | 'full';
const spanStyle = (span?: Span): CSSProperties | undefined =>
  span === 'full' ? { gridColumn: '1 / -1' } : span ? { gridColumn: `span ${span}` } : undefined;

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
}: {
  name: keyof FormValues;
  label: string;
  type?: string;
  span?: Span;
  placeholder?: string;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const err = errors[name] as { message?: string } | undefined;
  return (
    <div className="form-field-group" style={spanStyle(span)}>
      <label htmlFor={`f-${name}`}>{label}</label>
      <input
        id={`f-${name}`}
        type={type}
        className="form-field-box"
        placeholder={placeholder ?? label}
        title={type === 'text' ? undefined : label}
        {...register(name)}
        aria-invalid={!!err}
      />
      <FieldError message={err?.message} />
    </div>
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

/** A titled section card; `cols` sets the grid (fields span 1 unless told otherwise). */
function Card({
  title,
  sub,
  cols = 4,
  children,
}: {
  title: string;
  sub: string;
  cols?: number;
  children: ReactNode;
}) {
  return (
    <div className="cx-card">
      <div className="cx-card-head">
        <div className="cx-title">
          <div>
            <h3>{title}</h3>
            <p>{sub}</p>
          </div>
        </div>
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
}: {
  lookups: LookupsResponse;
  which: 'consignee' | 'forwarder';
}) {
  const { register, control } = useFormContext<FormValues>();
  const { can } = useAuth();
  const clientId = useWatch({ control, name: 'clientId' });
  const addConsignee = useAddConsignee();
  const addForwarder = useAddForwarder();
  if (which === 'consignee') {
    const opts = [...lookups.consignees].sort(
      (a, b) => Number(b.clientId === clientId) - Number(a.clientId === clientId),
    );
    return (
      <div className="form-field-group" style={spanStyle(2)}>
        <label htmlFor="f-consigneeId">Consignee</label>
        <AddNewSelect
          id="f-consigneeId"
          label="Consignee"
          placeholder="Consignee"
          registration={register('consigneeId')}
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
  const arr = useFieldArray({ control, name: 'containers' });
  const errs = errors.containers as unknown as
    (Record<number, Record<string, { message?: string }>> & { message?: string }) | undefined;
  if (loadType !== 'FCL')
    return (
      <Card title="Containers" sub="Container numbers and seals" cols={1}>
        <p className={f.note}>
          Containers are recorded for CY / CY (FCL) shipments only. Change Terms above to add them.
        </p>
      </Card>
    );
  return (
    <Card title="Containers" sub="Container numbers and seals loaded on this shipment" cols={1}>
      <div>
        {arr.fields.length > 0 && (
          <div className="cdc-lines-wrap">
            <table className="cdc-lines-table">
              <thead>
                <tr>
                  <th>Container No.</th>
                  <th>Size</th>
                  <th>Liner Seal</th>
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
          onClick={() =>
            arr.append({ containerNo: '', size: '40HQ', linerSeal: '', customsSeal: '' })
          }
        >
          + Add Container
        </button>
      </div>
    </Card>
  );
}

/* ------------------------------ Steps ------------------------------ */

function buildSteps(
  direction: FormValues['direction'],
  lookups: LookupsResponse,
  detail: ShipmentDetail | undefined,
): Step[] {
  const countries = lookups.countries.map((c) => ({ value: c.iso2, label: c.name }));
  const ports = lookups.ports.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }));
  const units = lookups.values.QUANTITY_UNIT.map((v) => ({ value: v.value, label: v.label }));
  const materials = lookups.values.MATERIAL.map((v) => ({ value: v.value, label: v.label }));
  const coForms = lookups.values.CO_FORM.map((v) => ({ value: v.value, label: v.label }));
  const statuses = SHIPMENT_STATUSES.map((s) => ({ value: s, label: SHIPMENT_STATUS_LABEL[s] }));
  const clearance = CLEARANCE_STATUSES.map((s) => ({ value: s, label: CLEARANCE_STATUS_LABEL[s] }));

  const statusCard = (
    <Card title="Status" sub="Where the shipment and its customs clearance stand" cols={2}>
      <Select name="status" label="Shipment Status" options={statuses} />
      <Select name="clearanceStatus" label="Clearance Status" options={clearance} />
    </Card>
  );
  const thcCard = (
    <Card title="THC / HBL" sub="Terminal handling charge billed against the house bill">
      <Field name="thcHblNo" label="THC / HBL No." span={2} />
      <Field name="thcHblDate" label="THC / HBL Date" type="date" />
      <Field name="thcHblAmount" label="Amount (USD)" placeholder="0.00" />
    </Card>
  );
  const remarkCard = (
    <Card title="Remark" sub="Anything the team should know about this shipment" cols={1}>
      <Field name="remark" label="Remark" span="full" placeholder="Optional note" />
    </Card>
  );

  if (direction === 'EXPORT') {
    return [
      {
        label: 'Cargo Information',
        fields: [
          'clientId',
          'consigneeId',
          'forwarderId',
          'destinationCountryIso2',
          'quantity',
          'quantityUnit',
          'invoices',
        ],
        render: () => (
          <>
            <Card title="Parties & Destination" sub="Who receives the goods and who moves them">
              <PartiesFields lookups={lookups} which="consignee" />
              <PartiesFields lookups={lookups} which="forwarder" />
            </Card>
            <Card title="Cargo" sub="What is shipped and where it goes">
              <Select
                name="destinationCountryIso2"
                label="Destination Country"
                options={countries}
                placeholder="Select country"
              />
              <Field name="quantity" label="Quantity" placeholder="0" />
              <Select name="quantityUnit" label="Unit" options={units} placeholder="Select unit" />
              <Select
                name="material"
                label="Material"
                options={materials}
                placeholder="Select material"
              />
            </Card>
            <CargoSection shipmentId={detail?.id} />
          </>
        ),
      },
      {
        label: 'Booking, Container & Clearance',
        fields: [
          'bookingNo',
          'crd',
          'hblNo',
          'clearancePortId',
          'etdPort',
          'etd',
          'atd',
          'eta',
          'status',
          'clearanceStatus',
          'containers',
          'loadType',
        ],
        render: () => (
          <>
            <Card title="Booking & Clearance" sub="Booking references and the clearance port">
              <Field name="bookingNo" label="Booking / SO No." span={2} />
              <Field name="hblNo" label="HBL No." />
              <Field name="crd" label="CRD" type="date" />
              <Select
                name="clearancePortId"
                label="Clearance Port"
                options={ports}
                placeholder="Select port"
                span={2}
              />
              <Field name="etdPort" label="ETD Port" span={2} placeholder="e.g. Sihanoukville" />
            </Card>
            <Card title="Schedule" sub="Departure and arrival dates" cols={3}>
              <Field name="etd" label="ETD" type="date" />
              <Field name="atd" label="ATD (Actual Departure)" type="date" />
              <Field name="eta" label="ETA Port" type="date" />
            </Card>
            <ContainersCard />
            {statusCard}
          </>
        ),
      },
      {
        label: 'Vessel, CO & Customs Declaration',
        fields: [
          'vesselName',
          'voyageNo',
          'coForm',
          'coNumber',
          'coStatus',
          'thcHblNo',
          'thcHblDate',
          'thcHblAmount',
          'declarations',
          'remark',
        ],
        render: () => (
          <>
            <Card
              title="Vessel & Certificate of Origin"
              sub="Vessel details and the CO issued for this shipment"
            >
              <Field name="vesselName" label="Vessel Name" span={2} />
              <Field name="voyageNo" label="Voyage No." span={2} />
              <Select name="coForm" label="CO Form" options={coForms} placeholder="Select form" />
              <Field name="coNumber" label="CO Number" span={2} />
              <Field name="coStatus" label="CO Status" placeholder="e.g. Active" />
            </Card>
            {thcCard}
            <DeclarationsSection ports={lookups.ports} original={detail} />
            {remarkCard}
          </>
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
        'material',
        'forwarderId',
        'broker',
        'originCountryIso2',
      ],
      render: () => (
        <>
          <Card title="Parties" sub="Supplier, factory consignee and the agents handling it">
            <Field name="shipperName" label="Shipper Name" span={2} placeholder="Supplier name" />
            <PartiesFields lookups={lookups} which="consignee" />
            <PartiesFields lookups={lookups} which="forwarder" />
            <Field name="broker" label="Broker" span={2} placeholder="Customs broker" />
          </Card>
          <Card title="Cargo" sub="What is being imported and where it comes from">
            <Field name="quantity" label="Quantity" placeholder="0" />
            <Select name="quantityUnit" label="Unit" options={units} placeholder="Select unit" />
            <Select
              name="material"
              label="Material"
              options={materials}
              placeholder="Select material"
            />
            <Select
              name="originCountryIso2"
              label="Origin Country"
              options={countries}
              placeholder="Select country"
            />
          </Card>
        </>
      ),
    },
    {
      label: 'Item, Costing & Forwarding',
      fields: ['invoices', 'thcHblNo', 'thcHblDate', 'thcHblAmount'],
      render: () => (
        <>
          <CargoSection shipmentId={detail?.id} />
          {thcCard}
        </>
      ),
    },
    {
      label: 'Origin, Destination & Vessel',
      fields: [
        'hblNo',
        'clearancePortId',
        'etd',
        'eta',
        'ata',
        'arriveFty',
        'vesselName',
        'voyageNo',
        'coNumber',
        'status',
        'clearanceStatus',
        'containers',
        'loadType',
      ],
      render: () => (
        <>
          <Card title="Vessel & Clearance" sub="Vessel, house bill and where it clears customs">
            <Field name="vesselName" label="Vessel Name" span={2} />
            <Field name="voyageNo" label="Voyage No." />
            <Field name="hblNo" label="HBL No." />
            <Select
              name="clearancePortId"
              label="Clearance Port"
              options={ports}
              placeholder="Select port"
              span={2}
            />
            <Field name="coNumber" label="CO Number" span={2} />
          </Card>
          <Card title="Schedule" sub="Arrival at port and delivery to the factory">
            <Field name="etd" label="ETD" type="date" />
            <Field name="eta" label="ETA Port" type="date" />
            <Field name="ata" label="Actual Arrival (ATA)" type="date" />
            <Field name="arriveFty" label="ETA Factory" type="date" />
          </Card>
          <ContainersCard />
          {statusCard}
        </>
      ),
    },
    {
      label: 'Weights & Declaration',
      fields: ['declarations', 'remark'],
      render: () => (
        <>
          <DeclarationsSection ports={lookups.ports} original={detail} />
          {remarkCard}
        </>
      ),
    },
  ];
}
