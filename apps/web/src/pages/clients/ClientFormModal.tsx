import { useForm } from 'react-hook-form';
import { formResolver } from '../../lib/zodForm';
import {
  CLIENT_STATUSES,
  clientInputSchema,
  type ClientDetail,
  type ClientInput,
} from '@gs/shared';
import { useLookups, useSaveClient } from '../../features/hooks';
import { ErrorBanner, FieldError, Modal, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';

const STATUS_LABEL = { ACTIVE: 'Active', ONBOARDING: 'Onboarding', INACTIVE: 'Inactive' } as const;

export function ClientFormModal({
  client,
  onClose,
  onSaved,
}: {
  client?: ClientDetail;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const lookups = useLookups();
  const save = useSaveClient();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClientInput>({
    resolver: formResolver(clientInputSchema),
    defaultValues: client
      ? {
          code: client.code,
          name: client.name,
          legalName: client.legalName ?? '',
          legalNameKm: client.legalNameKm ?? '',
          countryIso2: client.countryIso2,
          address: client.address ?? '',
          vattin: client.vattin ?? '',
          contactName: client.contactName ?? '',
          contactEmail: client.contactEmail ?? '',
          contactPhone: client.contactPhone ?? '',
          commissionUsd: client.commissionUsd,
          status: client.status,
        }
      : { countryIso2: 'KH', commissionUsd: '50.00', status: 'ACTIVE' },
  });

  const onSubmit = handleSubmit(async (values) => {
    const res = await save.mutateAsync({ id: client?.id, body: values });
    toast(client ? 'Client updated.' : 'Client added.');
    onSaved?.(res.id);
    onClose();
  });

  const field = (
    name: keyof ClientInput,
    label: string,
    opts: { span?: number; type?: string; placeholder?: string } = {},
  ) => (
    <div
      className="form-field-group"
      style={opts.span ? { gridColumn: `span ${opts.span}` } : undefined}
    >
      <label htmlFor={`cl-${name}`}>{label}</label>
      <input
        id={`cl-${name}`}
        className="form-field-box"
        type={opts.type ?? 'text'}
        placeholder={opts.placeholder ?? label}
        {...register(name)}
        aria-invalid={!!errors[name]}
      />
      <FieldError message={errors[name]?.message} />
    </div>
  );

  return (
    <Modal
      title={client ? `Edit ${client.name}` : 'Add client'}
      sub="Shipping client details used on shipments, debit notes and tax invoices."
      onClose={onClose}
      width={760}
    >
      <ErrorBanner error={save.error} />
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="form-fields-grid">
          {field('code', 'Client code', { placeholder: 'e.g. JR' })}
          {field('name', 'Company name', { span: 2 })}
          <div className="form-field-group">
            <label htmlFor="cl-status">Status</label>
            <select id="cl-status" className="form-select-box" {...register('status')}>
              {CLIENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          {field('legalName', 'Legal name (English)', {
            span: 2,
            placeholder: 'e.g. JR APPAREL (CAMBODIA) CO., LTD',
          })}
          {field('legalNameKm', 'Legal name (Khmer)', { span: 2 })}
          <div className="form-field-group">
            <label htmlFor="cl-country">Country</label>
            <select id="cl-country" className="form-select-box" {...register('countryIso2')}>
              {lookups.data?.countries.map((c) => (
                <option key={c.iso2} value={c.iso2}>
                  {c.name}
                </option>
              ))}
            </select>
            <FieldError message={errors.countryIso2?.message} />
          </div>
          {field('vattin', 'VATTIN')}
          {field('commissionUsd', 'Commission per declaration (USD)')}
          <div className="form-field-group" style={{ alignSelf: 'end' }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
              “CM” in the monthly ledger. JR is $0, other clients $50.
            </span>
          </div>
          {field('address', 'Address', { span: 4 })}
          {field('contactName', 'Contact person')}
          {field('contactEmail', 'Contact email', { type: 'email' })}
          {field('contactPhone', 'Contact phone')}
        </div>
        <div className={ui.actions}>
          <button type="button" className="btn-cancel-shipment" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-create-submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : client ? 'Save changes' : 'Add client'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
