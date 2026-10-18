import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useFieldArray, useForm, useWatch, type Control } from 'react-hook-form';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BackLink, backRow } from '../../components/BackLink';
import {
  BILLING_DOC_SCHEMAS,
  CONTAINER_SIZES,
  DEFAULT_CHARGE_UNITS,
  computeLinesTotal,
  lineAmount,
  type BillingDoc,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import {
  useCompany,
  useDoc,
  useDocAction,
  useEligible,
  usePrefill,
} from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, FieldError } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { Pill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { fmtMoney } from '../../lib/format';
import { formResolver } from '../../lib/zodForm';
import { icons } from '../../layout/icons';
import { RecordSummary, transportLabel } from '../print/PrintDocPage';
import { Preview, useFillWindow } from '../creditnoted/CreditNotedEditor';
import { printCreditNote } from '../creditnoted/creditNoteExport';
import { exportRecordSummaryExcel, recordSummaryFileName } from './recordSummaryExport';
import { initialValues, type Values } from './DocEditorPage';
import { DOC_STATUS_PILL } from './DocsListPage';
import s from '../creditnoted/CreditNotedEditor.module.css';
import r from './RecordSummaryEditor.module.css';

const TYPE = 'record-summaries' as const;
const BLANK_LINE = { description: '', qty: '1', unit: 'SHIP', unitPrice: '', mark: '' };
/** A blank summary starts with the accounting engine's import breakdown; prices to fill. */
const IMPORT_TEMPLATE = [
  { description: 'IMPORT PROCESSING FEE', mark: 'VAT 10%' },
  { description: 'THC FEE', mark: 'Receipt' },
  { description: 'CUSTOMS PROCESSING FEE', mark: 'Receipt' },
  { description: 'TRUCKING FEE', mark: '' },
  { description: 'LOLO AT PORT', mark: 'Receipt' },
].map((l) => ({ ...l, qty: '1', unit: '20GP', unitPrice: '' }));
/** The Transport Type dropdown: one choice sets both the mode and the load. */
const TRANSPORTS = [
  ['SEA', 'FCL'],
  ['SEA', 'LCL'],
  ['AIR', 'NONE'],
  ['ROAD', 'LCL'],
  ['ROAD', 'FCL'],
] as const;

/**
 * A record summary from either list: /record-summary/:id (sidebar) or
 * /accounting/record-summaries/:id; "new" for a new one. A new summary picks its shipment
 * from the Declare No. box, which fills it in from the Monthly Ledger.
 */
export function RecordSummaryRoute({ base }: { base: string }) {
  const { id = 'new' } = useParams();
  const [params] = useSearchParams();
  const docId = id === 'new' ? undefined : id;
  const recordId = docId ? null : params.get('recordId');
  const doc = useDoc(TYPE, docId);
  const pre = usePrefill(TYPE, recordId);
  const lookups = useLookups();
  if (doc.isLoading || pre.isLoading || lookups.isLoading)
    return (
      <section className="view active">
        <div className="card">Loading…</div>
      </section>
    );
  if (doc.error || pre.error)
    return (
      <section className="view active">
        <ErrorBanner error={doc.error ?? pre.error} />
      </section>
    );
  return (
    <RecordSummaryEditor
      key={`${id}-${recordId ?? ''}`}
      base={base}
      doc={doc.data}
      prefill={pre.data}
    />
  );
}

/**
 * Record Summary Operations, laid out like the accounting engine: the form on the left, the
 * A4 sheet updating live on the right. "Submit to Monthly" issues it (locks it).
 */
function RecordSummaryEditor({
  base,
  doc,
  prefill,
}: {
  base: string;
  doc?: BillingDoc | undefined;
  prefill?: Record<string, unknown> | undefined;
}) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const lookups = useLookups();
  const company = useCompany();
  const action = useDocAction(TYPE);
  const editable = can('recordsummaries:write') && (!doc || doc.status === 'DRAFT');
  const fresh = !doc && !prefill;
  const eligible = useEligible(TYPE);
  const defaults = useMemo(() => {
    const v = initialValues(TYPE, doc, prefill);
    if (!doc && !prefill) v.lines = IMPORT_TEMPLATE.map((l) => ({ ...l }));
    return v;
  }, [doc, prefill]);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<Values>({
    resolver: formResolver(BILLING_DOC_SCHEMAS[TYPE]) as never,
    defaultValues: defaults,
  });
  const lines = useFieldArray({
    control: control as unknown as Control<Pick<Values, 'lines'>>,
    name: 'lines',
  });
  const values = useWatch({ control }) as Values;
  const total = computeLinesTotal(
    (values.lines ?? []).map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })),
  );
  const client = lookups.data?.clients.find((c) => c.id === values.clientId);
  const declareNo = String(values.declareNo ?? '') || doc?.declareNo || '';

  // Descriptions and units: suggestions from Settings → Dropdown lists, still free text.
  const charges = [
    ...new Set([
      ...defaults.lines.map((l) => l.description).filter(Boolean),
      ...IMPORT_TEMPLATE.map((l) => l.description),
      ...(lookups.data?.values.CHARGE ?? []).map((c) => c.label),
    ]),
  ];
  const units = [
    ...new Set([
      ...DEFAULT_CHARGE_UNITS,
      ...CONTAINER_SIZES,
      ...(lookups.data?.values.CHARGE_UNIT ?? []).map((u) => u.label),
    ]),
  ];

  /** A Declare No. of an approved shipment: reopen as that shipment's summary, filled in. */
  const pickDeclareNo = (typed: string) => {
    if (doc) return;
    const hit = eligible.data?.find(
      (e) => e.declareNo.toUpperCase() === typed.trim().toUpperCase(),
    );
    if (hit && hit.recordId !== defaults.accountingRecordId)
      navigate(`${base}/new?recordId=${hit.recordId}`, { replace: true });
  };

  // Live preview: the print layout fed with what's in the form right now.
  const preview = {
    id: doc?.id ?? 'preview',
    type: TYPE,
    number: null,
    date: String(values.summaryDate ?? ''),
    status: doc?.status ?? 'ISSUED',
    clientId: String(values.clientId ?? ''),
    clientCode: client?.code ?? '',
    clientName: client?.name ?? doc?.clientName ?? '',
    accountingRecordId: doc?.accountingRecordId ?? null,
    declareNo: declareNo || null,
    header: Object.fromEntries(
      Object.entries(values)
        .filter(([k]) => k !== 'lines')
        .map(([k, v]) => [k, v === undefined || v === null ? null : String(v)]),
    ),
    lines: (values.lines ?? []).map((l, i) => ({
      id: String(i),
      lineNo: i + 1,
      description: l.description,
      qty: l.qty || '0',
      unit: l.unit,
      unitPrice: l.unitPrice || '0',
      subtotal: lineAmount(l.qty, l.unitPrice),
      mark: l.mark,
    })),
    totals: { subtotal: total, vat: '0', total },
    createdAt: doc?.createdAt ?? '',
    updatedAt: doc?.updatedAt ?? '',
  } as unknown as BillingDoc;

  const save = (after?: (saved: BillingDoc) => Promise<void> | void) =>
    handleSubmit(async (v) => {
      const saved = (
        doc
          ? await action.mutateAsync({ action: 'update', id: doc.id, body: v })
          : await action.mutateAsync({ action: 'create', body: v })
      ) as BillingDoc;
      if (after) await after(saved);
      else toast(doc ? 'Saved.' : 'Record summary saved as a draft.');
      if (!doc) navigate(`${base}/${saved.id}`, { replace: true });
    })();

  const submit = () =>
    save(async (saved) => {
      if (
        !window.confirm(
          `Submit the record summary for ${saved.declareNo ?? (declareNo || 'this shipment')}?\n\n` +
            'It is issued and can no longer be edited.',
        )
      )
        return;
      await action.mutateAsync({ action: 'issue', id: saved.id });
      toast('Record summary submitted.');
    });
  const voidDoc = async () => {
    if (!doc) return;
    const reason = window.prompt(
      'Why is this record summary being cancelled? (Kept in the audit log)',
    );
    if (!reason) return;
    await action.mutateAsync({ action: 'void', id: doc.id, body: { reason } });
    toast('Record summary cancelled.');
  };
  const remove = async () => {
    if (!doc || !window.confirm('Delete this draft?')) return;
    await action.mutateAsync({ action: 'delete', id: doc.id });
    toast('Draft deleted.');
    navigate(base, { replace: true });
  };

  // Print / PDF use the live preview, so what's on screen is what comes out.
  const sheetRef = useRef<HTMLDivElement>(null);
  const fileName = recordSummaryFileName(preview);
  const printSheet = (title: string) => {
    if (sheetRef.current) printCreditNote(sheetRef.current, title);
  };
  // Excel is built from the live preview too, laid out like the sheet (as Credit Noted's is).
  const [exporting, setExporting] = useState(false);
  const exportExcel = async () => {
    setExporting(true);
    try {
      await exportRecordSummaryExcel(
        preview,
        company.data ?? {},
        lookups.data?.ports.find((p) => p.id === values.portId)?.code,
        lookups.data?.forwarders.find((f) => f.id === values.forwarderId)?.name,
      );
    } catch {
      toast('Excel export failed. Try again.');
    } finally {
      setExporting(false);
    }
  };

  const err = (name: string) =>
    (errors as Record<string, { message?: string } | undefined>)[name]?.message;
  const lineErr = (i: number, f: string) =>
    (errors.lines as unknown as Record<number, Record<string, { message?: string }>> | undefined)?.[
      i
    ]?.[f]?.message;
  const item = (label: string, control: ReactNode, name?: string, amber = false) => (
    <label className={`${r.item}${amber ? ` ${r.amber}` : ''}`}>
      <span>{label}</span>
      {control}
      {name && <FieldError message={err(name)} />}
    </label>
  );
  const text = (name: string, label: string, opts: { type?: string } = {}) =>
    item(
      label,
      <input
        type={opts.type ?? 'text'}
        className="form-field-box"
        {...register(name)}
        aria-invalid={!!err(name)}
      />,
      name,
    );
  /**
   * INV / DIS / DN: frozen. They come from the Monthly Ledger (the server sends them live and
   * ignores anything typed), given when the accountant checks the shipment's Chea payment.
   */
  const linked = !!defaults.accountingRecordId;
  const ledgerNo = (name: 'invNo' | 'disNo' | 'dnNo', label: string) =>
    item(
      label,
      <input
        className={`form-field-box ${r.frozen}`}
        value={String(values[name] ?? '')}
        readOnly
        tabIndex={-1}
        placeholder={linked ? 'Awaiting accountant approval' : 'From the Monthly Ledger'}
        title="Synced from the accountant's Monthly Ledger; it can't be typed here."
        aria-readonly
      />,
      undefined,
      true,
    );
  const transport = `${String(values.transportMode ?? 'SEA')}|${String(values.loadType ?? 'FCL')}`;

  const wrapRef = useFillWindow();

  return (
    <section ref={wrapRef} className={`view active ${s.wrap}`}>
      <div className={s.editor}>
        <header className={s.head}>
          <div className={`${s.headText} ${backRow}`}>
            <BackLink to={base} label="Record Summary" />
            <h2>
              Record Summary Operations{' '}
              {doc && (
                <Pill tone={DOC_STATUS_PILL[doc.status].tone}>
                  {DOC_STATUS_PILL[doc.status].label}
                </Pill>
              )}
            </h2>
            <p>Live invoice numbers populate automatically from Monthly updates</p>
          </div>
          <div className={s.headActions}>
            {editable && doc?.status === 'DRAFT' && (
              <button
                type="button"
                className={s.headDelete}
                disabled={action.isPending}
                onClick={() => void remove()}
                aria-label="Delete draft"
                title="Delete draft"
              >
                {icons.trash({})}
              </button>
            )}
            {editable && doc && (
              <button
                type="button"
                className="btn-cancel-shipment"
                disabled={action.isPending}
                onClick={() => void save()}
              >
                Save draft
              </button>
            )}
            {editable && (
              <button
                type="button"
                className={s.submit}
                disabled={action.isPending}
                onClick={() => void submit()}
              >
                {icons.send({ width: 15, height: 15 })} Submit to Monthly
              </button>
            )}
            {can('recordsummaries:write') && doc?.status === 'ISSUED' && (
              <button type="button" className="btn-delete-shipment" onClick={() => void voidDoc()}>
                Cancel document
              </button>
            )}
          </div>
        </header>
        <ErrorBanner error={action.error} />

        <form
          className={s.body}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          noValidate
        >
          <fieldset disabled={!editable} className={s.fieldset}>
            <Panel title="1. Record summary header">
              <div className={r.grid2}>
                {item(
                  'Shipment mode',
                  <select className="form-select-box" {...register('direction')}>
                    <option value="IMPORT">IMPORT</option>
                    <option value="EXPORT">EXPORT</option>
                  </select>,
                )}
                {item(
                  'Transport type',
                  <select
                    className="form-select-box"
                    value={transport}
                    onChange={(e) => {
                      const [mode, load] = e.target.value.split('|');
                      setValue('transportMode', mode, { shouldDirty: true });
                      setValue('loadType', load, { shouldDirty: true });
                    }}
                  >
                    {!TRANSPORTS.some(([m, l]) => `${m}|${l}` === transport) && (
                      <option value={transport}>
                        {transportLabel(String(values.transportMode), String(values.loadType))}
                      </option>
                    )}
                    {TRANSPORTS.map(([m, l]) => (
                      <option key={`${m}|${l}`} value={`${m}|${l}`}>
                        {transportLabel(m, l)}
                      </option>
                    ))}
                  </select>,
                )}
              </div>
              <div className={r.grid3}>
                {ledgerNo('invNo', 'Invoice no')}
                {ledgerNo('disNo', 'Disbursement no')}
                {ledgerNo('dnNo', 'Debit note no')}
              </div>
              <div className={r.grid2}>
                {item(
                  'Factory / client',
                  <select
                    className="form-select-box"
                    {...register('clientId')}
                    disabled={!!defaults.accountingRecordId && !!defaults.clientId}
                    aria-invalid={!!err('clientId')}
                  >
                    <option value="">-- Select factory --</option>
                    {lookups.data?.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>,
                  'clientId',
                )}
                {item(
                  'Forwarder',
                  <select className="form-select-box" {...register('forwarderId')}>
                    <option value="">—</option>
                    {lookups.data?.forwarders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>,
                )}
              </div>
              <div className={r.grid3}>
                {item(
                  'Port',
                  <select className="form-select-box" {...register('portId')}>
                    <option value="">—</option>
                    {lookups.data?.ports.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} · {p.name}
                      </option>
                    ))}
                  </select>,
                )}
                {(() => {
                  const reg = register('declareNo');
                  return item(
                    'Declare no',
                    <input
                      className="form-field-box"
                      list={doc ? undefined : 'rs-declares'}
                      placeholder={doc ? undefined : 'e.g. I 122050'}
                      title={doc ? undefined : 'Pick an approved shipment to fill in its numbers'}
                      {...reg}
                      onChange={(e) => {
                        void reg.onChange(e);
                        pickDeclareNo(e.target.value);
                      }}
                    />,
                    'declareNo',
                  );
                })()}
                {text('summaryDate', 'Date', { type: 'date' })}
              </div>
              <div className={r.grid3}>
                {text('quantityText', 'Quantity')}
                {text('blNo', 'BL / HBL no')}
                {text('containerNo', 'Container no')}
              </div>
              <div className={r.grid3}>
                {item(
                  'Container size',
                  <select className="form-select-box" {...register('containerSize')}>
                    <option value="">—</option>
                    {CONTAINER_SIZES.map((v) => (
                      <option key={v} value={v}>
                        {v.replace(/^(\d+)/, "$1' ")}
                      </option>
                    ))}
                  </select>,
                )}
                {item(
                  'Gross weight (kg)',
                  <NumberInput
                    className="form-field-box"
                    decimals={3}
                    {...register('grossWeightKg')}
                  />,
                  'grossWeightKg',
                )}
                {item(
                  'CBM',
                  <NumberInput className="form-field-box" decimals={3} {...register('cbm')} />,
                  'cbm',
                )}
              </div>
              {fresh && editable && (
                <p className={r.hint}>
                  Type or pick the Declare No. of a Monthly Ledger shipment: its details fill in,
                  and its invoice, DIS and debit note numbers follow the ledger once the accountant
                  approves it.
                </p>
              )}
              <datalist id="rs-declares">
                {eligible.data?.map((e) => (
                  <option key={e.recordId} value={e.declareNo}>
                    {e.clientCode} · {e.number ?? 'awaiting approval'}
                  </option>
                ))}
              </datalist>
            </Panel>

            <Panel title="2. Breakdown line items">
              <FieldError message={(errors.lines as { message?: string } | undefined)?.message} />
              {lines.fields.map((f, i) => (
                <div className={r.rowItem} key={f.id}>
                  <span className={r.no}>{i + 1}</span>
                  <input
                    className={`form-field-box ${r.desc}`}
                    list="rs-charges"
                    {...register(`lines.${i}.description`)}
                    aria-label={`Line ${i + 1} description`}
                    aria-invalid={!!lineErr(i, 'description')}
                    title={lineErr(i, 'description') ?? values.lines?.[i]?.description}
                  />
                  <NumberInput
                    className={`form-field-box ${r.qty}`}
                    decimals={3}
                    {...register(`lines.${i}.qty`)}
                    aria-label={`Line ${i + 1} quantity`}
                  />
                  <input
                    className={`form-field-box ${r.unit}`}
                    list="rs-units"
                    {...register(`lines.${i}.unit`)}
                    aria-label={`Line ${i + 1} unit`}
                  />
                  <NumberInput
                    className={`form-field-box ${r.price}`}
                    decimals={4}
                    placeholder="Price"
                    {...register(`lines.${i}.unitPrice`)}
                    aria-label={`Line ${i + 1} price`}
                    aria-invalid={!!lineErr(i, 'unitPrice')}
                    title={lineErr(i, 'unitPrice')}
                  />
                  <input
                    className={`form-field-box ${r.mark}`}
                    {...register(`lines.${i}.mark`)}
                    placeholder="Mark"
                    aria-label={`Line ${i + 1} mark`}
                  />
                  {editable && (
                    // The last line can't go (a summary needs one), so the button clears it.
                    <button
                      type="button"
                      className={r.del}
                      onClick={() =>
                        lines.fields.length > 1 ? lines.remove(i) : lines.update(i, BLANK_LINE)
                      }
                      aria-label={`Remove line ${i + 1}`}
                      title={lines.fields.length > 1 ? 'Remove row' : 'Clear this row'}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <datalist id="rs-charges">
                {charges.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <datalist id="rs-units">
                {units.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
              {editable && (
                <button
                  type="button"
                  className={r.addItem}
                  onClick={() => lines.append(BLANK_LINE)}
                >
                  + Add Custom Row
                </button>
              )}
              <div className={s.totalRow}>
                <span>Total</span>
                <b>{fmtMoney(total)}</b>
              </div>
            </Panel>
            {!editable && doc && (
              <p className={s.note}>
                {doc.status === 'DRAFT'
                  ? 'Read only for your role.'
                  : doc.status === 'ISSUED'
                    ? 'Submitted; it can no longer be edited.'
                    : 'This record summary was cancelled.'}
              </p>
            )}
          </fieldset>
        </form>

        <footer className={s.foot}>
          <button
            type="button"
            className={s.footBtn}
            onClick={() => printSheet(document.title)}
            title="Print the record summary as shown on the right"
          >
            Print
          </button>
          <button
            type="button"
            className={`${s.footBtn} ${s.footPrimary}`}
            onClick={() => printSheet(fileName)}
            title={`Choose "Save as PDF" in the print window (${fileName}.pdf)`}
          >
            PDF File
          </button>
          <button
            type="button"
            className={`${s.footBtn} ${s.footExcel}`}
            disabled={exporting}
            title={`${recordSummaryFileName(preview)}.xlsx`}
            onClick={() => void exportExcel()}
          >
            {exporting ? 'Exporting…' : 'Excel Export'}
          </button>
        </footer>
      </div>

      <Preview label="Record Summary preview">
        <div ref={sheetRef}>
          <RecordSummary d={preview} c={company.data ?? {}} />
        </div>
      </Preview>
    </section>
  );
}

/** A numbered section that folds up from its grey header bar, as in the accounting engine. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`${r.panel}${open ? ` ${r.open}` : ''}`}>
      <button
        type="button"
        className={r.panelHead}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {title}
      </button>
      {open && <div className={r.panelBody}>{children}</div>}
    </section>
  );
}
