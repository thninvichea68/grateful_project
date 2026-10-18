import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { companySchema, type CompanyInput } from '@gs/shared';
import { useApiMutation } from '../../features/admin';
import { ErrorBanner, FieldError } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { formResolver } from '../../lib/zodForm';
import s from './CompanyForm.module.css';

/**
 * Settings → Company: the details printed on tax invoices, disbursements and other documents,
 * in three sections (identity, address, bank), each labelled on the left with its fields on
 * the right, and one Save bar at the bottom.
 */
export function CompanyForm({
  initial,
  manage,
  invalidate,
}: {
  initial: CompanyInput;
  manage: boolean;
  invalidate: Parameters<typeof useApiMutation>[1];
}) {
  const toast = useToast();
  const save = useApiMutation(
    (v: CompanyInput) => api('/settings/company', { method: 'PUT', json: v }),
    invalidate,
  );
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<CompanyInput>({ resolver: formResolver(companySchema), defaultValues: initial });

  const field = (
    name: keyof CompanyInput,
    label: string,
    opts: { full?: boolean; multiline?: boolean; khmer?: boolean; placeholder?: string } = {},
  ) => (
    <div className={`${s.field}${opts.full ? ` ${s.full}` : ''}`}>
      <label htmlFor={`co-${name}`}>{label}</label>
      {opts.multiline ? (
        <textarea
          id={`co-${name}`}
          rows={2}
          className={`form-field-box ${s.textarea}${opts.khmer ? ` ${s.khmer}` : ''}`}
          placeholder={opts.placeholder}
          {...register(name)}
        />
      ) : (
        <input
          id={`co-${name}`}
          className={`form-field-box${opts.khmer ? ` ${s.khmer}` : ''}`}
          placeholder={opts.placeholder}
          aria-invalid={!!errors[name]}
          {...register(name)}
        />
      )}
      <FieldError message={errors[name]?.message} />
    </div>
  );
  const section = (title: string, hint: string, children: ReactNode, cols = 2) => (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <h4>{title}</h4>
        <p>{hint}</p>
      </div>
      <div className={s.fields} data-cols={cols}>
        {children}
      </div>
    </section>
  );

  return (
    <div className={s.card}>
      <header className={s.head}>
        <h3>Workspace &amp; company</h3>
        <p>Printed on tax invoices, disbursements and other documents.</p>
      </header>
      <ErrorBanner error={save.error} />
      <form
        onSubmit={(e) =>
          void handleSubmit(async (v) => {
            await save.mutateAsync(v);
            reset(v);
            toast('Company details saved.');
          })(e)
        }
        noValidate
      >
        <fieldset disabled={!manage} className={s.fieldset}>
          {section(
            'Company identity',
            'The legal name in English and Khmer, as registered, with the tax number.',
            <>
              {field('nameEn', 'Company name (English)')}
              {field('nameKm', 'ឈ្មោះក្រុមហ៊ុន (Khmer)', { khmer: true })}
              {field('vattin', 'VATTIN', { placeholder: 'e.g. K008-902404873' })}
              {field('phone', 'Phone', { placeholder: 'e.g. 098 484 414' })}
            </>,
          )}
          {section(
            'Address',
            'The registered address, shown under the company name on each document.',
            <>
              {field('addressEn', 'Address (English)', { multiline: true })}
              {field('addressKm', 'អាស័យដ្ឋាន (Khmer)', { multiline: true, khmer: true })}
            </>,
          )}
          {section(
            'Bank details',
            'Where clients pay; printed in the payment section of invoices.',
            <>
              {field('bankName', 'Bank', { placeholder: 'e.g. KB PRASAC BANK' })}
              {field('bankAccountName', 'Account name')}
              {field('bankAccountNo', 'Account no.', { placeholder: 'e.g. 033 754 230 001' })}
            </>,
            3,
          )}
        </fieldset>
        {manage && (
          <footer className={s.foot}>
            <span className={s.status} aria-live="polite">
              {isDirty ? 'Unsaved changes' : 'All changes saved'}
            </span>
            <button
              type="button"
              className="btn-cancel-shipment"
              disabled={!isDirty || save.isPending}
              onClick={() => reset()}
            >
              Discard
            </button>
            <button
              type="submit"
              className="btn-create-submit"
              disabled={!isDirty || save.isPending}
            >
              {save.isPending ? 'Saving…' : 'Save company details'}
            </button>
          </footer>
        )}
      </form>
    </div>
  );
}
