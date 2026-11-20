import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { QuotationRow, QuotationStatus } from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { useApiMutation, useQuotations, useQuotationTemplates } from '../features/admin';
import { useLookups } from '../features/hooks';
import { ErrorBanner, Modal, ui } from '../components/ui';
import { SearchBox } from '../components/SearchBox';
import { Pill } from '../components/StatusPill';
import { fmtDate } from '../lib/format';
import { api } from '../lib/api';
import { FilePicker } from '../components/FilePicker';
import { useToast } from '../components/Toast';
import g from './quotations/QuotationsByClient.module.css';

export const QUOTE_STATUS: Record<
  QuotationStatus,
  { tone: 'pending' | 'progress' | 'completed' | 'exception'; label: string }
> = {
  DRAFT: { tone: 'pending', label: 'Draft' },
  SENT: { tone: 'progress', label: 'Sent' },
  ACCEPTED: { tone: 'completed', label: 'Accepted' },
  SUPERSEDED: { tone: 'exception', label: 'Superseded' },
};

interface QuoteImportPreview {
  quoteDate: string;
  toName: string;
  duplicates: string[];
  quotations: { templateKey: string; sourceSheet: string; lineCount: number }[];
}

interface QuoteImportResult {
  created: number;
  quotations: { quoteNo: string; sourceSheet: string }[];
}

