import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BackLink, backRow } from '../../components/BackLink';
import {
  parseChargeLines,
  quotationInputSchema,
  type QuotationDetail,
  type QuotationTemplate,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useApiMutation, useQuotation, useQuotationTemplates } from '../../features/admin';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, ui } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { Pill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { ApiError, api } from '../../lib/api';
import { QUOTE_STATUS, serviceName } from '../QuotationsPage';
import { PrintLink } from '../../components/PrintLink';
import { icons } from '../../layout/icons';
import s from '../creditnoted/CreditNotedEditor.module.css';
import q from './QuotationEditor.module.css';

type Row = Record<string, string>;
/** An extra charge as edited: amount as typed (blank = no fixed price). */
type Extra = { description: string; amount: string; unit: string; remark: string; cost: string };
const blankExtra = (): Extra => ({ description: '', amount: '', unit: '', remark: '', cost: '' });
/** A service's standard notes as its starting extra charges. */
const extrasFrom = (t: QuotationTemplate | undefined): Extra[] =>
  parseChargeLines(t?.notes).map((c) => ({
    description: c.description,
    amount: c.amount ?? '',
    unit: c.unit ?? '',
    remark: c.remark ?? '',
    cost: '',
  }));
/** "1,234.5" → 1234.5; null when not a plain number ("As per receipt"). */
const num = (v: string | undefined) => {
  const x = String(v ?? '')
    .replace(/,/g, '')
    .trim();
  return /^\d+(\.\d+)?$/.test(x) ? Number(x) : null;
};
/** Sell − cost, as "+45.00" (green) or "−5.00" (red); nothing unless both are numbers. */
function Margin({ sell, cost }: { sell: string | undefined; cost: string | undefined }) {
  const a = num(sell);
  const b = num(cost);
  if (a === null || b === null) return null;
  const m = a - b;
  return (
    <span className={m < 0 ? q.marginLow : q.margin} title="Margin: client price − cost">
      {m >= 0 ? '+' : '−'}
      {Math.abs(m).toFixed(2)}
    </span>
  );
}
/** Per what: the usual ones (still free text). */
const PER = [
  'Set',
  'Shipment',
  'CTNR',
  'Declaration',
  'Truck',
  'Truck/night',
  'Time',
  'Ton',
  'KG',
  'CBM',
  'Day',
];
const rowsFrom = (t: QuotationTemplate): Row[] =>
  t.defaultRows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c.key, r[i] ?? ''])));

/** Rates-table column widths by type; the remark column takes what is left. */
const COL_WIDTH: Record<QuotationTemplate['columns'][number]['type'], string | number | undefined> =
  { wide: '26%', text: 96, num: 120, remark: undefined };

export function QuotationEditorPage() {
  const { id = 'new' } = useParams();
  const quote = useQuotation(id === 'new' ? undefined : id);
  const templates = useQuotationTemplates();
  if (quote.isLoading || templates.isLoading)
    return (
      <section className="view active">
        <div className="card">Loading…</div>
      </section>
    );
  if (quote.error || templates.error)
    return (
      <section className="view active">
        <ErrorBanner error={quote.error ?? templates.error} />
      </section>
    );
  return (
    <Editor key={quote.data?.id ?? 'new'} quote={quote.data} templates={templates.data ?? []} />
  );
}

/**
 * A quotation to a client: its rates and extra charges (what the client sees), and for the
 * Sales Manager (quotations:cost) what each one costs us, with the margin. On its own page, or
 * embedded in the client's quotations page (`embedded`), one port at a time.
 */
