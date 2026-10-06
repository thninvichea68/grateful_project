import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link } from 'react-router-dom';
import {
  BILLING_DOC_LABEL,
  BILLING_DOC_TYPES,
  computeLedger,
  ledgerInputSchema,
  type LedgerEntryInput,
  type LedgerRow,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useDeclarationOptions, useDeleteLedger, useSaveLedger } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { ErrorBanner, FieldError, Modal, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { fmtDate, fmtMoney } from '../../lib/format';
import { formResolver } from '../../lib/zodForm';

const n = (v: string | null | undefined) =>
  v === null || v === undefined ? '' : String(Number(v));

/** Create or edit one ledger row; VAT and net profit preview with the same formulas the server uses. */
export function LedgerModal({ row, onClose }: { row: LedgerRow | null; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const lookups = useLookups();
  const save = useSaveLedger();
  const del = useDeleteLedger();
  const editable = can('accounting:write');
  const [declQ, setDeclQ] = useState('');
  const options = useDeclarationOptions(declQ, !row);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<LedgerEntryInput>({
    resolver: formResolver(ledgerInputSchema),
    defaultValues: row
      ? {
          declarationId: row.declarationId,
          invNo: row.invNo ?? '',
          disNo: row.disNo ?? '',
          dnNo: row.dnNo ?? '',
          invDate: row.invDate,
          exchangeRate: n(row.exchangeRate),
          clearFee: n(row.clearFee),
          thc: n(row.thc),
          otherPay: n(row.otherPay),
          commission: n(row.commission),
          invRevenue: n(row.invRevenue),
          disTotal: n(row.disTotal),
          dnTotal: n(row.dnTotal),
          cheaStatus: row.cheaStatus,
          mark: row.mark ?? '',
        }
      : {
          declarationId: '',
          cheaStatus: 'UNPAID',
          clearFee: '',
          thc: '',
          otherPay: '',
          invRevenue: '',
          disTotal: '',
          dnTotal: '',
          commission: '',
        },
  });
  const v = useWatch({ control });
  const pickedDecl = options.data?.find((o) => o.id === v.declarationId);
  const clientId = row?.clientId ?? pickedDecl?.clientId;
  const clientCm = lookups.data?.clients.find((c) => c.id === clientId)?.commissionUsd;
  const preview = computeLedger({
    clearFee: v.clearFee,
    thc: v.thc,
    otherPay: v.otherPay,
    commission: v.commission === '' || v.commission === undefined ? clientCm : v.commission,
    invRevenue: v.invRevenue,
    disTotal: v.disTotal,
    dnTotal: v.dnTotal,
  });

  const onSubmit = handleSubmit(async (values) => {
    if (row) {
      const { declarationId: _d, ...patch } = values;
      // Empty "auto" fields go back to their server defaults.
      for (const k of ['invDate', 'exchangeRate', 'commission'] as const)
        if (patch[k] === null || patch[k] === '') (patch as Record<string, unknown>)[k] = null;
      await save.mutateAsync({ id: row.id, body: patch });
      toast('Ledger entry saved.');
    } else {
      await save.mutateAsync({ body: values });
      toast('Ledger entry added.');
    }
    onClose();
  });

  const remove = async () => {
    if (!row || !window.confirm(`Delete the ledger entry for ${row.declareNo}?`)) return;
    await del.mutateAsync(row.id);
    toast('Ledger entry deleted.');
    onClose();
  };

  const money = (name: keyof LedgerEntryInput, label: string, hint?: string) => (
    <div className="form-field-group">
      <label htmlFor={`lg-${name}`}>{label}</label>
      <input
        id={`lg-${name}`}
        className="form-field-box"
        inputMode="decimal"
        placeholder={hint ?? '0.00'}
        readOnly={!editable}
        {...register(name)}
        aria-invalid={!!errors[name]}
      />
      <FieldError message={errors[name]?.message} />
    </div>
  );
  const text = (name: keyof LedgerEntryInput, label: string, hint?: string, type = 'text') => (
    <div className="form-field-group">
      <label htmlFor={`lg-${name}`}>{label}</label>
      <input
        id={`lg-${name}`}
        type={type}
        className="form-field-box"
        placeholder={hint ?? label}
        readOnly={!editable}
        {...register(name)}
        aria-invalid={!!errors[name]}
      />
      <FieldError message={errors[name]?.message} />
    </div>
  );

  return (
    <Modal
      width={900}
      onClose={onClose}
      title={row ? `${row.declareNo} · ${row.clientName}` : 'New ledger entry'}
      sub={
        row ? (
          <>
            Shipment{' '}
            <Link
              to={`/plans/${row.shipmentId}`}
              onClick={onClose}
              style={{ color: 'var(--accent-primary)', fontWeight: 700 }}
            >
              {row.shipmentReference}
            </Link>{' '}
            · declared {fmtDate(row.declareDate)}
          </>
        ) : (
          'One entry per customs declaration. Leave the grey “auto” fields empty to use the defaults.'
        )
      }
    >
      <ErrorBanner error={save.error ?? del.error} />
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        {!row && (
          <div className="form-fields-grid" style={{ marginBottom: 12 }}>
            <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="lg-q">Find declaration</label>
              <input
                id="lg-q"
                className="form-field-box"
                placeholder="Declare no., shipment or client code"
                value={declQ}
                onChange={(e) => setDeclQ(e.target.value)}
              />
            </div>
            <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="lg-declarationId">Declaration without a ledger entry</label>
              <select
                id="lg-declarationId"
                className="form-select-box"
                {...register('declarationId')}
                aria-invalid={!!errors.declarationId}
              >
                <option value="">
                  {options.isLoading ? 'Loading…' : options.data?.length ? 'Choose…' : 'None found'}
                </option>
                {options.data?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.declareNo} · {o.clientCode} · {fmtDate(o.declareDate)} ·{' '}
                    {o.shipmentReference}
                  </option>
                ))}
              </select>
              <FieldError message={errors.declarationId?.message} />
            </div>
          </div>
        )}
        <div className="form-section-title">Paid out</div>
        <div className="form-fields-grid">
          {money('clearFee', 'Clear fee')}
          {money('thc', 'THC')}
          {money('otherPay', 'Other pay')}
          {money(
            'commission',
            'CM (commission)',
            clientCm !== undefined ? `auto: ${fmtMoney(clientCm)}` : 'auto',
          )}
        </div>
        <div className="form-section-title" style={{ marginTop: 16 }}>
          Billed to client
        </div>
        <div className="form-fields-grid">
          {money('invRevenue', 'INV (revenue, before VAT)')}
          {money('disTotal', 'DIS (disbursement)')}
          {money('dnTotal', 'DN total')}
          <div className="form-field-group">
            <label htmlFor="lg-cheaStatus">Chea payment</label>
            <select
              id="lg-cheaStatus"
              className="form-select-box"
              disabled={!editable}
              {...register('cheaStatus')}
            >
              <option value="UNPAID">Unpaid</option>
              <option value="PAID">Paid</option>
            </select>
          </div>
        </div>
        <div className="form-section-title" style={{ marginTop: 16 }}>
          Numbers &amp; dates
        </div>
        <div className="form-fields-grid">
          {text('invNo', 'INV No.', 'Set when the tax invoice is issued')}
          {text('disNo', 'DIS No.', 'Set when issued')}
          {text('dnNo', 'DN No.', 'Set when issued')}
          {text('invDate', 'Invoice date', 'auto: next business day', 'date')}
          {text('exchangeRate', 'USD → KHR rate', 'auto: rate on invoice date')}
          {text('mark', 'Mark', 'e.g. Use 40H Truck')}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 22,
            flexWrap: 'wrap',
            marginTop: 18,
            padding: '12px 14px',
            borderRadius: 12,
            background: 'var(--bg-subtle)',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          <span>VAT 10%: {fmtMoney(preview.vat)}</span>
          <span>In: {fmtMoney(preview.totalInflow)}</span>
          <span>Out: {fmtMoney(preview.totalOutflow)}</span>
          <span
            style={{
              color:
                preview.netProfit < 0 ? 'var(--status-exception-fg)' : 'var(--status-completed-fg)',
            }}
          >
            Net profit: {fmtMoney(preview.netProfit)}
          </span>
        </div>
        {row && (
          <div style={{ marginTop: 18 }}>
            <div className="form-section-title">Documents for this declaration</div>
            <div className={ui.toolbar}>
              {row.documents.map((d) => (
                <Link
                  key={d.id}
                  to={`/accounting/${d.type}/${d.id}`}
                  className="filter-btn"
                  onClick={onClose}
                >
                  {BILLING_DOC_LABEL[d.type]} {d.number ?? ''} · {d.status.toLowerCase()}
                </Link>
              ))}
              {editable &&
                BILLING_DOC_TYPES.map((t) => (
                  <Link
                    key={t}
                    to={`/accounting/${t}/new?recordId=${row.id}`}
                    className="cargo-btn"
                    onClick={onClose}
                  >
                    + {BILLING_DOC_LABEL[t]}
                  </Link>
                ))}
            </div>
          </div>
        )}
        {editable && (
          <div className={ui.actions}>
            {row && !row.documents.some((d) => d.status === 'ISSUED') && (
              <button type="button" className="btn-delete-shipment" onClick={() => void remove()}>
                Delete entry
              </button>
            )}
            <button type="button" className="btn-cancel-shipment" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-create-submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : row ? 'Save entry' : 'Add entry'}
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
