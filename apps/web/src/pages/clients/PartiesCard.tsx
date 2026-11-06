import { useState } from 'react';
import type { ClientDetail } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import {
  useAddClientConsignee,
  useDeleteConsignee,
  useDeleteSupplier,
  useSaveSupplier,
  useSetConsigneeAddress,
} from '../../features/hooks';
import { ErrorBanner, FieldError, Modal, ui } from '../../components/ui';
import { SearchBox } from '../../components/SearchBox';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import s from './PartiesCard.module.css';

type Party =
  | { kind: 'supplier'; id: string | null; name: string; address: string | null }
  | { kind: 'consignee'; id: string; name: string; address: string | null };

/** Rows shown before "Show all". */
const PREVIEW = 25;

const TABS = {
  supplier: {
    label: 'Suppliers',
    icon: icons.upload,
    sub: "Shippers on this client's imports",
    empty: 'No suppliers yet. Shipper names on imports appear here.',
  },
  consignee: {
    label: 'Consignees',
    icon: icons.consignees,
    sub: "Receivers on this client's exports",
    empty: 'None linked to this client.',
  },
} as const;

/**
 * Client Details: the client's Suppliers (import shippers) and Consignees in one tabbed card,
 * one compact row each, with search and a "missing address" filter; the INV + PL letterhead
 * prints the addresses (Shipping Plans → Export INV + PL).
 */
