import { useEffect, useMemo, useRef, useState } from 'react';
import { useFieldArray, useForm, useWatch, type Control } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BILLING_DOC_SCHEMAS, computeLinesTotal, lineAmount, type BillingDoc } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import {
  useCompany,
  useCreditNoteMessages,
  useDoc,
  useDocAction,
  usePrefill,
} from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, FieldError } from '../../components/ui';
import { Pill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { downloadFile } from '../../lib/files';
import { fmtMoney } from '../../lib/format';
import { formResolver } from '../../lib/zodForm';
import { icons } from '../../layout/icons';
import { initialValues, type Values } from '../accounting/DocEditorPage';
import { DOC_STATUS_PILL } from '../accounting/DocsListPage';
import { CreditNote } from '../print/PrintDocPage';
import ps from '../print/print.module.css';
import { timeAgo } from './Inbox';
import { cnSeq } from './seq';
import s from './CreditNotedEditor.module.css';

const TYPE = 'credit-notes' as const;
const CN_STATUS_LABEL = { DRAFT: 'Draft', ISSUED: 'Submitted', VOID: 'Discarded' } as const;
const A4_WIDTH = 794; // 210mm at 96dpi

/** /credit-noted/:id (or /accounting/credit-notes/:id): loads the note or a fresh draft. */
export function CreditNotedRoute({ base }: { base: string }) {
  const { id = 'new' } = useParams();
  const [params] = useSearchParams();
  const docId = id === 'new' ? undefined : id;
  const recordId = docId ? null : params.get('recordId');
  const declarationId = docId ? null : params.get('declarationId');
  const doc = useDoc(TYPE, docId);
  const pre = usePrefill(TYPE, recordId, declarationId);
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
    <CreditNotedEditor
      key={`${id}-${recordId ?? ''}-${declarationId ?? ''}`}
      base={base}
      doc={doc.data}
      prefill={pre.data}
    />
  );
}

/**
 * Credit Noted (Chea / customs broker payment voucher), laid out like the accounting
 * engine: the form on the left, the A4 voucher updating live on the right.
 * "Submit to Monthly" issues it; its total becomes the declaration's Clear Fee.
 */
