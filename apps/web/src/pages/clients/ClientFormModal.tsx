import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { formResolver } from '../../lib/zodForm';
import {
  CLIENT_STATUSES,
  clientInputSchema,
  type ClientDetail,
  type ClientInput,
} from '@gs/shared';
import { useLookups, useSaveClient } from '../../features/hooks';
import { ErrorBanner, FieldError, Modal } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { useToast } from '../../components/Toast';
import { InfoTip } from '../../components/InfoTip';
import { fi, type FormIcon } from '../plans/formIcons';
import s from './ClientFormModal.module.css';

const STATUS_LABEL = { ACTIVE: 'Active', ONBOARDING: 'Onboarding', INACTIVE: 'Inactive' } as const;

/**
 * Add / edit a shipping client, laid out like Settings → Company: side-by-side columns
 * (company, tax & address, contact + CDC licence), each under an icon title with its
 * description in the "?".
 */
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
          addressKm: client.addressKm ?? '',
          vattin: client.vattin ?? '',
          contactName: client.contactName ?? '',
          contactEmail: client.contactEmail ?? '',
          contactPhone: client.contactPhone ?? '',
          cdcNo: client.cdcNo ?? '',
          cdcIssueDate: client.cdcIssueDate ?? '',
          commissionUsd: client.commissionUsd,
          thcBilledApart: client.thcBilledApart,
          status: client.status,
        }
      : { countryIso2: 'KH', commissionUsd: '50.00', thcBilledApart: true, status: 'ACTIVE' },
  });

  const onSubmit = handleSubmit(async (values) => {
    const res = await save.mutateAsync({ id: client?.id, body: values });
    toast(client ? 'Client updated.' : 'Client added.');
    onSaved?.(res.id);
    onClose();
  });

  const box = (name: keyof ClientInput, label: string, control: ReactNode, span = 1) => (
    <div className={s.field} data-span={span}>
      <label htmlFor={`cl-${name}`}>{label}</label>
      {control}
      <FieldError message={errors[name]?.message} />
    </div>
  );
  const field = (
    name: keyof ClientInput,
    label: string,
    opts: {
      span?: number;
      type?: string;
      placeholder?: string;
      decimals?: number;
      khmer?: boolean;
      multiline?: boolean;
    } = {},
  ) =>
    box(
      name,
      label,
      opts.decimals !== undefined ? (
        <NumberInput
          id={`cl-${name}`}
          className="form-field-box"
          decimals={opts.decimals}
          placeholder={opts.placeholder}
          {...register(name)}
          aria-invalid={!!errors[name]}
        />
      ) : opts.multiline ? (
        <textarea
          id={`cl-${name}`}
          rows={2}
          className={`form-field-box ${s.textarea}${opts.khmer ? ` ${s.khmer}` : ''}`}
          placeholder={opts.placeholder}
          {...register(name)}
          aria-invalid={!!errors[name]}
        />
      ) : (
        <input
          id={`cl-${name}`}
          className={`form-field-box${opts.khmer ? ` ${s.khmer}` : ''}`}
          type={opts.type ?? 'text'}
          placeholder={opts.placeholder}
          {...register(name)}
          aria-invalid={!!errors[name]}
        />
      ),
      opts.span,
    );
  const section = (icon: FormIcon, title: string, hint: string, children: ReactNode) => (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <h4>
          <span className={`cx-title-icon ${s.sectionIcon}`}>
            {fi[icon]({ width: 16, height: 16 })}
          </span>
          {title}
        </h4>
        <InfoTip label={`About ${title.toLowerCase()}`} symbol="?" align="end">
          {hint}
        </InfoTip>
      </div>
      <div className={s.fields}>{children}</div>
    </section>
  );

  return (
    <Modal
      title={client ? `Edit ${client.name}` : 'Add client'}
      sub="Shipping client details used on shipments, debit notes and tax invoices."
      onClose={onClose}
      width={1240}
    >
      <ErrorBanner error={save.error} />
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className={s.columns}>
          {section(
            'building',
            'Company',
            'The short code used across the system, and the legal names printed on documents.',
            <>
              {field('code', 'Client code', { placeholder: 'e.g. JR' })}
              {box(
                'status',
                'Status',
                <select id="cl-status" className="form-select-box" {...register('status')}>
                  {CLIENT_STATUSES.map((v) => (
                    <option key={v} value={v}>
                      {STATUS_LABEL[v]}
                    </option>
                  ))}
                </select>,
              )}
              {field('name', 'Company name', { span: 2, placeholder: 'e.g. JR APPAREL' })}
              {field('legalName', 'Legal name (English)', {
                span: 2,
                placeholder: 'e.g. JR APPAREL (CAMBODIA) CO., LTD',
              })}
              {field('legalNameKm', 'Legal name (Khmer)', { span: 2, khmer: true })}
            </>,
          )}
          {section(
            'pin',
            'Tax & address',
            'Printed on tax invoices and debit notes; the commission is charged per declaration.',
            <>
              {box(
                'countryIso2',
                'Country',
                <select
                  id="cl-countryIso2"
                  className="form-select-box"
                  {...register('countryIso2')}
                >
                  {lookups.data?.countries.map((c) => (
                    <option key={c.iso2} value={c.iso2}>
                      {c.name}
                    </option>
                  ))}
                </select>,
              )}
              {field('commissionUsd', 'Commission (USD)', { decimals: 2, placeholder: '0.00' })}
              {box(
                'thcBilledApart',
                'THC / agency invoice',
                <select
                  id="cl-thcBilledApart"
                  className="form-select-box"
                  {...register('thcBilledApart', { setValueAs: (v) => v === true || v === 'true' })}
                >
                  <option value="true">Bill in the month paid (own DIS)</option>
                  <option value="false">Bill with services (declare month)</option>
                </select>,
                2,
              )}
              {field('vattin', 'VATTIN', { span: 2, placeholder: 'e.g. L001-902501613' })}
              {field('address', 'Address (English)', { span: 2, multiline: true })}
              {field('addressKm', 'អាស័យដ្ឋាន (Khmer)', { span: 2, multiline: true, khmer: true })}
            </>,
          )}
          <div className={s.stack}>
            {section(
              'user',
              'Contact',
              'Who to reach at the client about shipments and invoices.',
              <>
                {field('contactName', 'Contact person', { span: 2 })}
                {field('contactEmail', 'Contact email', {
                  span: 2,
                  type: 'email',
                  placeholder: 'name@company.com',
                })}
                {field('contactPhone', 'Contact phone', {
                  span: 2,
                  placeholder: 'e.g. +855 85 441 621',
                })}
              </>,
            )}
            {section(
              'badge',
              'CDC licence',
              'The client’s entry on the QIP master list (CDC Master List).',
              <>
                {field('cdcNo', 'CDC no. (QIP master list)', {
                  span: 2,
                  placeholder: 'e.g. QIP25021226-C01996',
                })}
                {field('cdcIssueDate', 'CDC issue date', { span: 2, type: 'date' })}
              </>,
            )}
          </div>
        </div>
        <footer className={s.foot}>
          <button type="button" className="btn-cancel-shipment" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-create-submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : client ? 'Save changes' : 'Add client'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
