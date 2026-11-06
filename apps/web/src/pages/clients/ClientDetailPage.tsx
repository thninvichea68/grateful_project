import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BackLink, backRow } from '../../components/BackLink';
import { useAuth } from '../../auth/AuthProvider';
import { useClient, useDeleteClient, useLookups, useSaveClient } from '../../features/hooks';
import { Pill } from '../../components/StatusPill';
import { ErrorBanner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { fmtDate, fmtMoney } from '../../lib/format';
import { icons } from '../../layout/icons';
import { CLIENT_STATUS_PILL } from '../ClientsPage';
import { ClientFormModal } from './ClientFormModal';
import { ClientMoreMenu } from './ClientMoreMenu';
import { PartiesCard } from './PartiesCard';
import { RemarksCard } from './RemarksCard';
import { AttachmentsCard } from './AttachmentsCard';
import s from './ClientDetailPage.module.css';

/** A field the client record leaves blank. */
function Empty() {
  return <span className={s.empty}>Not set</span>;
}

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
        <BackLink to="/clients" label="Back to clients" />
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
        <div className={backRow}>
          <BackLink to="/clients" label="Clients" />
          <div className={s.titleRow}>
            <h2 className={s.title}>{c.name}</h2>
            <Pill tone={CLIENT_STATUS_PILL[c.status].tone}>
              {CLIENT_STATUS_PILL[c.status].label}
            </Pill>
          </div>
          <div className={s.sub}>
            {c.code} · {country} · Client since {fmtDate(c.createdAt)}
          </div>
        </div>
        {/* Where to go from here (the client's shipments and CDC master list), then actions. */}
        <div className={s.actions}>
          <Link to={`/plans?clientId=${c.id}`} className={s.quickLink}>
            {icons.plans({ width: 14, height: 14 })}
            Shipping Plans
          </Link>
          {c.cutStockItems ? (
            <Link to={`/cutstock?clientId=${c.id}`} className={s.quickLink}>
              {icons.cutstock({ width: 14, height: 14 })}
              CDC master list <span className={s.quickCount}>{c.cutStockItems}</span>
            </Link>
          ) : (
            <span
              className={`${s.quickLink} ${s.quickLinkOff}`}
              title="Import one from the Cut Stock page"
            >
              {icons.cutstock({ width: 14, height: 14 })}
              No CDC master list
            </span>
          )}
          {can('clients:write') && (
            <>
              <span className={s.divider} aria-hidden />
              <button type="button" className="new-shipment-btn" onClick={() => setEditing(true)}>
                {icons.edit({ width: 14, height: 14 })}
                Edit client
              </button>
              <ClientMoreMenu
                inactive={c.status === 'INACTIVE'}
                busy={save.isPending || del.isPending}
                onToggleActive={() => void toggleActive()}
                onDelete={
                  c.shipmentCount === 0 && c.cutStockItems === 0 ? () => void remove() : undefined
                }
              />
            </>
          )}
        </div>
      </div>
      <ErrorBanner error={save.error ?? del.error} />

      {/* One strip; Imports and Exports open the client's shipments in Shipping Plans. */}
      <div className={s.stats}>
        <div className={s.stat} title="In progress or pending">
          <div className={s.statLabel}>Active shipments</div>
          <div className={s.statValue}>{c.activeShipments}</div>
        </div>
        <Link to={`/plans?clientId=${c.id}&direction=IMPORT`} className={`${s.stat} ${s.statLink}`}>
          <div className={s.statLabel}>
            Imports {icons.chevronRight({ width: 12, height: 12, className: s.statArrow })}
          </div>
          <div className={s.statValue}>{c.importCount}</div>
        </Link>
        <Link to={`/plans?clientId=${c.id}&direction=EXPORT`} className={`${s.stat} ${s.statLink}`}>
          <div className={s.statLabel}>
            Exports {icons.chevronRight({ width: 12, height: 12, className: s.statArrow })}
          </div>
          <div className={s.statValue}>{c.exportCount}</div>
        </Link>
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
        <div className={s.column}>
          <div className="card">
            <div className="card-header-row">
              <h3>Details</h3>
            </div>
            {/* Company and Contact side by side; the English and Khmer address below them. */}
            <div className={s.groups}>
              <section className={s.group}>
                <h4 className={s.groupTitle}>Company</h4>
                <dl className={s.facts}>
                  <dt>Legal name</dt>
                  <dd>{c.legalName ?? <Empty />}</dd>
                  <dt>Khmer name</dt>
                  <dd lang="km">{c.legalNameKm ?? <Empty />}</dd>
                  <dt>VATTIN</dt>
                  <dd className={s.mono}>{c.vattin ?? <Empty />}</dd>
                </dl>
              </section>
              <section className={s.group}>
                <h4 className={s.groupTitle}>Contact &amp; billing</h4>
                <dl className={s.facts}>
                  <dt>Contact</dt>
                  <dd>{c.contactName ?? <Empty />}</dd>
                  <dt>Email</dt>
                  <dd>
                    {c.contactEmail ? (
                      <a className={s.link} href={`mailto:${c.contactEmail}`}>
                        {c.contactEmail}
                      </a>
                    ) : (
                      <Empty />
                    )}
                  </dd>
                  <dt>Phone</dt>
                  <dd>
                    {c.contactPhone ? (
                      <a className={s.link} href={`tel:${c.contactPhone.replace(/\s+/g, '')}`}>
                        {c.contactPhone}
                      </a>
                    ) : (
                      <Empty />
                    )}
                  </dd>
                  <dt>Commission</dt>
                  <dd>
                    {fmtMoney(c.commissionUsd)} <span className={s.unit}>per declaration</span>
                  </dd>
                </dl>
              </section>
              <section className={`${s.group} ${s.groupWide}`}>
                <h4 className={s.groupTitle}>Address</h4>
                <div className={s.addresses}>
                  <div className={s.addressBox}>
                    <span className={s.addressLang}>English</span>
                    <p>{c.address ?? <Empty />}</p>
                  </div>
                  <div className={s.addressBox}>
                    <span className={s.addressLang}>Khmer</span>
                    <p lang="km">{c.addressKm ?? <Empty />}</p>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
        <div className={s.column}>
          <RemarksCard clientId={c.id} />
          <AttachmentsCard clientId={c.id} title={c.name} />
        </div>
      </div>

      <div className={s.parties}>
        <PartiesCard client={c} />
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
