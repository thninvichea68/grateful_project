import { useEffect, useRef, type ReactNode } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Link } from 'react-router-dom';
import type { ClientDetail, LookupsResponse } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useAddConsignee, useClient } from '../../features/hooks';
import { FieldError } from '../../components/ui';
import { AddNewSelect } from './AddNewSelect';
import type { FormValues } from './formModel';
import f from './ShipmentForm.module.css';

/**
 * Shipper and Consignee side by side, laid out like the customs declaration's parties tab.
 * The client is one of the two: the shipper on an export, the consignee on an import. Its
 * card is filled from the client profile (grey, read-only); the other party is chosen here.
 */
export function PartiesSection({ lookups }: { lookups: LookupsResponse }) {
  const { control } = useFormContext<FormValues>();
  const { can } = useAuth();
  const [direction, clientId] = useWatch({ control, name: ['direction', 'clientId'] });
  // The client profile holds the VAT-TIN, address and contacts, and the parties' addresses.
  const client = useClient(can('clients:read') ? clientId : '').data;
  const fallback = lookups.clients.find((c) => c.id === clientId);
  const isImport = direction === 'IMPORT';
  const clientCard = (
    <ClientPartyCard
      title={isImport ? 'Consignee' : 'Shipper'}
      client={client}
      fallbackName={fallback?.legalName || fallback?.name || ''}
      clientId={clientId}
      lookups={lookups}
      consigneePick={isImport}
    />
  );
  return (
    <div className={f.parties}>
      {isImport ? <ShipperCard client={client} lookups={lookups} /> : clientCard}
      {isImport ? clientCard : <ConsigneeCard client={client} lookups={lookups} />}
    </div>
  );
}

function PartyCard({
  title,
  tag,
  tone,
  foot,
  children,
}: {
  title: string;
  tag: string;
  tone: 'client' | 'other';
  foot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`cx-card ${f.partyCard}`}>
      <div className={f.partyHead}>
        <h3>{title}</h3>
        <span className={f.partyTag} data-tone={tone}>
          {tag}
        </span>
      </div>
      <div className={f.partyGrid}>{children}</div>
      {foot && <p className={f.note}>{foot}</p>}
    </div>
  );
}

/** A value taken from a record: shown in a grey box, not typed here. */
function ReadOnly({
  label,
  value,
  wide,
}: {
  label: string;
  value?: string | null;
  wide?: boolean;
}) {
  return (
    <div className="form-field-group" style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label>{label}</label>
      <div className={f.roBox} title={value || undefined}>
        {value || '—'}
      </div>
    </div>
  );
}

const countryName = (lookups: LookupsResponse, iso2: string | null | undefined) =>
  iso2 ? (lookups.countries.find((c) => c.iso2 === iso2)?.name ?? iso2) : '';

