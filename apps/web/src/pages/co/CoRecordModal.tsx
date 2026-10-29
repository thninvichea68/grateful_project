import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import {
  CO_STATUS_LABEL,
  CO_STATUSES,
  coRecordInputSchema,
  type CoRecordInput,
  type CoRow,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useSaveCoRecord } from '../../features/co';
import { ErrorBanner, FieldError, Modal, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { fmtDate, fmtMoney, fmtNum } from '../../lib/format';
import { formResolver } from '../../lib/zodForm';

/** CO Plans → a row: its CO form, number and date, status and remark (shipments:write). */
export function CoRecordModal({ row, onClose }: { row: CoRow; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const save = useSaveCoRecord();
  const editable = can('shipments:write');
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CoRecordInput>({
    resolver: formResolver(coRecordInputSchema),
    defaultValues: {
      form: row.form ?? '',
      coNo: row.coNo ?? '',
      coDate: row.coDate ?? '',
      status: row.status,
      remark: row.remark ?? '',
    },
  });

  const onSubmit = handleSubmit(async (v) => {
    await save.mutateAsync({ invoiceId: row.invoiceId, body: v });
    toast('CO saved.');
    onClose();
  });

  const field = (
    name: keyof CoRecordInput,
    label: string,
    opts: { span?: number; type?: 'date'; placeholder?: string } = {},
  ) => (
    <div
      className="form-field-group"
      style={opts.span ? { gridColumn: `span ${opts.span}` } : undefined}
    >
      <label htmlFor={`co-${name}`}>{label}</label>
      <input
        id={`co-${name}`}
        className="form-field-box"
        type={opts.type ?? 'text'}
        placeholder={opts.placeholder}
        {...register(name)}
        readOnly={!editable}
        aria-invalid={!!errors[name]}
      />
      <FieldError message={errors[name]?.message} />
    </div>
  );

  return (
    <Modal
      title={`CO · ${row.invoiceNo}`}
      width={760}
      onClose={onClose}
      sub={
        <>
          <Link
            to={`/plans/${row.shipmentId}`}
            onClick={onClose}
            style={{ color: 'var(--accent-primary)', fontWeight: 700 }}
          >
            {row.reference}
          </Link>{' '}
          · {row.clientName} · {row.mode} to {row.country ?? '-'} · {fmtNum(row.pcs, 0)} pcs ·{' '}
          {fmtNum(row.ctns, 0)} ctns · {fmtMoney(row.amount)} · ATD {fmtDate(row.atd)}
        </>
      }
    >
      <ErrorBanner error={save.error} />
      {!row.saved && row.shipmentCoNo && !row.coNo && (
        <div className={ui.notice} style={{ marginBottom: 12 }}>
          The shipment’s CO numbers: {row.shipmentCoNo}. Type this invoice’s one below.
        </div>
      )}
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="form-fields-grid">
          {field('form', 'Form', { placeholder: 'e.g. CRF, AB' })}
          {field('coNo', 'CO no.', { span: 2, placeholder: 'e.g. KHUS2607019878' })}
          {field('coDate', 'Date CO', { type: 'date' })}
          <div className="form-field-group">
            <label htmlFor="co-status">Status</label>
            <select
              id="co-status"
              className="form-select-box"
              {...register('status')}
              disabled={!editable}
            >
              {CO_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {CO_STATUS_LABEL[v]}
                </option>
              ))}
            </select>
          </div>
          {field('remark', 'Remark', { span: 3 })}
        </div>
        <div className={ui.actions}>
          <Link
            to={`/co/breakdown?invoice=${row.invoiceId}`}
            className="btn-cancel-shipment"
            style={{ marginRight: 'auto', textDecoration: 'none' }}
          >
            {row.hasBreakdown ? 'Open breakdown' : 'Make breakdown'}
          </Link>
          <button type="button" className="btn-cancel-shipment" onClick={onClose}>
            {editable ? 'Cancel' : 'Close'}
          </button>
          {editable && (
            <button type="submit" className="btn-create-submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