function CreditNotedEditor({
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
  const editable = can('creditnotes:write') && (!doc || doc.status === 'DRAFT');
  const defaults = useMemo(() => {
    const v = initialValues(TYPE, doc, prefill);
    // A blank note bills the company, as the broker's vouchers always do.
    if (!v.billTo && company.data?.nameEn) v.billTo = company.data.nameEn.toUpperCase();
    if (!v.address && company.data?.addressEn) v.address = company.data.addressEn;
    if (!v.refType) v.refType = 'HOUSE_BILL';
    return v;
  }, [doc, prefill, company.data]);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
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

  // Live preview: the print layout fed with what's in the form right now.
  const preview: BillingDoc = {
    id: doc?.id ?? 'preview',
    type: TYPE,
    number: doc?.number ?? '',
    date: String(values.cnDate ?? ''),
    status: doc?.status ?? 'ISSUED',
    clientId: String(values.clientId ?? ''),
    clientCode: '',
    clientName: '',
    accountingRecordId: doc?.accountingRecordId ?? null,
    declareNo: String(values.declareNo ?? '') || null,
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
      else toast(doc ? 'Saved.' : `Credit Noted No. ${cnSeq(saved.number)} saved as a draft.`);
      if (!doc) navigate(`${base}/${saved.id}`, { replace: true });
    })();

  const submit = () =>
    save(async (saved) => {
      if (
        !window.confirm(
          `Submit Credit Noted No. ${cnSeq(saved.number)} to the Monthly Ledger?\n\n` +
            `${fmtMoney(saved.totals.total)} becomes the Clear Fee of declaration ${saved.declareNo ?? '(none)'}, ` +
            `and the credit note can no longer be edited.`,
        )
      )
        return;
      await action.mutateAsync({ action: 'issue', id: saved.id });
      toast(`Credit Noted No. ${cnSeq(saved.number)} submitted to the Monthly Ledger.`);
    });

  /** Discard (cancel) a submitted note: its Clear Fee comes back out of the Monthly Ledger. */
  const discard = async () => {
    if (!doc) return;
    const reason = window.prompt(
      'Why discard this credit note? Its Clear Fee is taken back out of the Monthly Ledger.',
    );
    if (!reason) return;
    await action.mutateAsync({ action: 'void', id: doc.id, body: { reason } });
    toast('Credit Noted discarded.');
  };
  const remove = async () => {
    if (!doc || !window.confirm('Delete this draft?')) return;
    await action.mutateAsync({ action: 'delete', id: doc.id });
    toast('Draft deleted.');
    navigate(base);
  };
  const needsSave = !doc || isDirty;
  const openPrint = () => window.open(`/print/${TYPE}/${doc!.id}`, '_blank', 'noreferrer');

  const err = (name: string) =>
    (errors as Record<string, { message?: string } | undefined>)[name]?.message;
  const lineErr = (i: number, f: string) =>
    (errors.lines as unknown as Record<number, Record<string, { message?: string }>> | undefined)?.[
      i
    ]?.[f]?.message;
  const field = (name: string, label: string, opts: { type?: string; span?: boolean } = {}) => (
    <label className={s.field} style={opts.span ? { gridColumn: '1 / -1' } : undefined}>
      <span>{label}</span>
      <input
        type={opts.type ?? 'text'}
        className="form-field-box"
        {...register(name)}
        aria-invalid={!!err(name)}
      />
      <FieldError message={err(name)} />
    </label>
  );

  return (
    <section className={`view active ${s.wrap}`}>
      <div className={s.editor}>
        <header className={s.head}>
          <div className={s.headText}>
            <Link to={base} className={s.back}>
              ← Credit Noted
            </Link>
            <h2>
              Credit Noted (Chea Payment){' '}
              {doc?.number && <span className={s.number}>No. {cnSeq(doc.number)}</span>}{' '}
              {doc && (
                <Pill tone={DOC_STATUS_PILL[doc.status].tone}>{CN_STATUS_LABEL[doc.status]}</Pill>
              )}
            </h2>
            <p>Generate clean payment vouchers for operations &amp; finance</p>
          </div>
          <div className={s.headActions}>
            {editable && (
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
            {can('accounting:write') && doc?.status === 'ISSUED' && (
              <button type="button" className="btn-delete-shipment" onClick={() => void discard()}>
                Discard
              </button>
            )}
          </div>
        </header>
        <ReviewBanner doc={doc} />
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
            <section className={s.card}>
              <h3>1. Header information</h3>
              <div className={s.grid}>
                {field('billTo', 'Bill to', { span: true })}
                {field('cnDate', 'Date', { type: 'date' })}
                {field('declareNo', 'Declare no')}
                <label className={s.field}>
                  <span>Client</span>
                  <select
                    className="form-select-box"
                    {...register('clientId')}
                    disabled={!!defaults.declareNo && !!defaults.clientId}
                  >
                    <option value="">Choose…</option>
                    {lookups.data?.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                  <FieldError message={err('clientId')} />
                </label>
                {field('shipper', 'Shipper / factory')}
                <label className={s.field} style={{ gridColumn: '1 / -1' }}>
                  <span>Address</span>
                  <textarea rows={2} className="form-field-box" {...register('address')} />
                </label>
                <label className={s.field}>
                  <span>Port</span>
                  <select className="form-select-box" {...register('portId')}>
                    <option value="">—</option>
                    {lookups.data?.ports.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                {field('containerNo', 'Container')}
                <label className={s.field}>
                  <span>Ref type / number</span>
                  <div className={s.pair}>
                    <select className="form-select-box" {...register('refType')}>
                      <option value="HOUSE_BILL">House bill</option>
                      <option value="BILL_NO">Bill no.</option>
                      <option value="HAWB_NO">HAWB no.</option>
                    </select>
                    <input className="form-field-box" {...register('refNo')} />
                  </div>
                </label>
                {field('quantityText', 'Qty / unit')}
                {field('grossWeightKg', 'Gross weight (kg)')}
                {field('cbm', 'CBM')}
              </div>
            </section>

            <section className={s.card}>
              <h3>2. Credit noted line items</h3>
              <FieldError message={(errors.lines as { message?: string } | undefined)?.message} />
              <div className={s.lineHead}>
                <span>#</span>
                <span>Description</span>
                <span>Qty</span>
                <span>Unit</span>
                <span>Price</span>
                <span>Mark</span>
                <span className={s.right}>Total</span>
                <span />
              </div>
              {lines.fields.map((f, i) => {
                const l = values.lines?.[i];
                return (
                  <div className={s.line} key={f.id}>
                    <span className={s.no}>{i + 1}</span>
                    <input
                      className="form-field-box"
                      {...register(`lines.${i}.description`)}
                      aria-invalid={!!lineErr(i, 'description')}
                      title={lineErr(i, 'description')}
                    />
                    <input
                      className="form-field-box"
                      inputMode="decimal"
                      {...register(`lines.${i}.qty`)}
                    />
                    <input className="form-field-box" {...register(`lines.${i}.unit`)} />
                    <input
                      className="form-field-box"
                      inputMode="decimal"
                      placeholder="0.00"
                      {...register(`lines.${i}.unitPrice`)}
                      aria-invalid={!!lineErr(i, 'unitPrice')}
                      title={lineErr(i, 'unitPrice')}
                    />
                    <input className="form-field-box" {...register(`lines.${i}.mark`)} />
                    <span className={s.lineTotal}>
                      {fmtMoney(lineAmount(l?.qty, l?.unitPrice))}
                    </span>
                    {editable && lines.fields.length > 1 ? (
                      <button
                        type="button"
                        className={s.remove}
                        onClick={() => lines.remove(i)}
                        aria-label={`Remove line ${i + 1}`}
                      >
                        ×
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                );
              })}
              {editable && (
                <button
                  type="button"
                  className={s.addLine}
                  onClick={() =>
                    lines.append({
                      description: '',
                      qty: '1',
                      unit: 'SHIP',
                      unitPrice: '',
                      mark: '',
                    })
                  }
                >
                  + Add item
                </button>
              )}
              <div className={s.totalRow}>
                <span>Total</span>
                <b>{fmtMoney(total)}</b>
              </div>
            </section>
            {!editable && doc && (
              <p className={s.note}>
                {doc.status === 'DRAFT'
                  ? 'Read only for your role.'
                  : doc.status === 'ISSUED'
                    ? 'Submitted to the Monthly Ledger; it can no longer be edited.'
                    : 'This credit note was discarded.'}
              </p>
            )}
          </fieldset>
        </form>

        <footer className={s.foot}>
          <button
            type="button"
            className={s.footBtn}
            disabled={needsSave}
            title={needsSave ? 'Save first' : undefined}
            onClick={openPrint}
          >
            Print
          </button>
          <button
            type="button"
            className={`${s.footBtn} ${s.footPrimary}`}
            disabled={needsSave}
            title={needsSave ? 'Save first' : 'Opens the print view: choose "Save as PDF"'}
            onClick={openPrint}
          >
            PDF File
          </button>
          <button
            type="button"
            className={`${s.footBtn} ${s.footExcel}`}
            disabled={needsSave}
            title={needsSave ? 'Save first' : undefined}
            onClick={() =>
              downloadFile(`/accounting/docs/${TYPE}/${doc!.id}/export.xlsx`).catch(() =>
                toast('Export failed.'),
              )
            }
          >
            Excel Export
          </button>
          {editable && doc?.status === 'DRAFT' && (
            <button type="button" className={s.deleteLink} onClick={() => void remove()}>
              Delete draft
            </button>
          )}
        </footer>
      </div>

      <Preview>
        <CreditNote d={preview} />
      </Preview>
    </section>
  );
}

/** Accounting's latest word on this note: what to fix (returned as a draft), or Checked. */
function ReviewBanner({ doc }: { doc?: BillingDoc | undefined }) {
  const messages = useCreditNoteMessages(doc?.id);
  const m = messages.data?.[0];
  if (!doc || !m) return null;
  const returned = m.kind === 'REVISED' && doc.status === 'DRAFT';
  const checked = m.kind === 'CHECKED' && doc.status === 'ISSUED';
  if (!returned && !checked) return null;
  return (
    <div className={`${s.banner} ${returned ? s.bannerRevise : s.bannerCheck}`} role="status">
      <div className={s.bannerHead}>
        <b>{returned ? 'Returned by accounting for revision' : 'Checked by accounting'}</b>
        <span>
          {m.senderName ?? 'Accounting'} · {timeAgo(m.createdAt)}
        </span>
      </div>
      {m.body && <p className={s.bannerBody}>{m.body}</p>}
      {returned && (
        <p className={s.bannerHint}>Make the changes, then press “Submit to Monthly” again.</p>
      )}
    </div>
  );
}

/** The A4 sheet, scaled down to fit the pane width. */
function Preview({ children }: { children: React.ReactNode }) {
  const pane = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setScale(Math.min(1, (el.clientWidth - 48) / A4_WIDTH));
      setHeight(sheet.current?.offsetHeight ?? 0);
    });
    ro.observe(el);
    if (sheet.current) ro.observe(sheet.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div className={s.preview} ref={pane} aria-label="Credit Noted preview">
      <div style={{ height: height * scale, width: A4_WIDTH * scale }}>
        <div
          ref={sheet}
          // Paper stays paper: what the print page's wrapper gives the sheet, so dark mode
          // doesn't leak in.
          data-theme="light"
          className={ps.sheet}
          style={
            {
              '--ink': '#111827',
              '--line': '#9ca3af',
              color: 'var(--ink)',
              fontFamily: "'GS Khmer', 'Helvetica', Arial, sans-serif",
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              margin: 0,
            } as React.CSSProperties
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}
