import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { ApiError } from '../../lib/api';
import { formResolver } from '../../lib/zodForm';
import { AddNewSelect } from './AddNewSelect';
import { CargoSection } from './CargoSection';
import { DeclarationsSection } from './DeclarationsSection';
import { cleanForSubmit, emptyForm, fromDetail, type FormValues } from './formModel';

interface Step {
  label: string;
  /** Top-level form fields shown in this step (used to jump to the first error). */
  fields: (keyof FormValues)[];
  render: () => ReactNode;
}

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
  const direction = useWatch({ control, name: 'direction' });
  const transportMode = useWatch({ control, name: 'transportMode' });
  const [step, setStep] = useState(0);
  const [violations, setViolations] = useState<OverImportViolation[] | null>(null);
  const readOnly = !can('shipments:write');

  // Air has no CY/CY or LCL load type.
  useEffect(() => {
    if (transportMode === 'AIR') setValue('loadType', 'NONE');
  }, [transportMode, setValue]);

  const steps = useMemo(() => buildSteps(direction, lookups, detail), [direction, lookups, detail]);
  const current = Math.min(step, steps.length - 1);
  const isLast = current === steps.length - 1;

  const onInvalid = (errs: FieldErrors<FormValues>) => {
    const keys = Object.keys(errs) as (keyof FormValues)[];
    const target = steps.findIndex((s) => s.fields.some((f) => keys.includes(f)));
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

  const pill = (label: string, el: ReactNode, wide = false) => (
    <label className={`ship-field${wide ? ' ship-wide' : ''}`}>
      <span className="ship-cap">{label}</span>
      <span className="ship-sel">{el}</span>
    </label>
  );

  return (
    <section className="view active">
      <div className="shipment-create-container">
        <div>
          <div className="create-header-title">
            {detail ? `${detail.reference} · ${detail.clientName}` : 'Create your new shipment'}
          </div>
          <div className="create-header-desc">
            {detail
              ? `Last updated ${new Date(detail.updatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Phnom_Penh' })}`
              : 'Shipment details, cargo invoices and customs declarations in one record.'}
          </div>
        </div>
        <FormProvider {...methods}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (isLast) void submit();
              else setStep(current + 1);
            }}
            noValidate
          >
            <fieldset disabled={readOnly} style={{ border: 'none', minWidth: 0 }}>
              <div className="create-top-bar">
                <div className="top-pills-left">
                  {pill(
                    'Client',
                    <select
                      className="custom-select-pill"
                      {...register('clientId')}
                      disabled={!!detail && detail.declarations.some((d) => d.hasLedgerEntry)}
                    >
                      {lookups.clients
                        .filter((c) => c.status !== 'INACTIVE' || c.id === detail?.clientId)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name.toUpperCase()}
                          </option>
                        ))}
                    </select>,
                    true,
                  )}
                  {pill(
                    'Shipment type',
                    <select
                      className="custom-select-pill"
                      {...register('direction', { onChange: () => setStep(0) })}
                    >
                      <option value="EXPORT">EXPORT</option>
                      <option value="IMPORT">IMPORT</option>
                    </select>,
                  )}
                  {pill(
                    'Freight',
                    <select className="custom-select-pill" {...register('transportMode')}>
                      <option value="SEA">BY SEA</option>
                      <option value="AIR">BY AIR</option>
                      <option value="ROAD">BY TRUCK</option>
                      <option value="RAIL">BY RAIL</option>
                    </select>,
                  )}
                  {pill(
                    'Terms',
                    <select
                      className="custom-select-pill"
                      {...register('loadType')}
                      disabled={transportMode === 'AIR'}
                    >
                      <option value="FCL">CY / CY</option>
                      <option value="LCL">CFS / CFS (LCL)</option>
                      <option value="NONE">Loose / Air</option>
                    </select>,
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {detail && can('shipments:delete') && (
                    <button
                      type="button"
                      className="btn-delete-shipment"
                      onClick={() => void remove()}
                      disabled={del.isPending}
                    >
                      Delete Shipment
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-cancel-shipment"
                    onClick={() => {
                      if (isDirty && !window.confirm('Discard your changes?')) return;
                      if (detail) navigate('/plans');
                      else navigate(-1);
                    }}
                  >
                    Cancel
                  </button>
                  {current > 0 && (
                    <button
                      type="button"
                      className="btn-cancel-shipment"
                      onClick={() => setStep(current - 1)}
                    >
                      Back
                    </button>
                  )}
                  {!readOnly && (
                    <button type="submit" className="btn-create-submit" disabled={save.isPending}>
                      {isLast
                        ? save.isPending
                          ? 'Saving…'
                          : detail
                            ? 'Save Changes'
                            : 'Create Shipment'
                        : 'Next'}
                    </button>
                  )}
                </div>
              </div>

              <div className="shipment-steps-bar" role="tablist">
                {steps.map((s, i) => {
                  const hasError = s.fields.some((f) => f in errors);
                  const state =
                    i === current ? 'is-active' : i < current ? 'is-completed' : 'is-pending';
                  return (
                    <button
                      type="button"
                      key={s.label}
                      role="tab"
                      aria-selected={i === current}
                      className={`step-item ${state}`}
                      onClick={() => setStep(i)}
                      style={hasError ? { color: 'var(--status-exception-fg)' } : undefined}
                    >
                      <span className="step-index">
                        {state === 'is-completed' && !hasError ? '✓' : i + 1}
                      </span>
                      <span>{s.label}</span>
                    </button>
                  );
                })}
              </div>

              <ErrorBanner error={violations ? null : (save.error ?? del.error)} />
              {violations && (
                <div
                  role="alert"
                  style={{
                    borderRadius: 10,
                    padding: '10px 14px',
                    marginBottom: 14,
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

              <div className="form-fields-set">{steps[current]!.render()}</div>
            </fieldset>
          </form>
        </FormProvider>
      </div>
    </section>
  );
}

/* ------------------------------ Field helpers ------------------------------ */

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
  span?: number;
  placeholder?: string;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const err = errors[name] as { message?: string } | undefined;
  return (
    <div className="form-field-group" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label htmlFor={`f-${name}`}>{label}</label>
      <input
        id={`f-${name}`}
        type={type}
        className="form-field-box"
        placeholder={placeholder ?? label}
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
  span?: number;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const err = errors[name] as { message?: string } | undefined;
  return (
    <div className="form-field-group" style={span ? { gridColumn: `span ${span}` } : undefined}>
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

function Card({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="form-section">
      <div className="cx-card">
        <div className="cx-card-head">
          <div className="cx-title">
            <div>
              <h3>{title}</h3>
              <p>{sub}</p>
            </div>
          </div>
        </div>
        <div className="form-fields-grid cx-info-grid">{children}</div>
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
      <div className="form-field-group cx-wide" style={{ gridColumn: 'span 2' }}>
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
    <div className="form-field-group cx-wide" style={{ gridColumn: 'span 2' }}>
      <label htmlFor="f-forwarderId">Forwarder</label>
      <AddNewSelect
        id="f-forwarderId"
        label="Forwarder"
        placeholder="Forwarder"
        registration={register('forwarderId')}
        options={lookups.forwarders.map((f) => ({ value: f.id, label: f.name }))}
        onCreate={
          can('shipments:write')
            ? async (name) => (await addForwarder.mutateAsync({ name })).id
            : undefined
        }
      />
    </div>
  );
}

function ContainersSection() {
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
      <p className="create-header-desc" style={{ gridColumn: '1 / -1' }}>
        Containers are recorded for CY/CY (FCL) shipments only.
      </p>
    );
  return (
    <div style={{ gridColumn: '1 / -1' }}>
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
            {arr.fields.map((f, i) => (
              <tr key={f.id}>
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
  const statusFields = (
    <>
      <Select name="status" label="Shipment Status" options={statuses} />
      <Select name="clearanceStatus" label="Clearance Status" options={clearance} />
    </>
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
            <Card title="Shipment Information" sub="Who is shipping, to where, and key references">
              <PartiesFields lookups={lookups} which="consignee" />
              <PartiesFields lookups={lookups} which="forwarder" />
              <Select
                name="destinationCountryIso2"
                label="Country"
                options={countries}
                placeholder="Country"
              />
              <Field name="quantity" label="Quantity" />
              <Select name="quantityUnit" label="Unit" options={units} placeholder="Unit" />
              <Select name="material" label="Material" options={materials} placeholder="Material" />
            </Card>
            <div className="form-section">
              <CargoSection shipmentId={detail?.id} />
            </div>
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
          <Card
            title="Booking, Container & Clearance"
            sub="Booking, the containers loaded and the clearance port"
          >
            <Field name="bookingNo" label="Booking / SO No." />
            <Field name="crd" label="CRD" type="date" />
            <Field name="hblNo" label="HBL No." />
            <Select name="clearancePortId" label="Port" options={ports} placeholder="Port" />
            <Field name="etdPort" label="ETD Port" />
            <Field name="etd" label="ETD" type="date" />
            <Field name="atd" label="ATD Date" type="date" />
            <Field name="eta" label="ETA Port" type="date" />
            {statusFields}
            <ContainersSection />
          </Card>
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
              <Field name="vesselName" label="Vessel Name" />
              <Field name="voyageNo" label="Voyage No." />
              <Select name="coForm" label="CO Form" options={coForms} placeholder="CO Form" />
              <Field name="coNumber" label="CO Number" />
              <Field name="coStatus" label="CO Status" placeholder="e.g. Active" />
              <Field name="thcHblNo" label="THC / HBL No." />
              <Field name="thcHblDate" label="THC / HBL Date" type="date" />
              <Field name="thcHblAmount" label="THC / HBL Amount (USD)" />
              <Field name="remark" label="Remark" span={4} />
            </Card>
            <div className="form-section">
              <DeclarationsSection ports={lookups.ports} original={detail} />
            </div>
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
        <Card
          title="Shipment Information"
          sub="Supplier, factory consignee and what is being imported"
        >
          <Field name="shipperName" label="Shipper Name" span={2} />
          <PartiesFields lookups={lookups} which="consignee" />
          <Field name="quantity" label="Quantity" />
          <Select name="quantityUnit" label="Unit" options={units} placeholder="Unit" />
          <Select name="material" label="Material" options={materials} placeholder="Material" />
          <Select
            name="originCountryIso2"
            label="Origin Country"
            options={countries}
            placeholder="Country"
          />
          <PartiesFields lookups={lookups} which="forwarder" />
          <Field name="broker" label="Broker" span={2} />
        </Card>
      ),
    },
    {
      label: 'Item, Costing & Forwarding',
      fields: ['invoices', 'thcHblNo', 'thcHblDate', 'thcHblAmount'],
      render: () => (
        <>
          <div className="form-section">
            <CargoSection shipmentId={detail?.id} />
          </div>
          <Card title="THC / HBL" sub="Terminal handling charge billed against the house bill">
            <Field name="thcHblNo" label="THC / HBL No." />
            <Field name="thcHblDate" label="THC / HBL Date" type="date" />
            <Field name="thcHblAmount" label="THC / HBL Amount (USD)" />
          </Card>
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
        <Card
          title="Origin, Destination & Vessel"
          sub="Arrival, clearance and delivery to the factory"
        >
          <Field name="hblNo" label="HBL No." />
          <Select
            name="clearancePortId"
            label="Clearance Port"
            options={ports}
            placeholder="Port"
          />
          <Field name="etd" label="ETD" type="date" />
          <Field name="eta" label="ETA Port" type="date" />
          <Field name="ata" label="Actual Arrival (ATA)" type="date" />
          <Field name="arriveFty" label="ETA Factory" type="date" />
          <Field name="vesselName" label="Vessel Name" />
          <Field name="voyageNo" label="Voyage No." />
          <Field name="coNumber" label="CO Number" />
          {statusFields}
          <ContainersSection />
        </Card>
      ),
    },
    {
      label: 'Weights & Declaration',
      fields: ['declarations', 'remark'],
      render: () => (
        <>
          <div className="form-section">
            <DeclarationsSection ports={lookups.ports} original={detail} />
          </div>
          <Card title="Remark" sub="Anything the team should know about this shipment">
            <Field name="remark" label="Remark" span={4} />
          </Card>
        </>
      ),
    },
  ];
}
