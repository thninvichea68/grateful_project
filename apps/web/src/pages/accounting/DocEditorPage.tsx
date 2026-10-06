import { useMemo } from 'react';
import { useFieldArray, useForm, useWatch, type Control } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  BILLING_DOC_SCHEMAS,
  BILLING_DOC_TYPES,
  computeLinesTotal,
  computeTaxDocument,
  computeTaxLine,
  lineAmount,
  usdToKhr,
  type BillingDoc,
  type BillingDocType,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useDoc, useDocAction, usePrefill } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, FieldError, ui } from '../../components/ui';
import { Pill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { downloadFile } from '../../lib/files';
import { fmtMoney } from '../../lib/format';
import { formResolver } from '../../lib/zodForm';
import { NotFoundPage } from '../NotFoundPage';
import { DOC_CONFIG } from './docConfig';
import { DOC_STATUS_PILL } from './DocsListPage';

type Values = Record<string, unknown> & {
  clientId: string;
  lines: { description: string; qty: string; unit: string; unitPrice: string; mark: string }[];
};

export function DocEditorPage() {
  const { type = '', id = 'new' } = useParams();
  const [params] = useSearchParams();
  if (!(BILLING_DOC_TYPES as readonly string[]).includes(type)) return <NotFoundPage />;
  const t = type as BillingDocType;
  return (
    <Loader
      key={`${t}-${id}-${params.get('recordId') ?? ''}`}
      type={t}
      id={id === 'new' ? undefined : id}
      recordId={params.get('recordId')}
    />
  );
}

function Loader({
  type,
  id,
  recordId,
}: {
  type: BillingDocType;
  id?: string | undefined;
  recordId: string | null;
}) {
  const doc = useDoc(type, id);
  const pre = usePrefill(type, id ? null : recordId);
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
  return <Editor type={type} doc={doc.data} prefill={pre.data} />;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(Number(v)));

function initialValues(
  type: BillingDocType,
  doc: BillingDoc | undefined,
  prefill: Record<string, unknown> | undefined,
): Values {
  const cfg = DOC_CONFIG[type];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(
    new Date(),
  );
  const header: Record<string, string> = {};
  for (const f of cfg.fields)
    header[f.name] =
      f.type === 'number'
        ? num((doc?.header ?? prefill)?.[f.name])
        : str((doc?.header ?? prefill)?.[f.name]);
  if (!header[cfg.dateField]) header[cfg.dateField] = today;
  if ('exchangeRate' in header && !header.exchangeRate) header.exchangeRate = '4026';
  if (type === 'record-summaries') {
    header.direction ||= 'IMPORT';
    header.transportMode ||= 'SEA';
    header.loadType ||= 'FCL';
  }
  const lines = (doc?.lines ?? (prefill?.lines as Values['lines'] | undefined) ?? []).map((l) => ({
    description: str(l.description),
    qty: num(l.qty),
    unit: str(l.unit),
    unitPrice: num(l.unitPrice),
    mark: str(l.mark),
  }));
  return {
    ...header,
    accountingRecordId: doc?.accountingRecordId ?? str(prefill?.accountingRecordId),
    clientId: doc?.clientId ?? str(prefill?.clientId),
    lines: lines.length
      ? lines
      : [{ description: '', qty: '1', unit: 'SHIP', unitPrice: '', mark: '' }],
  };
}

function Editor({
  type,
  doc,
  prefill,
}: {
  type: BillingDocType;
  doc?: BillingDoc | undefined;
  prefill?: Record<string, unknown> | undefined;
}) {
  const cfg = DOC_CONFIG[type];
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const lookups = useLookups();
  const action = useDocAction(type);
  const editable = can('accounting:write') && (!doc || doc.status === 'DRAFT');
  const defaults = useMemo(() => initialValues(type, doc, prefill), [type, doc, prefill]);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<Values>({
    resolver: formResolver(BILLING_DOC_SCHEMAS[type]) as never,
    defaultValues: defaults,
  });
  // Header fields vary by document type (index signature), so give the field array a narrow view of the form.
  const lines = useFieldArray({
    control: control as unknown as Control<Pick<Values, 'lines'>>,
    name: 'lines',
  });
  const watched = useWatch({ control, name: 'lines' });
  const rate = useWatch({ control, name: 'exchangeRate' }) as unknown as string | undefined;

  const totals = cfg.tax
    ? computeTaxDocument(
        (watched ?? []).map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })),
        rate,
      )
    : (() => {
        const total = computeLinesTotal(
          (watched ?? []).map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })),
        );
        return {
          subtotal: total,
          vat: 0,
          total,
          totalKhr: cfg.khr ? usdToKhr(total, rate) : undefined,
        };
      })();

  const save = handleSubmit(async (values) => {
    const saved = doc
      ? await action.mutateAsync({ action: 'update', id: doc.id, body: values })
      : await action.mutateAsync({ action: 'create', body: values });
    toast(
      doc ? 'Saved.' : `${cfg.title} ${(saved as BillingDoc).number ?? ''} created as a draft.`,
    );
    if (!doc) navigate(`/accounting/${type}/${(saved as BillingDoc).id}`, { replace: true });
  });
  const issue = async () => {
    if (!doc) return;
    if (isDirty) return toast('Save your changes before issuing.');
    if (
      !window.confirm(
        `Issue ${cfg.title} ${doc.number ?? ''}? It can no longer be edited${cfg.numberField && type !== 'credit-notes' ? ', and its number and total go into the Monthly Ledger' : ''}.`,
      )
    )
      return;
    await action.mutateAsync({ action: 'issue', id: doc.id });
    toast(`${cfg.title} issued.`);
  };
  const voidDoc = async () => {
    if (!doc) return;
    const reason = window.prompt('Why is this document void? (kept in the audit log)');
    if (!reason) return;
    await action.mutateAsync({ action: 'void', id: doc.id, body: { reason } });
    toast(`${cfg.title} voided.`);
  };
  const remove = async () => {
    if (!doc || !window.confirm('Delete this draft?')) return;
    await action.mutateAsync({ action: 'delete', id: doc.id });
    toast('Draft deleted.');
    navigate(`/accounting/${type}`);
  };

  const err = (name: string) =>
    (errors as Record<string, { message?: string } | undefined>)[name]?.message;
  const lineErr = (i: number, f: string) =>
    (errors.lines as unknown as Record<number, Record<string, { message?: string }>> | undefined)?.[
      i
    ]?.[f]?.message;

  return (
    <section className="view active">
      <div className="shipment-create-container">
        <div className="create-top-bar">
          <div>
            <Link to={`/accounting/${type}`} className="create-header-desc">
              ← {cfg.title}s
            </Link>
            <div className="create-header-title">
              {cfg.title} {doc?.number ?? (doc ? (doc.declareNo ?? '') : '(new)')}{' '}
              {doc && (
                <Pill tone={DOC_STATUS_PILL[doc.status].tone}>
                  {DOC_STATUS_PILL[doc.status].label}
                </Pill>
              )}
            </div>
            <div className="create-header-desc">
              {doc?.declareNo || prefill
                ? `Declaration ${doc?.declareNo ?? str(prefill?.declareNo) ?? ''}`
                : 'Not linked to a ledger entry'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {doc && (
              <a
                className="filter-btn"
                href={`/print/${type}/${doc.id}`}
                target="_blank"
                rel="noreferrer"
              >
                Print / PDF
              </a>
            )}
            {doc && (
              <button
                type="button"
                className="filter-btn"
                onClick={() =>
                  downloadFile(`/accounting/docs/${type}/${doc.id}/export.xlsx`).catch(() =>
                    toast('Export failed.'),
                  )
                }
              >
                Excel
              </button>
            )}
            {can('accounting:write') && doc?.status === 'DRAFT' && (
              <button type="button" className="btn-delete-shipment" onClick={() => void remove()}>
                Delete draft
              </button>
            )}
            {can('accounting:write') && doc && doc.status !== 'VOID' && doc.status !== 'DRAFT' && (
              <button type="button" className="btn-delete-shipment" onClick={() => void voidDoc()}>
                Void
              </button>
            )}
            {editable && (
              <button
                type="button"
                className="btn-cancel-shipment"
                onClick={() => void save()}
                disabled={action.isPending}
              >
                {doc ? 'Save draft' : 'Create draft'}
              </button>
            )}
            {can('accounting:write') && doc?.status === 'DRAFT' && (
              <button
                type="button"
                className="btn-create-submit"
                onClick={() => void issue()}
                disabled={action.isPending}
              >
                Issue
              </button>
            )}
          </div>
        </div>
        <ErrorBanner error={action.error} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          noValidate
        >
          <fieldset disabled={!editable} style={{ border: 'none', minWidth: 0 }}>
            <div className="cx-card">
              <div className="form-fields-grid">
                <div className="form-field-group">
                  <label htmlFor="d-clientId">Client</label>
                  <select
                    id="d-clientId"
                    className="form-select-box"
                    {...register('clientId')}
                    disabled={!!defaults.accountingRecordId || !editable}
                  >
                    <option value="">Choose…</option>
                    {lookups.data?.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                  <FieldError message={err('clientId')} />
                </div>
                {cfg.fields.map((f) => (
                  <div
                    className="form-field-group"
                    key={f.name}
                    style={f.span ? { gridColumn: `span ${f.span}` } : undefined}
                  >
                    <label htmlFor={`d-${f.name}`}>{f.label}</label>
                    {f.type === 'select' ? (
                      <select id={`d-${f.name}`} className="form-select-box" {...register(f.name)}>
                        <option value="">—</option>
                        {lookups.data &&
                          f.options?.(lookups.data).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <input
                        id={`d-${f.name}`}
                        className="form-field-box"
                        type={f.type === 'date' ? 'date' : 'text'}
                        inputMode={f.type === 'number' ? 'decimal' : undefined}
                        placeholder={f.placeholder ?? f.label}
                        {...register(f.name)}
                        aria-invalid={!!err(f.name)}
                      />
                    )}
                    <FieldError message={err(f.name)} />
                  </div>
                ))}
              </div>
            </div>

            <div className="cx-card" style={{ marginTop: 16 }}>
              <div className="cx-card-head">
                <div className="cx-title">
                  <div>
                    <h3>Line items</h3>
                    <p>{cfg.tax ? 'VAT 10% is added per line' : 'No VAT on this document'}</p>
                  </div>
                </div>
              </div>
              <FieldError message={(errors.lines as { message?: string } | undefined)?.message} />
              <div className="cdc-lines-wrap">
                <table className="cdc-lines-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Description</th>
                      <th>Qty</th>
                      <th>Unit</th>
                      <th>Unit price</th>
                      {cfg.tax ? (
                        <>
                          <th>Sub total</th>
                          <th>VAT</th>
                          <th>Amount</th>
                        </>
                      ) : (
                        <>
                          <th>Mark</th>
                          <th>Total</th>
                        </>
                      )}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.fields.map((f, i) => {
                      const l = watched?.[i];
                      const tl = cfg.tax
                        ? computeTaxLine({ qty: l?.qty, unitPrice: l?.unitPrice })
                        : null;
                      return (
                        <tr key={f.id}>
                          <td style={{ width: 28, textAlign: 'center', fontWeight: 700 }}>
                            {i + 1}
                          </td>
                          <td style={{ minWidth: 300 }}>
                            <input
                              className="form-field-box"
                              {...register(`lines.${i}.description`)}
                              aria-invalid={!!lineErr(i, 'description')}
                            />
                            <FieldError message={lineErr(i, 'description')} />
                          </td>
                          <td style={{ width: 80 }}>
                            <input
                              className="form-field-box"
                              inputMode="decimal"
                              {...register(`lines.${i}.qty`)}
                              aria-invalid={!!lineErr(i, 'qty')}
                            />
                          </td>
                          <td style={{ width: 80 }}>
                            <input className="form-field-box" {...register(`lines.${i}.unit`)} />
                          </td>
                          <td style={{ width: 110 }}>
                            <input
                              className="form-field-box"
                              inputMode="decimal"
                              {...register(`lines.${i}.unitPrice`)}
                              aria-invalid={!!lineErr(i, 'unitPrice')}
                            />
                            <FieldError message={lineErr(i, 'unitPrice')} />
                          </td>
                          {tl ? (
                            <>
                              <td style={{ textAlign: 'right' }}>{fmtMoney(tl.subtotal)}</td>
                              <td style={{ textAlign: 'right' }}>{fmtMoney(tl.vat)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 800 }}>
                                {fmtMoney(tl.amount)}
                              </td>
                            </>
                          ) : (
                            <>
                              <td style={{ width: 120 }}>
                                <input
                                  className="form-field-box"
                                  {...register(`lines.${i}.mark`)}
                                />
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 800 }}>
                                {fmtMoney(lineAmount(l?.qty, l?.unitPrice))}
                              </td>
                            </>
                          )}
                          <td>
                            {editable && lines.fields.length > 1 && (
                              <button
                                type="button"
                                className="cdc-remove-line-btn"
                                onClick={() => lines.remove(i)}
                                title="Remove line"
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {editable && (
                <button
                  type="button"
                  className="cdc-add-line-btn"
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
                  + Add line
                </button>
              )}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 24,
                  flexWrap: 'wrap',
                  marginTop: 16,
                  fontSize: 13.5,
                  fontWeight: 800,
                }}
              >
                {cfg.tax && <span>Sub total {fmtMoney(totals.subtotal)}</span>}
                {cfg.tax && <span>VAT 10% {fmtMoney(totals.vat)}</span>}
                <span style={{ color: 'var(--accent-primary)' }}>
                  Grand total {fmtMoney(totals.total)}
                </span>
                {'totalKhr' in totals && totals.totalKhr !== undefined && (
                  <span>{Number(totals.totalKhr).toLocaleString('en-US')} KHR</span>
                )}
              </div>
            </div>
          </fieldset>
        </form>
        {!editable && doc && (
          <p className={ui.dialogSub} style={{ marginTop: 12 }}>
            {doc.status === 'DRAFT'
              ? 'Read only for your role.'
              : `This document is ${doc.status.toLowerCase()} and can't be edited.`}
          </p>
        )}
      </div>
    </section>
  );
}
