import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import {
  LOOKUP_TYPES,
  PORT_KINDS,
  companySchema,
  type CompanyInput,
  type ExchangeRateSyncStatus,
  type LookupType,
} from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { useApiMutation, useSettings } from '../features/admin';
import { useLookups } from '../features/hooks';
import { ErrorBanner, FieldError, TableState, ui } from '../components/ui';
import { InlineName } from '../components/InlineName';
import { MefSyncStatus, RateImportModal, RateRow } from './settings/ExchangeRates';
import st from './SettingsPage.module.css';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { fmtDate, fmtNum } from '../lib/format';
import { queryKeys } from '../lib/queryKeys';
import { formResolver } from '../lib/zodForm';

const TABS = [
  ['company', 'Company'],
  ['rates', 'Exchange rates'],
  ['ports', 'Ports'],
  ['forwarders', 'Forwarders'],
  ['consignees', 'Consignees'],
  ['lists', 'Dropdown lists'],
] as const;
type Tab = (typeof TABS)[number][0];
const LIST_LABEL: Record<LookupType, string> = {
  QUANTITY_UNIT: 'Quantity units',
  MATERIAL: 'Materials',
  CO_FORM: 'CO forms',
  BROKER: 'Brokers',
  DEPARTMENT: 'Departments',
  CHARGE: 'Charge descriptions',
};
const INVALIDATE = [['settings'], queryKeys.lookups, ['meta', 'company']];

export function SettingsPage() {
  const { can } = useAuth();
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>('company');
  const manage = can('settings:manage');
  return (
    // Every tab but Company is a list: fill the window so only its rows scroll.
    <section className={`view active${tab !== 'company' ? ` ${st.fill}` : ''}`}>
      <nav
        style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}
        aria-label="Settings sections"
      >
        {TABS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            className={`filter-btn${tab === k ? ' active' : ''}`}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </nav>
      <ErrorBanner error={settings.error} />
      {!manage && (
        <p className={ui.dialogSub} style={{ marginBottom: 12 }}>
          Read only. Only Admins can change settings.
        </p>
      )}
      {settings.data && (
        <>
          {tab === 'company' && <CompanyForm initial={settings.data.company} manage={manage} />}
          {tab === 'rates' && <Rates manage={manage} />}
          {tab === 'ports' && <Ports manage={manage} />}
          {tab === 'forwarders' && <SimpleList kind="forwarders" manage={manage} />}
          {tab === 'consignees' && <SimpleList kind="consignees" manage={manage} />}
          {tab === 'lists' && <Lists manage={manage} />}
        </>
      )}
    </section>
  );
}

