import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { quotationInputSchema, type QuotationDetail, type QuotationTemplate } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useApiMutation, useQuotation, useQuotationTemplates } from '../../features/admin';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, ui } from '../../components/ui';
import { Pill } from '../../components/StatusPill';
import { useToast } from '../../components/Toast';
import { ApiError, api } from '../../lib/api';
import { QUOTE_STATUS } from '../QuotationsPage';

type Row = Record<string, string>;
const rowsFrom = (t: QuotationTemplate): Row[] =>
  t.defaultRows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c.key, r[i] ?? ''])));

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

function Editor({
  quote,
  templates,
}: {
  quote?: QuotationDetail | undefined;
  templates: QuotationTemplate[];
}) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const lookups = useLookups();
  const first = templates[0];
  const [templateKey, setTemplateKey] = useState(quote?.templateKey ?? first?.key ?? '');
  const template = templates.find((t) => t.key === templateKey);
  const [head, setHead] = useState({
    clientId: quote?.clientId ?? '',
    toName: quote?.toName ?? '',
    attn: quote?.attn ?? '',
    quoteDate:
      quote?.quoteDate ??
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date()),
    paymentTermDays: quote?.paymentTermDays?.toString() ?? '7',
    latePenaltyPctPerDay: quote?.latePenaltyPctPerDay
      ? String(Number(quote.latePenaltyPctPerDay))
      : '',
    notes: quote?.notes ?? first?.notes ?? '',
  });
  const [rows, setRows] = useState<Row[]>(() => quote?.lines ?? (first ? rowsFrom(first) : []));
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const editable = can('quotations:write') && (!quote || quote.status === 'DRAFT');
  const latest = !quote || quote.versions[0]?.id === quote.id;

  const body = () => ({
    templateKey,
    ...head,
    clientId: head.clientId || null,
    paymentTermDays: head.paymentTermDays || null,
    lines: rows,
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

  const onSave = async () => {
    const check = quotationInputSchema.safeParse(body());
    setFieldErrors(check.success ? [] : check.error.issues.map((i) => i.message));
    if (!check.success) return;
    const saved = await save.mutateAsync(undefined);
    toast(quote ? 'Quotation saved.' : `Quotation ${saved.quoteNo} created.`);
    if (!quote) navigate(`/quotations/${saved.id}`, { replace: true });
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
    setHead((h) => ({ ...h, notes: t.notes ?? '' }));
  };
  const pickClient = (id: string) => {
    const c = lookups.data?.clients.find((x) => x.id === id);
    setHead((h) => ({ ...h, clientId: id, toName: c && !h.toName ? c.name : h.toName }));
  };
  const cols = useMemo(() => template?.columns ?? [], [template]);
  const err = save.error ?? status.error ?? revise.error ?? del.error;

  return (
    <section className="view active">
      <div className="shipment-create-container">
        <div className="create-top-bar">
          <div>
            <Link to="/quotations" className="create-header-desc">
              ← Quotations
            </Link>
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
              <div className="create-header-desc">
                Versions:{' '}
                {quote.versions.map((v) => (
                  <Link
                    key={v.id}
                    to={`/quotations/${v.id}`}
                    style={{
                      marginRight: 8,
                      fontWeight: v.id === quote.id ? 900 : 600,
                      color: 'var(--accent-primary)',
                    }}
                  >
                    v{v.version}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {quote && (
              <a
                className="filter-btn"
                href={`/print/quotation/${quote.id}`}
                target="_blank"
                rel="noreferrer"
              >
                Print / PDF
              </a>
            )}
            {can('quotations:write') && quote?.status === 'DRAFT' && (
              <button
                type="button"
                className="btn-delete-shipment"
                onClick={() =>
                  window.confirm('Delete this draft?') &&
                  void del.mutateAsync(undefined).then(() => navigate('/quotations'))
                }
              >
                Delete draft
              </button>
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
                      navigate(`/quotations/${v.id}`);
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
        <fieldset disabled={!editable} style={{ border: 'none', minWidth: 0 }}>
          <div className="cx-card">
            <div className="form-fields-grid">
              <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
                <label htmlFor="qt-template">Service</label>
                <select
                  id="qt-template"
                  className="form-select-box"
                  value={templateKey}
                  onChange={(e) => changeTemplate(e.target.value)}
                  disabled={!!quote}
                >
                  {templates.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
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
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {(
                [
                  ['toName', 'To', 2],
                  ['attn', 'Attn', 1],
                  ['quoteDate', 'Date', 1],
                  ['paymentTermDays', 'Payment term (days)', 1],
                  ['latePenaltyPctPerDay', 'Late penalty % / day', 1],
                ] as const
              ).map(([k, l, span]) => (
                <div className="form-field-group" key={k} style={{ gridColumn: `span ${span}` }}>
                  <label htmlFor={`qt-${k}`}>{l}</label>
                  <input
                    id={`qt-${k}`}
                    type={k === 'quoteDate' ? 'date' : 'text'}
                    className="form-field-box"
                    value={head[k]}
                    onChange={(e) => setHead({ ...head, [k]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="cx-card" style={{ marginTop: 16 }}>
            <div className="cx-card-head">
              <div className="cx-title">
                <div>
                  <h3>{template?.docTitle ?? 'Rates'}</h3>
                  <p>Type numbers or text such as “As per receipt”.</p>
                </div>
              </div>
            </div>
            <div className="cdc-lines-wrap">
              <table className="cdc-lines-table">
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {cols.map((c) => (
                        <td
                          key={c.key}
                          style={{
                            minWidth: c.type === 'wide' ? 280 : c.type === 'remark' ? 260 : 90,
                          }}
                        >
                          {c.type === 'remark' || c.type === 'wide' ? (
                            <textarea
                              className="form-field-box"
                              rows={c.type === 'remark' ? 2 : 1}
                              value={r[c.key] ?? ''}
                              onChange={(e) =>
                                setRows(
                                  rows.map((x, j) =>
                                    j === i ? { ...x, [c.key]: e.target.value } : x,
                                  ),
                                )
                              }
                              aria-label={`${c.label} row ${i + 1}`}
                            />
                          ) : (
                            <input
                              className="form-field-box"
                              value={r[c.key] ?? ''}
                              onChange={(e) =>
                                setRows(
                                  rows.map((x, j) =>
                                    j === i ? { ...x, [c.key]: e.target.value } : x,
                                  ),
                                )
                              }
                              aria-label={`${c.label} row ${i + 1}`}
                            />
                          )}
                        </td>
                      ))}
                      <td>
                        {editable && (
                          <button
                            type="button"
                            className="cdc-remove-line-btn"
                            onClick={() => setRows(rows.filter((_, j) => j !== i))}
                            title="Remove row"
                          >
                            ×
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
                className="cdc-add-line-btn"
                onClick={() =>
                  setRows([
                    ...rows,
                    Object.fromEntries(cols.map((c) => [c.key, c.key === 'ccy' ? 'USD' : ''])),
                  ])
                }
              >
                + Add row
              </button>
            )}
          </div>
          <div className="cx-card" style={{ marginTop: 16 }}>
            <div className="form-field-group">
              <label htmlFor="qt-notes">Notes &amp; conditions</label>
              <textarea
                id="qt-notes"
                className="form-field-box"
                rows={8}
                value={head.notes}
                onChange={(e) => setHead({ ...head, notes: e.target.value })}
              />
            </div>
          </div>
        </fieldset>
      </div>
    </section>
  );
}
