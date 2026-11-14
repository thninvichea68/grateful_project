import { useState } from 'react';
import { ErrorBanner, Modal, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useDeleteInvoice } from '../../features/accounting';

const ONE_LABEL = {
  'tax-invoices': 'Tax invoice',
  disbursements: 'Disbursement',
  'debit-notes': 'Debit note',
} as const;

/**
 * Confirms deleting a shipment's invoice set (tax invoice, DIS, debit note). Its numbers are
 * released to the next approved shipment, it goes back to "not invoiced" and its Chea payment
 * back to Unchecked. A reason is required and kept in the audit history.
 */
export function DeleteInvoiceDialog({
  recordId,
  declareNo,
  numbers,
  type,
  onClose,
  onDeleted,
}: {
  recordId: string;
  declareNo: string;
  /** Delete this one document (e.g. only the tax invoice); the whole set when left out. */
  type?: 'tax-invoices' | 'disbursements' | 'debit-notes';
  /** The numbers on the shipment now, e.g. ['GS26-394', 'DIS437', 'JR2610001']. */
  numbers: string[];
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const toast = useToast();
  const del = useDeleteInvoice();
  const [reason, setReason] = useState('');
  const canDelete = reason.trim().length >= 3 && !del.isPending;

  const what = type ? ONE_LABEL[type] : 'Invoice';
  const run = async () => {
    const res = await del.mutateAsync({ recordId, reason: reason.trim(), type });
    const kept = res.released.filter((r) => r.kept).map((r) => r.number);
    const passed = res.reassigned.map(
      (r) => `${r.numbers.map((n) => n.number).join(' · ')} → ${r.declareNo}`,
    );
    toast(
      [
        `${what} deleted for ${declareNo}.`,
        passed.length
          ? `Given to: ${passed.join('; ')}.`
          : kept.length
            ? `${kept.join(', ')} will go to the next approved shipment.`
            : 'The next approved shipment continues from these numbers.',
      ].join(' '),
    );
    onDeleted?.();
    onClose();
  };

  return (
    <Modal
      title={`Delete the ${what.toLowerCase()} for ${declareNo}?`}
      sub={
        type
          ? `This can't be undone. Only the ${what.toLowerCase()} is deleted; the other documents stay.`
          : "This can't be undone. The documents are deleted and the shipment is not invoiced any more."
      }
      onClose={onClose}
      width={540}
    >
      <ErrorBanner error={del.error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canDelete) void run().catch(() => undefined);
        }}
        noValidate
      >
        <ul
          className={ui.dialogSub}
          style={{ margin: '0 0 12px', paddingLeft: 18, lineHeight: 1.6 }}
        >
          <li>
            {type
              ? `Deletes its ${what.toLowerCase()}`
              : 'Deletes its tax invoice, disbursement and debit note'}
            {numbers.length ? ` (${numbers.join(', ')})` : ''}
            {type ? ' and takes its amount out of the Monthly Ledger.' : '.'}
          </li>
          <li>
            Releases the {type ? 'number' : 'numbers'}: the next approved shipment takes{' '}
            {type ? 'it' : 'them'}, so there are no gaps.
          </li>
          <li>Its Chea payment goes back to Unchecked. Check it again to give it new numbers.</li>
        </ul>
        <div className="form-field-group">
          <label htmlFor="del-inv-reason">Reason (required)</label>
          <input
            id="del-inv-reason"
            className="form-field-box"
            placeholder="e.g. Billed to the wrong client; clearance date was wrong"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button type="button" className="filter-btn" onClick={onClose}>
            Keep {what.toLowerCase()}
          </button>
          <button type="submit" className="btn-delete-shipment" disabled={!canDelete}>
            {del.isPending ? 'Deleting…' : `Delete ${what.toLowerCase()}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