function Card({
  title,
  sub,
  children,
  action,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-header-row">
        <div>
          <h3>{title}</h3>
          {sub && (
            <div className="create-header-desc" style={{ marginTop: 4 }}>
              {sub}
            </div>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function CompanyForm({ initial, manage }: { initial: CompanyInput; manage: boolean }) {
  const toast = useToast();
  const save = useApiMutation(
    (v: CompanyInput) => api('/settings/company', { method: 'PUT', json: v }),
    INVALIDATE,
  );
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<CompanyInput>({ resolver: formResolver(companySchema), defaultValues: initial });
  const f = (name: keyof CompanyInput, label: string, span = 2) => (
    <div className="form-field-group" style={{ gridColumn: `span ${span}` }}>
      <label htmlFor={`co-${name}`}>{label}</label>
      <input id={`co-${name}`} className="form-field-box" {...register(name)} />
      <FieldError message={errors[name]?.message} />
    </div>
  );
  return (
    <Card
      title="Workspace & company"
      sub="Printed on tax invoices, disbursements and other documents."
    >
      <ErrorBanner error={save.error} />
      <form
        onSubmit={(e) =>
          void handleSubmit(async (v) => {
            await save.mutateAsync(v);
            toast('Company details saved.');
          })(e)
        }
        noValidate
      >
        <fieldset disabled={!manage} style={{ border: 'none' }}>
          <div className="form-fields-grid">
            {f('nameEn', 'Company name (English)')}
            {f('nameKm', 'ឈ្មោះក្រុមហ៊ុន (Khmer)')}
            {f('vattin', 'VATTIN', 1)}
            {f('phone', 'Phone', 1)}
            {f('addressEn', 'Address (English)')}
            {f('addressKm', 'អាស័យដ្ឋាន (Khmer)')}
            {f('bankName', 'Bank', 1)}
            {f('bankAccountName', 'Account name')}
            {f('bankAccountNo', 'Account no.', 1)}
          </div>
          {manage && (
            <div className={ui.actions}>
              <button
                type="submit"
                className="btn-create-submit"
                disabled={!isDirty || save.isPending}
              >
                Save company details
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </Card>
  );
}

function Rates({ manage }: { manage: boolean }) {
  const s = useSettings().data!;
  const toast = useToast();
  const [date, setDate] = useState(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date()),
  );
  const [rate, setRate] = useState('');
  const [importing, setImporting] = useState(false);
  const add = useApiMutation(
    () =>
      api('/settings/exchange-rates', {
        method: 'POST',
        json: { effectiveDate: date, usdToKhr: rate },
      }),
    INVALIDATE,
  );
  const base = useApiMutation(
    (value: string) => api('/settings/base-exchange-rate', { method: 'PUT', json: { value } }),
    INVALIDATE,
  );
  const sync = useApiMutation(
    () => api<ExchangeRateSyncStatus>('/settings/exchange-rates/sync', { method: 'POST' }),
    INVALIDATE,
  );
  return (
    <Card
      title="USD → KHR exchange rates"
      sub={`New ledger rows use the rate in force on their invoice date. Before the first rate, the base rate (${fmtNum(s.baseExchangeRate)}) is used.`}
      action={
        manage ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="filter-btn"
              disabled={sync.isPending}
              onClick={() =>
                void sync
                  .mutateAsync(undefined)
                  .then((r) =>
                    toast(
                      r.result === 'same'
                        ? `Already up to date: ${fmtNum(r.usdToKhr)} KHR for ${fmtDate(r.effectiveDate)}.`
                        : `Official rate ${r.result === 'new' ? 'added' : 'updated'}: ${fmtNum(r.usdToKhr)} KHR for ${fmtDate(r.effectiveDate)}.`,
                    ),
                  )
              }
            >
              {sync.isPending ? 'Updating…' : 'Update from MEF'}
            </button>
            <button type="button" className="filter-btn" onClick={() => setImporting(true)}>
              Import Excel
            </button>
            <button
              type="button"
              className="filter-btn"
              onClick={() => {
                const v = window.prompt('Base rate (1 USD = ? KHR)', String(s.baseExchangeRate));
                if (v) void base.mutateAsync(v).then(() => toast('Base rate saved.'));
              }}
            >
              Set base rate
            </button>
          </div>
        ) : undefined
      }
    >
      {importing && <RateImportModal onClose={() => setImporting(false)} />}
      <MefSyncStatus status={s.exchangeRateSync} auto={s.exchangeRateAutoSync} />
      <ErrorBanner error={add.error ?? base.error ?? sync.error} />
      {manage && (
        <div className={ui.toolbar} style={{ marginBottom: 14 }}>
          <input
            type="date"
            className={ui.input}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Effective from"
          />
          <input
            className={ui.input}
            inputMode="decimal"
            placeholder="e.g. 4026"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            aria-label="KHR per USD"
          />
          <button
            type="button"
            className="new-shipment-btn"
            disabled={!rate || add.isPending}
            onClick={() =>
              void add.mutateAsync(undefined).then(() => {
                setRate('');
                toast('Rate saved.');
              })
            }
          >
            Add rate
          </button>
        </div>
      )}
      <div className={st.tableScroll}>
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>Effective from</th>
              <th>1 USD =</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <TableState
              cols={3}
              loading={false}
              error={null}
              empty={!s.exchangeRates.length}
              emptyText="No dated rates yet."
            />
            {s.exchangeRates.map((r) => (
              <RateRow key={r.id} rate={r} manage={manage} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Ports({ manage }: { manage: boolean }) {
  const s = useSettings().data!;
  const toast = useToast();
  const [form, setForm] = useState({
    code: '',
    customsPortNo: '',
    name: '',
    shortName: '',
    kind: 'DRY',
  });
  const add = useApiMutation(
    () => api('/settings/ports', { method: 'POST', json: form }),
    INVALIDATE,
  );
  const patch = useApiMutation(
    ({ id, v }: { id: string; v: Record<string, unknown> }) =>
      api(`/settings/ports/${id}`, { method: 'PATCH', json: v }),
    INVALIDATE,
  );
  return (
    <Card
      title="Customs ports"
      sub="Used for clearance ports, declarations, and the Port of Discharge charts (short name)."
    >
      <ErrorBanner error={add.error ?? patch.error} />
      {manage && (
        <div className={ui.toolbar} style={{ marginBottom: 14 }}>
          <input
            className={ui.input}
            placeholder="Code (e.g. PNH19)"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            aria-label="Code"
          />
          <input
            className={ui.input}
            placeholder="Port no."
            value={form.customsPortNo}
            onChange={(e) => setForm({ ...form, customsPortNo: e.target.value })}
            aria-label="Customs port no."
            style={{ width: 90 }}
          />
          <input
            className={ui.input}
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            aria-label="Name"
          />
          <input
            className={ui.input}
            placeholder="Chart label"
            value={form.shortName}
            onChange={(e) => setForm({ ...form, shortName: e.target.value })}
            aria-label="Short name"
          />
          <select
            className={ui.input}
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
            aria-label="Kind"
          >
            {PORT_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <button
            type="button"
            className="new-shipment-btn"
            disabled={add.isPending || !form.code || !form.name || !form.shortName}
            onClick={() =>
              void add.mutateAsync(undefined).then(() => {
                setForm({ code: '', customsPortNo: '', name: '', shortName: '', kind: 'DRY' });
                toast('Port added.');
              })
            }
          >
            Add port
          </button>
        </div>
      )}
      <div className={st.tableScroll}>
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>Code</th>
              <th>No.</th>
              <th>Name</th>
              <th>Chart label</th>
              <th>Kind</th>
              <th style={{ textAlign: 'center' }}>Shipments</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {s.ports.map((p) => (
              <tr key={p.id}>
                <td className="val-bold">{p.code}</td>
                <td>{p.customsPortNo ?? '-'}</td>
                <td>
                  <InlineName
                    value={p.name}
                    label="Port name"
                    onSave={
                      manage
                        ? (name) => void patch.mutateAsync({ id: p.id, v: { name } })
                        : undefined
                    }
                  />
                </td>
                <td>{p.shortName}</td>
                <td>{p.kind}</td>
                <td style={{ textAlign: 'center' }}>{p.shipments}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={p.isActive}
                    disabled={!manage}
                    aria-label={`${p.code} active`}
                    onChange={(e) =>
                      void patch.mutateAsync({ id: p.id, v: { isActive: e.target.checked } })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SimpleList({ kind, manage }: { kind: 'forwarders' | 'consignees'; manage: boolean }) {
  const s = useSettings().data!;
  const lookups = useLookups();
  const toast = useToast();
  const [name, setName] = useState('');
  const add = useApiMutation(
    () => api(`/settings/${kind}`, { method: 'POST', json: { name } }),
    INVALIDATE,
  );
  const patch = useApiMutation(
    ({ id, v }: { id: string; v: Record<string, unknown> }) =>
      api(`/settings/${kind}/${id}`, { method: 'PATCH', json: v }),
    INVALIDATE,
  );
  const rows = kind === 'forwarders' ? s.forwarders : s.consignees;
  const label = kind === 'forwarders' ? 'Forwarder' : 'Consignee';
  return (
    <Card
      title={`${label}s`}
      sub="Inactive entries disappear from dropdowns but stay on past shipments."
    >
      <ErrorBanner error={add.error ?? patch.error} />
      {manage && (
        <div className={ui.toolbar} style={{ marginBottom: 14 }}>
          <input
            className={ui.input}
            placeholder={`New ${label.toLowerCase()} name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Name"
          />
          <button
            type="button"
            className="new-shipment-btn"
            disabled={name.trim().length < 2 || add.isPending}
            onClick={() =>
              void add.mutateAsync(undefined).then(() => {
                setName('');
                toast(`${label} added.`);
              })
            }
          >
            Add
          </button>
        </div>
      )}
      <div className={st.tableScroll}>
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>Name</th>
              {kind === 'consignees' && <th>Client</th>}
              <th style={{ textAlign: 'center' }}>Shipments</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <InlineName
                    value={r.name}
                    label={`${label} name`}
                    onSave={
                      manage
                        ? (name) => void patch.mutateAsync({ id: r.id, v: { name } })
                        : undefined
                    }
                  />
                </td>
                {kind === 'consignees' && (
                  <td>
                    <select
                      className={ui.input}
                      disabled={!manage}
                      value={(r as { clientId: string | null }).clientId ?? ''}
                      aria-label="Client"
                      onChange={(e) =>
                        void patch.mutateAsync({
                          id: r.id,
                          v: { clientId: e.target.value || null },
                        })
                      }
                    >
                      <option value="">— overseas buyer —</option>
                      {lookups.data?.clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
                <td style={{ textAlign: 'center' }}>{r.shipments}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={r.isActive}
                    disabled={!manage}
                    aria-label={`${r.name} active`}
                    onChange={(e) =>
                      void patch.mutateAsync({ id: r.id, v: { isActive: e.target.checked } })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Lists({ manage }: { manage: boolean }) {
  const s = useSettings().data!;
  const toast = useToast();
  const [type, setType] = useState<LookupType>('QUANTITY_UNIT');
  const [value, setValue] = useState('');
  const add = useApiMutation(
    () => api('/settings/lookups', { method: 'POST', json: { type, value } }),
    INVALIDATE,
  );
  const patch = useApiMutation(
    ({ id, v }: { id: string; v: Record<string, unknown> }) =>
      api(`/settings/lookups/${id}`, { method: 'PATCH', json: v }),
    INVALIDATE,
  );
  const del = useApiMutation(
    (id: string) => api(`/settings/lookups/${id}`, { method: 'DELETE' }),
    INVALIDATE,
  );
  return (
    <Card
      title="Dropdown lists"
      sub="Replace the prototype's “Add New” lists that were stored only in one browser."
    >
      <ErrorBanner error={add.error ?? patch.error ?? del.error} />
      <div className={ui.toolbar} style={{ marginBottom: 14 }}>
        <select
          className={ui.input}
          value={type}
          onChange={(e) => setType(e.target.value as LookupType)}
          aria-label="List"
        >
          {LOOKUP_TYPES.map((t) => (
            <option key={t} value={t}>
              {LIST_LABEL[t]}
            </option>
          ))}
        </select>
        {manage && (
          <>
            <input
              className={ui.input}
              placeholder="New value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label="Value"
            />
            <button
              type="button"
              className="new-shipment-btn"
              disabled={!value.trim() || add.isPending}
              onClick={() =>
                void add.mutateAsync(undefined).then(() => {
                  setValue('');
                  toast('Added.');
                })
              }
            >
              Add
            </button>
          </>
        )}
      </div>
      <div className={st.tableScroll}>
        <table className="data-table-clean">
          <thead>
            <tr>
              <th>Value</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.lookupValues
              .filter((v) => v.type === type)
              .map((v) => (
                <tr key={v.id}>
                  <td className="val-bold">{v.label}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={v.isActive}
                      disabled={!manage}
                      aria-label={`${v.label} active`}
                      onChange={(e) =>
                        void patch.mutateAsync({ id: v.id, v: { isActive: e.target.checked } })
                      }
                    />
                  </td>
                  <td>
                    {manage && (
                      <button
                        type="button"
                        className={ui.dangerBtn}
                        onClick={() =>
                          window.confirm(`Delete “${v.label}”?`) && void del.mutateAsync(v.id)
                        }
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