export function Editor({
  quote,
  templates,
  embedded = false,
  presetClientId,
  presetTemplate,
  onSaved,
  onDeleted,
}: {
  quote?: QuotationDetail | undefined;
  templates: QuotationTemplate[];
  /** Inside the client's page: no back link or title (the page has them). */
  embedded?: boolean;
  presetClientId?: string;
  presetTemplate?: string;
  /** Created, revised or saved: the quotation now shown (embedded pages follow it). */
  onSaved?: (q: QuotationDetail) => void;
  onDeleted?: () => void;
}) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const lookups = useLookups();
  const [params] = useSearchParams();
  const canCost = can('quotations:cost');
  const presetClient = presetClientId ?? params.get('clientId');
  // "Not quoted yet → + Import · PNH Port" on a client's page opens on that service.
  const first =
    templates.find((t) => t.key === (presetTemplate ?? params.get('template'))) ?? templates[0];
  const [templateKey, setTemplateKey] = useState(quote?.templateKey ?? first?.key ?? '');
  const template = templates.find((t) => t.key === templateKey);
  const [head, setHead] = useState({
    // "+ Add port" on a client's card opens a new quotation for that client.
    clientId: quote?.clientId ?? presetClient ?? '',
    toName: quote?.toName ?? lookups.data?.clients.find((c) => c.id === presetClient)?.name ?? '',
    attn: quote?.attn ?? '',
    quoteDate:
      quote?.quoteDate ??
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date()),
    paymentTermDays: quote?.paymentTermDays?.toString() ?? '7',
    latePenaltyPctPerDay: quote?.latePenaltyPctPerDay
      ? String(Number(quote.latePenaltyPctPerDay))
      : '',
    // Free-text conditions only; the priced items are the extra charges.
    notes: quote?.notes ?? '',
  });
  const [extras, setExtras] = useState<Extra[]>(() =>
    quote
      ? quote.charges.map((c) => ({
          description: c.description,
          amount: c.amount === null ? '' : String(Number(c.amount)),
          unit: c.unit ?? '',
          remark: c.remark ?? '',
          cost: c.cost == null ? '' : String(Number(c.cost)),
        }))
      : extrasFrom(first),
  );
  const setExtra = (i: number, k: keyof Extra, v: string) =>
    setExtras(extras.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const [rows, setRows] = useState<Row[]>(() => quote?.lines ?? (first ? rowsFrom(first) : []));
  // Our cost per rate cell, row for row with `rows` (Sales Manager only).
  const [costs, setCosts] = useState<Row[]>(() => quote?.costs ?? rows.map(() => ({})));
  const setCost = (i: number, key: string, value: string) =>
    setCosts(rows.map((_, j) => (j === i ? { ...costs[j], [key]: value } : (costs[j] ?? {}))));
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const editable = can('quotations:write') && (!quote || quote.status === 'DRAFT');
  const latest = !quote || quote.versions[0]?.id === quote.id;

  const body = () => ({
    templateKey,
    ...head,
    clientId: head.clientId || null,
    paymentTermDays: head.paymentTermDays || null,
    lines: rows,
    ...(canCost ? { costs: rows.map((_, i) => costs[i] ?? {}) } : {}),
    charges: extras
      .filter((x) => x.description.trim())
      .map((x) => ({
        description: x.description,
        amount: x.amount || null,
        unit: x.unit || null,
        remark: x.remark || null,
        ...(canCost ? { cost: x.cost || null } : {}),
      })),
  });
  const save = useApiMutation(
    () =>
      quote
        ? api<QuotationDetail>(`/quotations/${quote.id}`, { method: 'PUT', json: body() })
        : api<QuotationDetail>('/quotations', { method: 'POST', json: body() }),
    [['quotations']],
  );
  const status = useApiMutation(
    (s: string) =>
      api<QuotationDetail>(`/quotations/${quote!.id}/status`, {
        method: 'POST',
        json: { status: s },
      }),
    [['quotations']],
  );
  const revise = useApiMutation(
    () => api<QuotationDetail>(`/quotations/${quote!.id}/revise`, { method: 'POST' }),
    [['quotations']],
  );
  const del = useApiMutation(
    () => api(`/quotations/${quote!.id}`, { method: 'DELETE' }),
    [['quotations']],
  );
  // Costs on a sent or accepted quotation: saved on their own (no new version for the client).
  const saveCosts = useApiMutation(
    () =>
      api<QuotationDetail>(`/quotations/${quote!.id}/costs`, {
        method: 'PUT',
        json: {
          costs: rows.map((_, i) => costs[i] ?? {}),
          chargeCosts: extras.filter((x) => x.description.trim()).map((x) => x.cost || null),
        },
      }),
    [['quotations']],
  );
  const costOnly = canCost && !!quote && quote.status !== 'DRAFT' && quote.status !== 'SUPERSEDED';

  const onSave = async () => {
    const check = quotationInputSchema.safeParse(body());
    setFieldErrors(check.success ? [] : check.error.issues.map((i) => i.message));
    if (!check.success) return;
    const saved = await save.mutateAsync(undefined);
    toast(quote ? 'Quotation saved.' : `Quotation ${saved.quoteNo} created.`);
    if (onSaved) onSaved(saved);
    else if (!quote) navigate(`/quotations/${saved.id}`, { replace: true });
  };
  const changeTemplate = (key: string) => {
    const t = templates.find((x) => x.key === key);
    if (!t) return;
    if (
      rows.some((r) => Object.values(r).some(Boolean)) &&
      !window.confirm(
        'Switch service? The rows will be replaced with that service’s standard rates.',
      )
    )
      return;
    setTemplateKey(key);
    setRows(rowsFrom(t));
    setCosts(rowsFrom(t).map(() => ({})));
    setExtras(extrasFrom(t));
  };
  const pickClient = (id: string) => {
    const c = lookups.data?.clients.find((x) => x.id === id);
    setHead((h) => ({ ...h, clientId: id, toName: c && !h.toName ? c.name : h.toName }));
  };
  const cols = useMemo(() => template?.columns ?? [], [template]);
  /** Back to the client's quotations page, or the list for a prospect. */
  const backTo = head.clientId ? `/quotations/client/${head.clientId}` : '/quotations';
  const err = save.error ?? status.error ?? revise.error ?? del.error ?? saveCosts.error;
  const setCell = (i: number, key: string, value: string) =>
    setRows(rows.map((x, j) => (j === i ? { ...x, [key]: value } : x)));

  const Wrap = embedded ? 'div' : 'section';
  return (
    <Wrap className={embedded ? undefined : 'view active'}>
      <div className="shipment-create-container">
        <div className="create-top-bar">
          <div className={backRow}>
            {!embedded && (
              <BackLink to={backTo} label={head.clientId ? 'Client quotations' : 'Quotations'} />
            )}
            <div>
              <div className="create-header-title">
                {quote
                  ? `${quote.quoteNo}${quote.version > 1 ? ` v${quote.version}` : ''}`
                  : 'New quotation'}{' '}
                {quote && (
                  <Pill tone={QUOTE_STATUS[quote.status].tone}>
                    {QUOTE_STATUS[quote.status].label}
                  </Pill>
                )}
              </div>
              {quote && quote.versions.length > 1 && (
                <div className={q.versions}>
                  Versions
                  {quote.versions.map((v) => (
                    <Link
                      key={v.id}
                      to={`/quotations/${v.id}`}
                      className={q.version}
                      aria-current={v.id === quote.id ? 'page' : undefined}
                    >
                      v{v.version}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className={q.headActions}>
            {can('quotations:write') && quote && (
              <button
                type="button"
                className={s.headDelete}
                disabled={del.isPending}
                onClick={() =>
                  window.confirm(
                    `Delete ${quote.quoteNo}${quote.version > 1 ? ` v${quote.version}` : ''}? Bills already made keep their prices.`,
                  ) &&
                  void del
                    .mutateAsync(undefined)
                    .then(() => (onDeleted ? onDeleted() : navigate(backTo)))
                }
                aria-label="Delete quotation"
                title="Delete quotation"
              >
                {icons.trash({})}
              </button>
            )}
            {quote && (
              <PrintLink className="filter-btn" href={`/print/quotation/${quote.id}`}>
                Print / PDF
              </PrintLink>
            )}
            {can('quotations:write') &&
              quote &&
              latest &&
              quote.status !== 'DRAFT' &&
              quote.status !== 'SUPERSEDED' && (
                <button
                  type="button"
                  className="btn-cancel-shipment"
                  onClick={() =>
                    void revise.mutateAsync(undefined).then((v) => {
                      toast(`Version ${v.version} created.`);
                      if (onSaved) onSaved(v);
                      else navigate(`/quotations/${v.id}`);
                    })
                  }
                >
                  Revise (new version)
                </button>
              )}
            {can('quotations:write') && quote?.status === 'SENT' && (
              <button
                type="button"
                className="btn-cancel-shipment"
                onClick={() =>
                  void status.mutateAsync('ACCEPTED').then(() => toast('Marked accepted.'))
                }
              >
                Mark accepted
              </button>
            )}
            {costOnly && (
              <button
                type="button"
                className="btn-cancel-shipment"
                disabled={saveCosts.isPending}
                title="Costs are internal: saved without a new version for the client"
                onClick={() =>
                  void saveCosts.mutateAsync(undefined).then(() => toast('Costs saved.'))
                }
              >
                Save costs
              </button>
            )}
            {editable && (
              <button
                type="button"
                className="btn-cancel-shipment"
                onClick={() => void onSave()}
                disabled={save.isPending}
              >
                {quote ? 'Save draft' : 'Create draft'}
              </button>
            )}
            {can('quotations:write') && quote?.status === 'DRAFT' && (
              <button
                type="button"
                className="btn-create-submit"
                onClick={() => void status.mutateAsync('SENT').then(() => toast('Marked sent.'))}
              >
                Mark sent
              </button>
            )}
          </div>
        </div>
        <ErrorBanner error={err instanceof ApiError ? err : null} />
        {fieldErrors.length > 0 && <div className={ui.alert}>{fieldErrors.join(' · ')}</div>}
        {/* A sent / accepted quotation is read-only, except its costs for the Sales Manager. */}
        <fieldset disabled={!editable && !costOnly} className={q.fieldset}>
          <div className={q.card}>
            <div className={`${q.section} ${embedded ? q.sectionCompact : ''}`}>
              {/* On a client's page the port and client are already chosen: one short row. */}
              {!embedded && (
                <div className={q.sectionHead}>
                  <div>
                    <h4>Quotation details</h4>
                    <p>The service, who it is for, and its payment terms.</p>
                  </div>
                </div>
              )}
              <fieldset
                disabled={!editable}
                className={`${q.fieldset} ${q.fields} ${embedded ? q.fieldsCompact : ''}`}
              >
                <div className={`${q.field} ${q.span2}`} hidden={embedded}>
                  <label htmlFor="qt-template">Service</label>
                  <select
                    id="qt-template"
                    className="form-select-box"
                    value={templateKey}
                    onChange={(e) => changeTemplate(e.target.value)}
                    disabled={!!quote}
                    title={template?.label}
                  >
                    {templates.map((t) => (
                      <option key={t.key} value={t.key}>
                        {serviceName(t.label)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={`${q.field} ${q.span2}`} hidden={embedded}>
                  <label htmlFor="qt-client">Client (optional)</label>
                  <select
                    id="qt-client"
                    className="form-select-box"
                    value={head.clientId}
                    onChange={(e) => pickClient(e.target.value)}
                  >
                    <option value="">— prospect —</option>
                    {lookups.data?.clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={`${q.field} ${q.span2}`}>
                  <label htmlFor="qt-toName">To</label>
                  <input
                    id="qt-toName"
                    className="form-field-box"
                    value={head.toName}
                    onChange={(e) => setHead({ ...head, toName: e.target.value })}
                  />
                </div>
                <div className={`${q.field} ${q.span2}`}>
                  <label htmlFor="qt-attn">Attn</label>
                  <input
                    id="qt-attn"
                    className="form-field-box"
                    value={head.attn}
                    onChange={(e) => setHead({ ...head, attn: e.target.value })}
                  />
                </div>
                <div className={q.field}>
                  <label htmlFor="qt-quoteDate">Date</label>
                  <input
                    id="qt-quoteDate"
                    type="date"
                    className="form-field-box"
                    value={head.quoteDate}
                    onChange={(e) => setHead({ ...head, quoteDate: e.target.value })}
                  />
                </div>
                <div className={q.field}>
                  <label htmlFor="qt-paymentTermDays">Payment term</label>
                  <div className={q.suffix}>
                    <NumberInput
                      id="qt-paymentTermDays"
                      decimals={0}
                      className="form-field-box"
                      value={head.paymentTermDays}
                      onChange={(e) => setHead({ ...head, paymentTermDays: e.target.value })}
                    />
                    <span>days</span>
                  </div>
                </div>
                <div className={q.field}>
                  <label htmlFor="qt-latePenaltyPctPerDay">Late penalty</label>
                  <div className={q.suffix}>
                    <NumberInput
                      id="qt-latePenaltyPctPerDay"
                      decimals={3}
                      className="form-field-box"
                      value={head.latePenaltyPctPerDay}
                      onChange={(e) => setHead({ ...head, latePenaltyPctPerDay: e.target.value })}
                    />
                    <span>% / day</span>
                  </div>
                </div>
              </fieldset>
            </div>

            <div className={q.section}>
              <div className={q.sectionHead}>
                <div>
                  <h4>{template?.docTitle ?? 'Rates'}</h4>
                  <p>
                    Type numbers or text such as “As per receipt”.
                    {canCost && ' Under each price: our cost, and the margin.'}
                  </p>
                </div>
                <span className={q.count}>
                  {rows.length} {rows.length === 1 ? 'row' : 'rows'}
                </span>
              </div>
              <div className={q.tableWrap}>
                <table className={q.table}>
                  <colgroup>
                    <col className={q.no} />
                    {cols.map((c) => (
                      <col key={c.key} style={{ width: COL_WIDTH[c.type] }} />
                    ))}
                    <col className={q.actions} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={q.no}>#</th>
                      {cols.map((c) => (
                        <th key={c.key} className={c.type === 'num' ? q.num : undefined}>
                          {c.label}
                        </th>
                      ))}
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className={q.no}>{i + 1}</td>
                        {cols.map((c) => (
                          <td key={c.key} className={c.type === 'num' ? q.num : undefined}>
                            {c.type === 'remark' || c.type === 'wide' ? (
                              <textarea
                                className="form-field-box"
                                rows={1}
                                value={r[c.key] ?? ''}
                                disabled={!editable}
                                onChange={(e) => setCell(i, c.key, e.target.value)}
                                aria-label={`${c.label} row ${i + 1}`}
                              />
                            ) : (
                              <input
                                className="form-field-box"
                                value={r[c.key] ?? ''}
                                disabled={!editable}
                                onChange={(e) => setCell(i, c.key, e.target.value)}
                                aria-label={`${c.label} row ${i + 1}`}
                                title={r[c.key] || undefined}
                              />
                            )}
                            {canCost && c.type === 'num' && (
                              <div className={q.costLine}>
                                <input
                                  className={`form-field-box ${q.costInput}`}
                                  value={costs[i]?.[c.key] ?? ''}
                                  placeholder="cost"
                                  onChange={(e) => setCost(i, c.key, e.target.value)}
                                  aria-label={`${c.label} row ${i + 1} cost`}
                                />
                                <Margin sell={r[c.key]} cost={costs[i]?.[c.key]} />
                              </div>
                            )}
                          </td>
                        ))}
                        <td>
                          {editable && (
                            <button
                              type="button"
                              className={q.remove}
                              onClick={() => {
                                setRows(rows.filter((_, j) => j !== i));
                                setCosts(costs.filter((_, j) => j !== i));
                              }}
                              aria-label={`Remove row ${i + 1}`}
                              title="Remove row"
                            >
                              {icons.trash({})}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {editable && (
                <button
                  type="button"
                  className={q.addRow}
                  onClick={() => (
                    setRows([
                      ...rows,
                      Object.fromEntries(cols.map((c) => [c.key, c.key === 'ccy' ? 'USD' : ''])),
                    ]),
                    setCosts([...rows.map((_, j) => costs[j] ?? {}), {}])
                  )}
                >
                  + Add row
                </button>
              )}
            </div>

            <div className={q.section}>
              <div className={q.sectionHead}>
                <div>
                  <h4>Extra charges</h4>
                  <p>
                    Charged only when they apply (Red signal, Document fee…). Bills and record
                    summaries pick them by name with their price.
                  </p>
                </div>
                <span className={q.count}>
                  {extras.length} {extras.length === 1 ? 'charge' : 'charges'}
                </span>
              </div>
              <div className={q.tableWrap}>
                <table className={q.table}>
                  <colgroup>
                    <col className={q.no} />
                    <col style={{ width: '32%' }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 140 }} />
                    {canCost && <col style={{ width: 150 }} />}
                    <col />
                    <col className={q.actions} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={q.no}>#</th>
                      <th>Charge</th>
                      <th className={q.num}>Amount (USD)</th>
                      <th>Per</th>
                      {canCost && <th className={q.num}>Our cost · margin</th>}
                      <th>Condition / remark</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {extras.map((x, i) => (
                      <tr key={i}>
                        <td className={q.no}>{i + 1}</td>
                        <td>
                          <input
                            className="form-field-box"
                            value={x.description}
                            placeholder="e.g. Red signal"
                            disabled={!editable}
                            onChange={(e) => setExtra(i, 'description', e.target.value)}
                            aria-label={`Extra charge ${i + 1}`}
                          />
                        </td>
                        <td className={q.num}>
                          <NumberInput
                            decimals={2}
                            className="form-field-box"
                            value={x.amount}
                            placeholder="—"
                            disabled={!editable}
                            onChange={(e) => setExtra(i, 'amount', e.target.value)}
                            aria-label={`Extra charge ${i + 1} amount`}
                          />
                        </td>
                        <td>
                          <input
                            className="form-field-box"
                            list="qt-per"
                            value={x.unit}
                            placeholder="Set"
                            disabled={!editable}
                            onChange={(e) => setExtra(i, 'unit', e.target.value)}
                            aria-label={`Extra charge ${i + 1} per`}
                          />
                        </td>
                        {canCost && (
                          <td className={q.num}>
                            <div className={q.costLine}>
                              <NumberInput
                                decimals={2}
                                className={`form-field-box ${q.costInput}`}
                                value={x.cost}
                                placeholder="cost"
                                onChange={(e) => setExtra(i, 'cost', e.target.value)}
                                aria-label={`Extra charge ${i + 1} cost`}
                              />
                              <Margin sell={x.amount} cost={x.cost} />
                            </div>
                          </td>
                        )}
                        <td>
                          <textarea
                            className="form-field-box"
                            rows={1}
                            value={x.remark}
                            placeholder="(if any), as per receipt…"
                            disabled={!editable}
                            onChange={(e) => setExtra(i, 'remark', e.target.value)}
                            aria-label={`Extra charge ${i + 1} remark`}
                          />
                        </td>
                        <td>
                          {editable && (
                            <button
                              type="button"
                              className={q.remove}
                              onClick={() => setExtras(extras.filter((_, j) => j !== i))}
                              aria-label={`Remove extra charge ${i + 1}`}
                              title="Remove charge"
                            >
                              {icons.trash({})}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <datalist id="qt-per">
                  {PER.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
              {editable && (
                <button
                  type="button"
                  className={q.addRow}
                  onClick={() => setExtras([...extras, blankExtra()])}
                >
                  + Add charge
                </button>
              )}
              {(head.notes || editable) && (
                <details className={q.otherNotes} open={!!head.notes}>
                  <summary>Other conditions (not charged)</summary>
                  <textarea
                    id="qt-notes"
                    className={`form-field-box ${q.notes}`}
                    rows={3}
                    value={head.notes}
                    placeholder="e.g. Max weight 21T / 40'"
                    disabled={!editable}
                    onChange={(e) => setHead({ ...head, notes: e.target.value })}
                    aria-label="Other conditions"
                  />
                </details>
              )}
            </div>
          </div>
        </fieldset>
      </div>
    </Wrap>
  );
}
