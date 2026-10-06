import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useClient, useDeleteClient, useLookups, useSaveClient } from '../../features/hooks';
import { Pill, ShipmentStatusPill } from '../../components/StatusPill';
import { ErrorBanner, TableState, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { fmtDate, fmtMoney } from '../../lib/format';
import { CLIENT_STATUS_PILL } from '../ClientsPage';
import { ClientFormModal } from './ClientFormModal';
import s from './ClientDetailPage.module.css';

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const client = useClient(id);
  const lookups = useLookups();
  const save = useSaveClient();
  const del = useDeleteClient();
  const [editing, setEditing] = useState(false);
  const c = client.data;

  if (client.isLoading)
    return (
      <section className="view active">
        <div className="card">Loading client…</div>
      </section>
    );
  if (client.error || !c)
    return (
      <section className="view active">
        <ErrorBanner error={client.error} />
        <Link to="/clients" className="filter-btn" style={{ display: 'inline-flex' }}>
          ← Back to clients
        </Link>
      </section>
    );

  const toggleActive = async () => {
    const next = c.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE';
    if (
      next === 'INACTIVE' &&
      !window.confirm(
        `Deactivate ${c.name}? Existing shipments stay; new shipments can't be created for this client.`,
      )
    )
      return;
    await save.mutateAsync({ id: c.id, body: { status: next } });
    await client.refetch();
    toast(next === 'INACTIVE' ? 'Client deactivated.' : 'Client reactivated.');
  };
  const remove = async () => {
    if (
      !window.confirm(
        `Delete ${c.name}? This only works for clients without shipments or cut-stock items.`,
      )
    )
      return;
    await del.mutateAsync(c.id);
    toast('Client deleted.');
    navigate('/clients');
  };

  const country =
    lookups.data?.countries.find((x) => x.iso2 === c.countryIso2)?.name ?? c.countryIso2;
  return (
    <section className="view active">
      <div className={s.head}>
        <div>
          <Link to="/clients" className={s.muted}>
            ← Clients
          </Link>
          <div className={s.title}>{c.name}</div>
          <div className={s.sub}>
            {c.code} · {country} ·{' '}
            <Pill tone={CLIENT_STATUS_PILL[c.status].tone}>
              {CLIENT_STATUS_PILL[c.status].label}
            </Pill>
          </div>
        </div>
        {can('clients:write') && (
          <div className={ui.toolbar}>
            <button
              type="button"
              className={ui.ghostBtn}
              onClick={() => void toggleActive()}
              disabled={save.isPending}
            >
              {c.status === 'INACTIVE' ? 'Reactivate' : 'Deactivate'}
            </button>
            {c.shipmentCount === 0 && c.cutStockItems === 0 && (
              <button
                type="button"
                className={ui.dangerBtn}
                onClick={() => void remove()}
                disabled={del.isPending}
              >
                Delete
              </button>
            )}
            <button type="button" className="new-shipment-btn" onClick={() => setEditing(true)}>
              Edit client
            </button>
          </div>
        )}
      </div>
      <ErrorBanner error={save.error ?? del.error} />

      <div className={s.stats}>
        <div className={s.stat}>
          <div className={s.statLabel}>Active runs</div>
          <div className={s.statValue}>{c.activeShipments}</div>
        </div>
        <div className={s.stat}>
          <div className={s.statLabel}>Imports</div>
          <div className={s.statValue}>{c.importCount}</div>
        </div>
        <div className={s.stat}>
          <div className={s.statLabel}>Exports</div>
          <div className={s.statValue}>{c.exportCount}</div>
        </div>
        {c.netProfitYtd !== undefined ? (
          <div className={s.stat}>
            <div className={s.statLabel}>Net profit this year</div>
            <div className={s.statValue}>{fmtMoney(c.netProfitYtd)}</div>
          </div>
        ) : (
          <div className={s.stat}>
            <div className={s.statLabel}>Total shipments</div>
            <div className={s.statValue}>{c.shipmentCount}</div>
          </div>
        )}
      </div>

      <div className={s.layout}>
        <div className="card">
          <div className="card-header-row">
            <h3>Recent shipments</h3>
            <Link to={`/plans?clientId=${c.id}`} className="filter-btn">
              View all in Shipping Plans
            </Link>
          </div>
          <div className="plans-table-scroll">
            <table className="data-table-clean">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Invoice No.</th>
                  <th>Transport</th>
                  <th>ETA</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <TableState
                  cols={5}
                  loading={false}
                  error={null}
                  empty={!c.recentShipments.length}
                  emptyText="No shipments for this client yet."
                />
                {c.recentShipments.map((r) => (
                  <tr
                    key={r.id}
                    className="plans-row-clickable"
                    onClick={() => navigate(`/plans/${r.id}`)}
                  >
                    <td className="val-bold">{r.reference}</td>
                    <td>{r.invoiceNos.join(', ') || '-'}</td>
                    <td>{r.direction}</td>
                    <td>{fmtDate(r.eta)}</td>
                    <td>
                      <ShipmentStatusPill status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="card">
            <div className="card-header-row">
              <h3>Details</h3>
            </div>
            <dl className={s.facts}>
              <dt>Legal name</dt>
              <dd>{c.legalName ?? '-'}</dd>
              {c.legalNameKm && (
                <>
                  <dt>Khmer name</dt>
                  <dd>{c.legalNameKm}</dd>
                </>
              )}
              <dt>VATTIN</dt>
              <dd>{c.vattin ?? '-'}</dd>
              <dt>Address</dt>
              <dd>{c.address ?? '-'}</dd>
              <dt>Contact</dt>
              <dd>
                {[c.contactName, c.contactEmail, c.contactPhone].filter(Boolean).join(' · ') || '-'}
              </dd>
              <dt>Commission (CM)</dt>
              <dd>{fmtMoney(c.commissionUsd)} per declaration</dd>
              <dt>Client since</dt>
              <dd>{fmtDate(c.createdAt)}</dd>
            </dl>
          </div>
          <div className="card">
            <div className="card-header-row">
              <h3>Consignees</h3>
            </div>
            <div className={s.list}>
              {c.consignees.length ? (
                c.consignees.map((x) => <div key={x.id}>{x.name}</div>)
              ) : (
                <span className={s.muted}>None linked to this client.</span>
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-header-row">
              <h3>CDC master list</h3>
            </div>
            {c.cutStockItems ? (
              <Link
                to={`/cutstock?clientId=${c.id}`}
                className="filter-btn"
                style={{ display: 'inline-flex' }}
              >
                Open {c.cutStockItems} items
              </Link>
            ) : (
              <span className={s.muted}>
                No master list loaded. Import one from the Cut Stock page.
              </span>
            )}
          </div>
        </div>
      </div>
      {editing && (
        <ClientFormModal
          client={c}
          onClose={() => {
            setEditing(false);
            void client.refetch();
          }}
        />
      )}
    </section>
  );
}
