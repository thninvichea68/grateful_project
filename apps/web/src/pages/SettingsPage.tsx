import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import {
  LOOKUP_TYPES,
  PORT_KINDS,
  companySchema,
  type CompanyInput,
  type LookupType,
  type SettingsBundle,
} from '@gs/shared';
import { useAuth } from '../auth/AuthProvider';
import { useApiMutation, useSettings } from '../features/admin';
import { useLookups } from '../features/hooks';
import { ErrorBanner, FieldError, ui } from '../components/ui';
import { InlineName } from '../components/InlineName';
import { MyProfile } from './settings/MyProfile';
import { RatesTab } from './settings/RatesTab';
import st from './SettingsPage.module.css';
import r from './settings/ExchangeRates.module.css';
import { icons } from '../layout/icons';
import { useToast } from '../components/Toast';
import { ApiError, api } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { formResolver } from '../lib/zodForm';

const TABS = [
  ['profile', 'My profile'],
  ['company', 'Company'],
  ['rates', 'Rates'],
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
  CHARGE_UNIT: 'Charge units',
};
const INVALIDATE = [['settings'], queryKeys.lookups, ['meta', 'company']];

/**
 * Settings. "My profile" is open to everyone (the sidebar's user card links to it); the
 * workspace tabs need settings:read.
 */
export function SettingsPage() {
  const { can } = useAuth();
  const canRead = can('settings:read');
  const [params, setParams] = useSearchParams();
  const tabs = canRead ? TABS : TABS.filter(([k]) => k === 'profile');
  // "market" was the old Fuel & metals tab; it now lives under Rates.
  const asked = params.get('tab') === 'market' ? 'rates' : params.get('tab');
  const tab: Tab = tabs.some(([k]) => k === asked)
    ? (asked as Tab)
    : canRead
      ? 'company'
      : 'profile';
  const setTab = (k: Tab) => setParams({ tab: k }, { replace: true });
  return (
    // The list tabs fill the window so only their rows scroll.
    <section
      className={`view active${tab !== 'company' && tab !== 'profile' ? ` ${st.fill}` : ''}`}
    >
      <nav
        style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}
        aria-label="Settings sections"
      >
        {tabs.map(([k, l]) => (
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
      {tab === 'profile' ? <MyProfile /> : <Workspace tab={tab} />}
    </section>
  );
}

function Workspace({ tab }: { tab: Exclude<Tab, 'profile'> }) {
  const { can } = useAuth();
  const settings = useSettings();
  const manage = can('settings:manage');
  return (
    <>
      <ErrorBanner error={settings.error} />
      {!manage && (
        <p className={ui.dialogSub} style={{ marginBottom: 12 }}>
          Read only. Only Admins can change settings.
        </p>
      )}
      {settings.data && (
        <>
          {tab === 'company' && <CompanyForm initial={settings.data.company} manage={manage} />}
          {tab === 'rates' && <RatesTab manage={manage} />}
          {tab === 'ports' && <Ports manage={manage} />}
          {tab === 'forwarders' && <SimpleList kind="forwarders" manage={manage} />}
          {tab === 'consignees' && <SimpleList kind="consignees" manage={manage} />}
          {tab === 'lists' && <Lists manage={manage} />}
        </>
      )}
    </>
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
              {manage && <th style={{ textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {s.ports.map((p) => (
              <PortRow
                key={p.id}
                port={p}
                manage={manage}
                onActive={(isActive) => void patch.mutateAsync({ id: p.id, v: { isActive } })}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

type PortItem = SettingsBundle['ports'][number];
const errorMessage = (e: unknown) =>
  e instanceof ApiError ? e.message : 'Something went wrong. Try again.';

/** One port: view, or edit every field in place (pencil); delete it if nothing uses it (bin). */
function PortRow({
  port: p,
  manage,
  onActive,
}: {
  port: PortItem;
  manage: boolean;
  onActive: (isActive: boolean) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<null | {
    code: string;
    customsPortNo: string;
    name: string;
    shortName: string;
    kind: string;
  }>(null);
  const save = useApiMutation(
    () => api(`/settings/ports/${p.id}`, { method: 'PATCH', json: draft }),
    INVALIDATE,
  );
  const del = useApiMutation(
    () => api(`/settings/ports/${p.id}`, { method: 'DELETE' }),
    INVALIDATE,
  );
  const err = save.error ?? del.error;

  if (draft) {
    const set = (k: keyof typeof draft) => (e: { target: { value: string } }) =>
      setDraft({ ...draft, [k]: e.target.value });
    return (
      <tr className={st.editRow}>
        <td>
          <input className={ui.input} value={draft.code} onChange={set('code')} aria-label="Code" />
        </td>
        <td>
          <input
            className={ui.input}
            value={draft.customsPortNo}
            onChange={set('customsPortNo')}
            aria-label="Customs port no."
            style={{ width: 70 }}
          />
        </td>
        <td>
          <input className={ui.input} value={draft.name} onChange={set('name')} aria-label="Name" />
        </td>
        <td>
          <input
            className={ui.input}
            value={draft.shortName}
            onChange={set('shortName')}
            aria-label="Chart label"
          />
        </td>
        <td>
          <select className={ui.input} value={draft.kind} onChange={set('kind')} aria-label="Kind">
            {PORT_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </td>
        <td style={{ textAlign: 'center' }}>{p.shipments}</td>
        <td colSpan={2}>
          <div className={r.actions}>
            <button
              type="button"
              className="btn-cancel-shipment"
              onClick={() => {
                setDraft(null);
                save.reset();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-create-submit"
              disabled={
                save.isPending ||
                !draft.code.trim() ||
                !draft.name.trim() ||
                !draft.shortName.trim()
              }
              onClick={() =>
                void save.mutateAsync(undefined).then(() => {
                  setDraft(null);
                  toast(`Port ${draft.code.toUpperCase()} saved.`);
                })
              }
            >
              Save
            </button>
          </div>
          <ErrorBanner error={err} />
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="val-bold">{p.code}</td>
      <td>{p.customsPortNo ?? '-'}</td>
      <td className="val-bold">{p.name}</td>
      <td>{p.shortName}</td>
      <td>{p.kind}</td>
      <td style={{ textAlign: 'center' }}>{p.shipments}</td>
      <td>
        <input
          type="checkbox"
          checked={p.isActive}
          disabled={!manage}
          aria-label={`${p.code} active`}
          onChange={(e) => onActive(e.target.checked)}
        />
      </td>
      {manage && (
        <td>
          <div className={r.actions}>
            <button
              type="button"
              className={r.icon}
              title="Edit"
              aria-label={`Edit port ${p.code}`}
              onClick={() =>
                setDraft({
                  code: p.code,
                  customsPortNo: p.customsPortNo ?? '',
                  name: p.name,
                  shortName: p.shortName,
                  kind: p.kind,
                })
              }
            >
              {icons.edit({})}
            </button>
            <button
              type="button"
              className={`${r.icon} ${r.danger}`}
              title={p.shipments > 0 ? 'In use: untick Active to hide it instead' : 'Delete'}
              aria-label={`Delete port ${p.code}`}
              disabled={del.isPending}
              onClick={() =>
                window.confirm(`Delete port ${p.code} (${p.name})? This can't be undone.`) &&
                void del
                  .mutateAsync(undefined)
                  .then(() => toast(`Port ${p.code} deleted.`))
                  .catch((e: unknown) => toast(errorMessage(e)))
              }
            >
              {icons.trash({})}
            </button>
          </div>
        </td>
      )}
    </tr>
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