/** The client as shipper (export) or consignee (import), from its profile. */
function ClientPartyCard({
  title,
  client,
  fallbackName,
  clientId,
  lookups,
  consigneePick,
}: {
  title: string;
  client: ClientDetail | undefined;
  fallbackName: string;
  clientId: string;
  lookups: LookupsResponse;
  /** Import: which of the client's own consignees (its factories) receives the goods. */
  consigneePick: boolean;
}) {
  const { register, control } = useFormContext<FormValues>();
  const consigneeId = useWatch({ control, name: 'consigneeId' });
  const own = lookups.consignees.filter((c) => c.clientId === clientId);
  const chosen = client?.consignees.find((c) => c.id === consigneeId);
  // A consignee chosen on an older shipment that is not one of the client's own stays listed.
  const other = consigneePick
    ? lookups.consignees.find((c) => c.id === consigneeId && c.clientId !== clientId)
    : undefined;
  const country = (consigneePick && chosen?.countryIso2) || client?.countryIso2;
  return (
    <PartyCard
      title={title}
      tag="Client"
      tone="client"
      foot={
        clientId && (
          <Link to={`/clients/${clientId}`} className="filter-mini-link">
            Edit in Client Details
          </Link>
        )
      }
    >
      {consigneePick && (own.length > 1 || other) ? (
        <div className="form-field-group" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="f-consigneeId">Name</label>
          <select id="f-consigneeId" className="form-select-box" {...register('consigneeId')}>
            {other && <option value={other.id}>{other.name}</option>}
            {own.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <ReadOnly
          label="Name"
          value={(consigneePick && chosen?.name) || client?.legalName || fallbackName}
          wide
        />
      )}
      <ReadOnly label="VAT-TIN" value={client?.vattin} />
      <ReadOnly label="Phone" value={client?.contactPhone} />
      <ReadOnly label="Email" value={client?.contactEmail} />
      <ReadOnly label="Country" value={countryName(lookups, country)} />
      <ReadOnly
        label="Address"
        value={(consigneePick && chosen?.address) || client?.address}
        wide
      />
    </PartyCard>
  );
}

/** Export: the buyer abroad, chosen from the consignee list (or added here). */
function ConsigneeCard({
  client,
  lookups,
}: {
  client: ClientDetail | undefined;
  lookups: LookupsResponse;
}) {
  const {
    register,
    control,
    setValue,
    getValues,
    formState: { errors },
  } = useFormContext<FormValues>();
  const { can } = useAuth();
  const addConsignee = useAddConsignee();
  const [clientId, consigneeId] = useWatch({ control, name: ['clientId', 'consigneeId'] });
  const picked = lookups.consignees.find((c) => c.id === consigneeId);
  const address = client?.consignees.find((c) => c.id === consigneeId)?.address;
  const opts = [...lookups.consignees].sort(
    (a, b) => Number(b.clientId === clientId) - Number(a.clientId === clientId),
  );

  // Picking a consignee fills an empty destination with the consignee's country.
  const lastPick = useRef(consigneeId);
  useEffect(() => {
    if (lastPick.current === consigneeId) return;
    lastPick.current = consigneeId;
    if (picked?.countryIso2 && !getValues('destinationCountryIso2'))
      setValue('destinationCountryIso2', picked.countryIso2, { shouldDirty: true });
  }, [consigneeId, picked, getValues, setValue]);

  return (
    <PartyCard title="Consignee" tag="Buyer" tone="other">
      <div className="form-field-group" style={{ gridColumn: '1 / -1' }}>
        <label htmlFor="f-consigneeId">Name</label>
        <AddNewSelect
          id="f-consigneeId"
          label="Consignee"
          placeholder="Select consignee"
          registration={register('consigneeId')}
          options={opts.map((c) => ({ value: c.id, label: c.name }))}
          onCreate={
            can('shipments:write')
              ? async (name) => (await addConsignee.mutateAsync({ name, clientId })).id
              : undefined
          }
        />
      </div>
      <CountrySelect
        name="destinationCountryIso2"
        label="Destination Country"
        lookups={lookups}
        error={errors.destinationCountryIso2?.message}
      />
      <ReadOnly label="Consignee Country" value={countryName(lookups, picked?.countryIso2)} />
      <ReadOnly label="Address" value={address} wide />
    </PartyCard>
  );
}

/** Import: the supplier abroad, typed or picked from the client's suppliers. */
function ShipperCard({
  client,
  lookups,
}: {
  client: ClientDetail | undefined;
  lookups: LookupsResponse;
}) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<FormValues>();
  const shipperName = useWatch({ control, name: 'shipperName' }) ?? '';
  const suppliers = client?.suppliers ?? [];
  const supplier = suppliers.find(
    (s) => s.name.trim().toLowerCase() === shipperName.trim().toLowerCase(),
  );
  return (
    <PartyCard title="Shipper" tag="Supplier" tone="other">
      <div className="form-field-group" style={{ gridColumn: '1 / -1' }}>
        <label htmlFor="f-shipperName">Name</label>
        <input
          id="f-shipperName"
          className="form-field-box"
          placeholder="Supplier name"
          list="f-shipper-suppliers"
          autoComplete="off"
          {...register('shipperName')}
          aria-invalid={!!errors.shipperName}
        />
        <datalist id="f-shipper-suppliers">
          {suppliers.map((s) => (
            <option key={s.name} value={s.name} />
          ))}
        </datalist>
        <FieldError message={errors.shipperName?.message} />
      </div>
      <CountrySelect
        name="originCountryIso2"
        label="Origin Country"
        lookups={lookups}
        error={errors.originCountryIso2?.message}
      />
      <ReadOnly label="Address" value={supplier?.address} wide />
    </PartyCard>
  );
}

function CountrySelect({
  name,
  label,
  lookups,
  error,
}: {
  name: 'originCountryIso2' | 'destinationCountryIso2';
  label: string;
  lookups: LookupsResponse;
  error: string | undefined;
}) {
  const { register } = useFormContext<FormValues>();
  return (
    <div className="form-field-group">
      <label htmlFor={`f-${name}`}>{label}</label>
      <select
        id={`f-${name}`}
        className="form-select-box"
        {...register(name)}
        aria-invalid={!!error}
      >
        <option value="">Select country</option>
        {lookups.countries.map((c) => (
          <option key={c.iso2} value={c.iso2}>
            {c.name}
          </option>
        ))}
      </select>
      <FieldError message={error} />
    </div>
  );
}
