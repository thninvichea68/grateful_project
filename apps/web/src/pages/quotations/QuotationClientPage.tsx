import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { QuotationDetail, QuotationRow, QuotationTemplate } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useQuotation, useQuotations, useQuotationTemplates } from '../../features/admin';
import { useLookups } from '../../features/hooks';
import { BackLink, backRow } from '../../components/BackLink';
import { ErrorBanner } from '../../components/ui';
import { Pill } from '../../components/StatusPill';
import { QUOTE_STATUS, serviceName } from '../QuotationsPage';
import { Editor } from './QuotationEditorPage';
import c from './QuotationClientPage.module.css';

/**
 * One client's quotations, one port at a time: pick a port / service above, and its quotation
 * opens below to manage (rates and extra charges for the client; for the Sales Manager also
 * our costs and margins). A port not quoted yet opens a new quotation for it.
 */
export function QuotationClientPage() {
  const { clientId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const lookups = useLookups();
  const templates = useQuotationTemplates();
  const list = useQuotations({ clientId, latestOnly: 'true', page: 1, pageSize: 200 });
  const client = lookups.data?.clients.find((x) => x.id === clientId);
  const rows = list.data?.data ?? [];
  const write = can('quotations:write');
  const byTemplate = new Map<string, QuotationRow>(rows.map((r) => [r.templateKey, r]));
  const all = templates.data ?? [];
  // The port shown: ?port=…, else the first one quoted.
  const port =
    params.get('port') ?? all.find((t) => byTemplate.has(t.key))?.key ?? all[0]?.key ?? '';
  const choose = (key: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (key) n.set('port', key);
        else n.delete('port');
        return n;
      },
      { replace: true },
    );
  const current = byTemplate.get(port);
  const template = all.find((t) => t.key === port);

  return (
    <section className="view active">
      <div className={`${backRow} ${c.top}`}>
        <BackLink to="/quotations" label="Quotations" />
        <div className={c.title}>
          <h2>{client?.name ?? 'Client'}</h2>
          <p>
            {client?.code && <b>{client.code}</b>} {rows.length} of {all.length} ports quoted ·{' '}
            {rows.reduce((n, r) => n + r.chargeCount, 0)} extra charges
            {can('quotations:cost') ? ' · costs shown (Sales Manager)' : ''}
          </p>
        </div>
      </div>

      <ErrorBanner error={list.error ?? templates.error} />

      {/* One port at a time: a dropdown (quoted ports, then those not quoted yet). */}
      <div className={c.picker}>
        <label htmlFor="qc-port">Port / service</label>
        <select
          id="qc-port"
          className={`form-select-box ${c.select}`}
          value={port}
          onChange={(e) => choose(e.target.value)}
        >
          <optgroup label="Quoted">
            {all
              .filter((t) => byTemplate.has(t.key))
              .map((t: QuotationTemplate) => {
                const r = byTemplate.get(t.key)!;
                return (
                  <option key={t.key} value={t.key}>
                    {serviceName(t.label)} · {r.quoteNo}
                    {r.version > 1 ? ` v${r.version}` : ''}
                  </option>
                );
              })}
          </optgroup>
          {write && all.some((t) => !byTemplate.has(t.key)) && (
            <optgroup label="Not quoted yet (create)">
              {all
                .filter((t) => !byTemplate.has(t.key))
                .map((t: QuotationTemplate) => (
                  <option key={t.key} value={t.key}>
                    + {serviceName(t.label)}
                  </option>
                ))}
            </optgroup>
          )}
        </select>
        {current ? (
          <Pill tone={QUOTE_STATUS[current.status].tone}>{QUOTE_STATUS[current.status].label}</Pill>
        ) : (
          <span className={c.newTag}>New quotation</span>
        )}
        <span className={c.count}>
          {all.findIndex((t) => t.key === port) + 1} of {all.length}
        </span>
      </div>

      {list.isLoading || templates.isLoading ? (
        <div className={c.note}>Loading…</div>
      ) : current ? (
        <PortQuotation
          key={current.id}
          id={current.id}
          templates={all}
          onSaved={(q) => choose(q.templateKey)}
          onDeleted={() => choose('')}
        />
      ) : template && write ? (
        <div className={c.panel}>
          <p className={c.hint}>
            {client?.name ?? 'This client'} has no quotation for{' '}
            <b>{serviceName(template.label)}</b> yet. It starts from the standard rates: adjust and
            create it.
          </p>
          <Editor
            key={`new-${port}`}
            templates={all}
            embedded
            presetClientId={clientId}
            presetTemplate={port}
            onSaved={(q) => choose(q.templateKey)}
          />
        </div>
      ) : (
        <div className={c.note}>
          No quotation for this port. <Link to="/quotations">Back to quotations</Link>
        </div>
      )}
    </section>
  );
}

/** The chosen port's quotation, managed in place. */
function PortQuotation({
  id,
  templates,
  onSaved,
  onDeleted,
}: {
  id: string;
  templates: QuotationTemplate[];
  onSaved: (q: QuotationDetail) => void;
  onDeleted: () => void;
}) {
  const q = useQuotation(id);
  if (q.isLoading) return <div className={c.note}>Loading quotation…</div>;
  if (q.error || !q.data) return <ErrorBanner error={q.error} />;
  return (
    <div className={c.panel}>
      <Editor
        key={`${q.data.id}-${q.data.status}`}
        quote={q.data}
        templates={templates}
        embedded
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    </div>
  );
}