export function QuotationsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const templates = useQuotationTemplates();
  const lookups = useLookups();
  const [importOpen, setImportOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const q = {
    // Grouped by client below, so every quotation in one page (there are a few dozen).
    page: 1,
    pageSize: 500,
    q: params.get('q') || undefined,
    status: params.get('status') || undefined,
    templateKey: params.get('template') || undefined,
    latestOnly: params.get('all') ? undefined : 'true',
  };
  const list = useQuotations(q);
  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v) n.set(k, v);
        else n.delete(k);
        if (k !== 'page') n.delete('page');
        return n;
      },
      { replace: true },
    );
  return (
    <section className="view active">
      <div className="card">
        <div className="card-header-row">
          <h3>Quotations by client</h3>
          <div className={ui.toolbar}>
            <SearchBox
              placeholder="Client, quote no.…"
              defaultValue={q.q}
              onChange={(e) => set('q', e.target.value.trim())}
              aria-label="Search"
            />
            <select
              className={ui.input}
              value={q.templateKey ?? ''}
              onChange={(e) => set('template', e.target.value)}
              aria-label="Service category"
            >
              <option value="">All services</option>
              {templates.data?.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <select
              className={ui.input}
              value={q.status ?? ''}
              onChange={(e) => set('status', e.target.value)}
              aria-label="Status"
            >
              <option value="">All statuses</option>
              {Object.entries(QUOTE_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
            <label
              className="filter-check-item"
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                checked={!!params.get('all')}
                onChange={(e) => set('all', e.target.checked ? '1' : '')}
              />{' '}
              Show old versions
            </label>
            {can('quotations:write') && (
              <>
                <button type="button" className="filter-btn" onClick={() => setImportOpen(true)}>
                  Import Excel
                </button>
                <Link to="/quotations/new" className="new-shipment-btn">
                  + New Quotation
                </Link>
              </>
            )}
          </div>
        </div>
        {importOpen && <QuotationImportModal onClose={() => setImportOpen(false)} />}
        <QuotationsByClient
          rows={list.data?.data}
          loading={list.isLoading}
          error={list.error}
          clients={lookups.data?.clients ?? []}
          services={templates.data ?? []}
          filtered={!!(q.q || q.status || q.templateKey)}
          onOpenClient={(id) => navigate(`/quotations/client/${id}`)}
          onOpenQuote={(id) => navigate(`/quotations/${id}`)}
        />
      </div>
    </section>
  );
}

/** "I. IMPORT PNH PORT" → "Import · PNH Port": the service name without its numbering. */
export const serviceName = (label: string) =>
  label
    .replace(/^[IVX]+\.\s*/, '')
    .toLowerCase()
    .replace(/\b(pnh|shv|sih|lcl|fcl|cbm)\b/g, (w) => w.toUpperCase())
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * Quotations as client management: one row per client (its ports quoted, extra charges, where
 * its quotations stand), opening that client's page to manage each port. Clients without a
 * quotation are listed too, to start one; prospects (no client) open their quotation directly.
 */
function QuotationsByClient({
  rows,
  loading,
  error,
  clients,
  services,
  filtered,
  onOpenClient,
  onOpenQuote,
}: {
  rows: QuotationRow[] | undefined;
  loading: boolean;
  error: unknown;
  clients: { id: string; code: string; name: string; status: string }[];
  /** Every port / service, in order: one segment each in the coverage bar. */
  services: { key: string; label: string }[];
  /** A search or filter is on: list only the clients it finds. */
  filtered: boolean;
  onOpenClient: (id: string) => void;
  onOpenQuote: (id: string) => void;
}) {
  if (loading) return <div className={g.note}>Loading quotations…</div>;
  if (error) return <ErrorBanner error={error} />;
  const byClient = new Map<string, QuotationRow[]>();
  const prospects: QuotationRow[] = [];
  for (const r of rows ?? []) {
    if (!r.clientId) prospects.push(r);
    else byClient.set(r.clientId, [...(byClient.get(r.clientId) ?? []), r]);
  }
  const list = clients
    .filter((c) => (filtered ? byClient.has(c.id) : c.status !== 'INACTIVE' || byClient.has(c.id)))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <table className={`data-table-clean ${g.table}`}>
        <thead>
          <tr>
            <th>Client</th>
            <th>Ports quoted</th>
            <th className={g.numHead}>Extras</th>
            <th>Status</th>
            <th>Last quote</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr>
              <td colSpan={6} className={g.note}>
                No client matches.
              </td>
            </tr>
          )}
          {list.map((c) => {
            const qs = byClient.get(c.id) ?? [];
            const count = (s: QuotationStatus) => qs.filter((q) => q.status === s).length;
            const last = qs
              .map((q) => q.quoteDate)
              .sort()
              .at(-1);
            return (
              <tr
                key={c.id}
                className="plans-row-clickable"
                tabIndex={0}
                onClick={() => onOpenClient(c.id)}
                onKeyDown={(e) => e.key === 'Enter' && onOpenClient(c.id)}
              >
                <td>
                  <div className={g.clientCell}>
                    <span className={g.avatar}>{c.code.slice(0, 3)}</span>
                    <span>
                      <strong>{c.name}</strong>
                      <span>{c.code}</span>
                    </span>
                  </div>
                </td>
                <td>
                  {/* Coverage: one segment per port, coloured by its quotation's status. */}
                  <div className={g.coverage}>
                    <span className={g.coverageCount}>
                      <b>{qs.length}</b> of {services.length}
                    </span>
                    <span className={g.bar} aria-hidden="true">
                      {services.map((sv) => {
                        const hit = qs.find((q) => q.templateKey === sv.key);
                        return (
                          <span
                            key={sv.key}
                            className={g.seg}
                            data-tone={hit ? QUOTE_STATUS[hit.status].tone : undefined}
                            title={`${serviceName(sv.label)}: ${hit ? `${hit.quoteNo} · ${QUOTE_STATUS[hit.status].label}` : 'not quoted'}`}
                          />
                        );
                      })}
                    </span>
                  </div>
                </td>
                <td className={g.num}>{qs.reduce((n, q) => n + q.chargeCount, 0) || '—'}</td>
                <td>
                  {qs.length ? (
                    <span className={g.statusLine}>
                      {(['ACCEPTED', 'SENT', 'DRAFT'] as const)
                        .filter((s) => count(s) > 0)
                        .map((s) => (
                          <span key={s} className={g.stat} data-tone={QUOTE_STATUS[s].tone}>
                            {count(s)} {QUOTE_STATUS[s].label.toLowerCase()}
                          </span>
                        ))}
                    </span>
                  ) : (
                    <span className={g.muted}>No quotation yet</span>
                  )}
                </td>
                <td className={g.date}>{last ? fmtDate(last) : '—'}</td>
                <td className={g.chev}>›</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {prospects.length > 0 && (
        <>
          <h4 className={g.subHead}>Prospects (no client yet)</h4>
          <table className={`data-table-clean ${g.table}`}>
            <tbody>
              {prospects.map((q) => (
                <tr
                  key={q.id}
                  className="plans-row-clickable"
                  tabIndex={0}
                  onClick={() => onOpenQuote(q.id)}
                  onKeyDown={(e) => e.key === 'Enter' && onOpenQuote(q.id)}
                >
                  <td>
                    <strong>{q.toName}</strong>
                  </td>
                  <td>{serviceName(q.templateLabel)}</td>
                  <td>
                    {q.quoteNo}
                    {q.version > 1 ? ` v${q.version}` : ''}
                  </td>
                  <td>
                    <Pill tone={QUOTE_STATUS[q.status].tone}>{QUOTE_STATUS[q.status].label}</Pill>
                  </td>
                  <td>{fmtDate(q.quoteDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function QuotationImportModal({ onClose }: { onClose: () => void }) {
  const lookups = useLookups();
  const toast = useToast();
  const [clientId, setClientId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<QuoteImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const apply = useApiMutation(
    (body: FormData) => api<QuoteImportResult>('/quotations/import', { method: 'POST', body }),
    [['quotations']],
  );
  const formData = (isPreview: boolean) => {
    const body = new FormData();
    body.append('clientId', clientId);
    body.append('file', file!);
    body.append('preview', String(isPreview));
    return body;
  };
  const readPreview = async () => {
    if (!clientId || !file) return;
    setError(null);
    setPreviewing(true);
    try {
      setPreview(
        await api<QuoteImportPreview>('/quotations/import', {
          method: 'POST',
          body: formData(true),
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setPreviewing(false);
    }
  };
  const importQuotes = async () => {
    if (!preview || preview.duplicates.length) return;
    const result = await apply.mutateAsync(formData(false));
    toast(`${result.created} accepted quotations imported. Prices remain editable on bills.`);
    onClose();
  };

  return (
    <Modal
      title="Import quotation workbook"
      width={640}
      onClose={onClose}
      sub="Review the workbook before importing. Imported quotations are accepted and can prefill client bills; bill prices remain editable."
    >
      <ErrorBanner error={error ?? apply.error ?? lookups.error} />
      <div className="form-fields-grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="form-field-group">
          <label htmlFor="quotation-import-client">Client</label>
          <select
            id="quotation-import-client"
            className={ui.input}
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setPreview(null);
            }}
            disabled={lookups.isLoading}
          >
            <option value="">Select client…</option>
            {lookups.data?.clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.code} — {client.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field-group">
          <label htmlFor="quotation-import-file">Workbook (.xlsx)</label>
          <FilePicker
            id="quotation-import-file"
            accept=".xlsx"
            hint="Choose a client quotation workbook"
            file={file}
            onChange={(chosen) => {
              setFile(chosen);
              setPreview(null);
            }}
          />
        </div>
      </div>
      <p style={{ margin: '12px 0', fontSize: 12.5 }}>
        Imports the leftmost quote tables from supported service tabs. JR’s standard tabs and
        <strong> TRUCK LCL</strong> are included; its alternate <strong>N-*</strong> tabs are not.
        Re-importing the same client, service, and quote date is blocked to prevent duplicates.
      </p>
      {preview && (
        <div style={{ marginTop: 16, fontSize: 13 }}>
          <strong>
            {preview.toName} · {fmtDate(preview.quoteDate)}
          </strong>
          <ul style={{ margin: '8px 0 0 18px' }}>
            {preview.quotations.map((quote) => (
              <li key={`${quote.sourceSheet}-${quote.templateKey}`}>
                {quote.sourceSheet}: {quote.lineCount} rate rows
              </li>
            ))}
          </ul>
          {preview.duplicates.length > 0 && (
            <p role="alert" style={{ color: 'var(--status-exception-fg)', fontWeight: 600 }}>
              Existing quotes found for: {preview.duplicates.join(', ')}. Remove or revise those
              quotes before importing this date.
            </p>
          )}
        </div>
      )}
      <div className={ui.actions}>
        <button type="button" className="btn-cancel-shipment" onClick={onClose}>
          Cancel
        </button>
        {!preview ? (
          <button
            type="button"
            className="btn-create-submit"
            disabled={!clientId || !file || previewing}
            onClick={() => void readPreview()}
          >
            {previewing ? 'Reading…' : 'Preview workbook'}
          </button>
        ) : (
          <button
            type="button"
            className="btn-create-submit"
            disabled={apply.isPending || preview.duplicates.length > 0}
            onClick={() => void importQuotes()}
          >
            {apply.isPending ? 'Importing…' : `Import ${preview.quotations.length} quotes`}
          </button>
        )}
      </div>
    </Modal>
  );
}
