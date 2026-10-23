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
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import s from './PartiesCard.module.css';

type Party =
  | { kind: 'supplier'; id: string | null; name: string; address: string | null }
  | { kind: 'consignee'; id: string; name: string; address: string | null };

/**
 * Client Details: the client's Suppliers (import shippers) and Consignees side by side, each
 * with its address; the INV + PL letterhead prints them (Shipping Plans → Export INV + PL).
 */
export function PartiesCard({ client }: { client: ClientDetail }) {
  const { can } = useAuth();
  const editable = can('clients:write');
  /** A row, or the kind a "+ Add" creates. */
  const [open, setOpen] = useState<Party | Party['kind'] | null>(null);
  const toast = useToast();
  const delSupplier = useDeleteSupplier(client.id);
  const delConsignee = useDeleteConsignee(client.id);

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

  const column = (title: string, rows: Party[], empty: string, add?: () => void) => (
    <div className={s.column}>
      <div className={s.head}>
        <h3>
          {title} <span className={s.count}>{rows.length}</span>
        </h3>
        {add && editable && (
          <button type="button" className="filter-btn" onClick={add}>
            + Add
          </button>
        )}
      </div>
      <div className={s.scroll}>
        {rows.length === 0 && <span className={s.muted}>{empty}</span>}
        {rows.map((p) => (
          <div key={`${p.kind}:${p.id ?? p.name}`} className={s.row}>
            <button
              type="button"
              className={s.item}
              disabled={!editable}
              onClick={() => setOpen(p)}
              title={editable ? 'Set the address' : undefined}
            >
              <b>{p.name}</b>
              {p.address ? (
                <span className={s.address}>{p.address}</span>
              ) : (
                <span className={s.noAddress}>No address</span>
              )}
            </button>
            {editable && (
              <button
                type="button"
                className={s.delete}
                onClick={() => void remove(p)}
                disabled={delSupplier.isPending || delConsignee.isPending}
                aria-label={`Delete ${p.name}`}
                title="Delete"
              >
                {icons.trash({ width: 14, height: 14 })}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="card">
      <ErrorBanner error={delSupplier.error ?? delConsignee.error} />
      <div className={s.grid}>
        {column(
          'Suppliers',
          client.suppliers.map((x) => ({ kind: 'supplier' as const, ...x })),
          'No suppliers yet. Shipper names on imports appear here.',
          () => setOpen('supplier'),
        )}
        {column(
          'Consignees',
          client.consignees.map((x) => ({ kind: 'consignee' as const, ...x })),
          'None linked to this client.',
          () => setOpen('consignee'),
        )}
      </div>
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