export function PartiesCard({ client }: { client: ClientDetail }) {
  const { can } = useAuth();
  const editable = can('clients:write');
  /** A row, or the kind a "+ Add" creates. */
  const [open, setOpen] = useState<Party | Party['kind'] | null>(null);
  const [tab, setTab] = useState<Party['kind']>('supplier');
  const [q, setQ] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [all, setAll] = useState(false);
  const toast = useToast();
  const delSupplier = useDeleteSupplier(client.id);
  const delConsignee = useDeleteConsignee(client.id);

  const lists: Record<Party['kind'], Party[]> = {
    supplier: client.suppliers.map((x) => ({ kind: 'supplier' as const, ...x })),
    consignee: client.consignees.map((x) => ({ kind: 'consignee' as const, ...x })),
  };
  const rows = lists[tab];
  const missing = rows.filter((p) => !p.address).length;
  const needle = q.trim().toLowerCase();
  const matches = rows.filter(
    (p) =>
      (!missingOnly || !p.address) &&
      (!needle ||
        p.name.toLowerCase().includes(needle) ||
        (p.address ?? '').toLowerCase().includes(needle)),
  );
  const shown = all || needle ? matches : matches.slice(0, PREVIEW);
  const deleting = tab === 'supplier' ? delSupplier.isPending : delConsignee.isPending;
  const meta = TABS[tab];

  const switchTab = (k: Party['kind']) => {
    setTab(k);
    setQ('');
    setMissingOnly(false);
    setAll(false);
  };

  const remove = async (p: Party) => {
    const msg =
      p.kind === 'supplier'
        ? `Delete supplier ${p.name}? Its address is cleared and it leaves this list; shipments keep their Shipper Name. "+ Add" brings it back.`
        : `Delete consignee ${p.name}? It leaves this list and the consignee dropdowns; shipments that name it keep it.`;
    if (!window.confirm(msg)) return;
    if (p.kind === 'supplier') await delSupplier.mutateAsync(p.name);
    else await delConsignee.mutateAsync(p.id);
    toast(`${p.kind === 'supplier' ? 'Supplier' : 'Consignee'} deleted.`);
  };

  return (
    <div className="card">
      <ErrorBanner error={delSupplier.error ?? delConsignee.error} />
      <div className={s.tabs} role="tablist" aria-label="Parties">
        {(Object.keys(TABS) as Party['kind'][]).map((k) => {
          const n = lists[k].filter((p) => !p.address).length;
          return (
            <button
              key={k}
              type="button"
              role="tab"
              className={s.tab}
              aria-selected={tab === k}
              onClick={() => switchTab(k)}
            >
              <span className={s.tabIcon}>{TABS[k].icon({})}</span>
              {TABS[k].label}
              <span className={s.count}>{lists[k].length}</span>
              {n > 0 && (
                <span className={s.tabWarn} title={`${n} without address`}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className={s.toolbar}>
        <span className={s.sub}>{meta.sub}</span>
        <div className={s.tools}>
          {rows.length > 0 && (
            <SearchBox
              className={s.search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${meta.label.toLowerCase()}`}
              aria-label={`Search ${meta.label.toLowerCase()}`}
            />
          )}
          {missing > 0 && (
            <button
              type="button"
              className={s.chip}
              aria-pressed={missingOnly}
              onClick={() => setMissingOnly((x) => !x)}
            >
              Missing address <span className={s.chipCount}>{missing}</span>
            </button>
          )}
          {editable && (
            <button type="button" className="filter-btn" onClick={() => setOpen(tab)}>
              + Add
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 && <div className={s.empty}>{meta.empty}</div>}
      {rows.length > 0 && matches.length === 0 && (
        <div className={s.empty}>
          No {meta.label.toLowerCase()} match{needle ? ` "${q.trim()}"` : ''}.
        </div>
      )}
      {shown.length > 0 && (
        <ul className={s.list}>
          {shown.map((p) => (
            <li key={`${p.kind}:${p.id ?? p.name}`} className={s.row}>
              <button
                type="button"
                className={s.item}
                disabled={!editable}
                onClick={() => setOpen(p)}
                title={editable ? 'Set the address' : undefined}
              >
                <b className={s.name}>{p.name}</b>
                {p.address ? (
                  <span className={s.address} title={p.address}>
                    {p.address.replace(/\s*\n\s*/g, ', ')}
                  </span>
                ) : (
                  <span className={s.noAddress}>No address</span>
                )}
              </button>
              {editable && (
                <div className={s.actions}>
                  <button
                    type="button"
                    className={s.iconBtn}
                    onClick={() => setOpen(p)}
                    aria-label={`Edit ${p.name}`}
                    title="Edit address"
                  >
                    {icons.edit({ width: 14, height: 14 })}
                  </button>
                  <button
                    type="button"
                    className={`${s.iconBtn} ${s.delete}`}
                    onClick={() => void remove(p)}
                    disabled={deleting}
                    aria-label={`Delete ${p.name}`}
                    title="Delete"
                  >
                    {icons.trash({ width: 14, height: 14 })}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!needle && matches.length > PREVIEW && (
        <button type="button" className={s.more} onClick={() => setAll((x) => !x)}>
          {all ? 'Show fewer' : `Show all ${matches.length}`}
        </button>
      )}
      {open && (
        <AddressModal
          clientId={client.id}
          party={typeof open === 'string' ? null : open}
          kind={typeof open === 'string' ? open : open.kind}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/** Set a supplier's or consignee's address; a new one also takes its name. */
function AddressModal({
  clientId,
  party,
  kind,
  onClose,
}: {
  clientId: string;
  /** null: a new one, of `kind`. */
  party: Party | null;
  kind: Party['kind'];
  onClose: () => void;
}) {
  const toast = useToast();
  const saveSupplier = useSaveSupplier(clientId);
  const setConsignee = useSetConsigneeAddress(clientId);
  const addConsignee = useAddClientConsignee(clientId);
  const [name, setName] = useState(party?.name ?? '');
  const [address, setAddress] = useState(party?.address ?? '');
  const [nameError, setNameError] = useState<string>();
  const supplier = kind === 'supplier';
  const label = supplier ? 'supplier' : 'consignee';
  const pending = saveSupplier.isPending || setConsignee.isPending || addConsignee.isPending;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!party && !name.trim()) return setNameError(`Enter the ${label} name`);
    if (supplier) await saveSupplier.mutateAsync({ name, address });
    else if (party?.kind === 'consignee')
      await setConsignee.mutateAsync({ id: party.id, body: { address } });
    else await addConsignee.mutateAsync({ name, address });
    toast(party ? 'Address saved.' : `${supplier ? 'Supplier' : 'Consignee'} added.`);
    onClose();
  };
  return (
    <Modal
      title={party ? party.name : `Add ${label}`}
      sub={
        supplier
          ? 'Printed under the supplier name on the import Invoice + Packing List letterhead.'
          : 'Printed under the consignee on the export Invoice + Packing List.'
      }
      onClose={onClose}
      width={560}
    >
      <ErrorBanner error={saveSupplier.error ?? setConsignee.error ?? addConsignee.error} />
      <form onSubmit={(e) => void save(e)} noValidate>
        <div className="form-fields-grid" style={{ gridTemplateColumns: '1fr' }}>
          {!party && (
            <div className="form-field-group">
              <label htmlFor="party-name">{supplier ? 'Supplier name' : 'Consignee name'}</label>
              <input
                id="party-name"
                className="form-field-box"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(undefined);
                }}
                placeholder={
                  supplier ? 'As typed in Shipper Name on the shipment' : 'e.g. TJX AU PTY LIMITED'
                }
                aria-invalid={!!nameError}
              />
              <FieldError message={nameError} />
            </div>
          )}
          <div className="form-field-group">
            <label htmlFor="party-address">Address</label>
            <textarea
              id="party-address"
              className="form-field-box"
              rows={4}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={'Street, building\nCity, country'}
            />
          </div>
        </div>
        <div className={ui.actions}>
          <button type="button" className="btn-cancel-shipment" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-create-submit" disabled={pending}>
            {pending ? 'Saving…' : party ? 'Save' : `Add ${label}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
