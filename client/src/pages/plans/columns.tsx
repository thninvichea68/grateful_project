import type { ReactNode } from 'react';
import type { ShipmentListItem } from '@gs/shared';
import { fmtDate, fmtNum } from '../../lib/format';
import s from './PlansTable.module.css';

export interface PlanColumn {
  key: string;
  label: string;
  render: (r: ShipmentListItem) => ReactNode;
}

const dash = (v: ReactNode) => (v === null || v === undefined || v === '' ? '-' : v);
const qty = (r: ShipmentListItem) =>
  r.quantity ? `${fmtNum(r.quantity)} ${r.quantityUnit ?? ''}`.trim() : '-';

/** First item, plus a "+N" chip listing the rest on hover. */
function firstPlus(items: string[]): ReactNode {
  if (!items.length) return '-';
  if (items.length === 1) return items[0];
  return (
    <>
      {items[0]}
      <span className={s.more} title={items.join('\n')}>
        +{items.length - 1}
      </span>
    </>
  );
}

/**
 * The Shipping Plans columns: one plain value per cell, in the order the team reads a plan —
 * BL, invoice, quantity, forwarder, then the three dates. Everything else is in the shipment
 * itself and in Export Excel.
 */
export const baseColumns = (direction: 'IMPORT' | 'EXPORT'): PlanColumn[] => [
  {
    key: 'hbl',
    // The house bill: HBL by sea, HAWB by air, waybill by truck.
    label: 'BL No.',
    render: (r) => (
      <span className={s.bill} title={`${r.clientName} · ${r.reference}`}>
        {dash(r.hblNo)}
        {r.isUrgent && <span className={s.urgent}>Urgent</span>}
      </span>
    ),
  },
  { key: 'invoice', label: 'Invoice No.', render: (r) => firstPlus(r.invoiceNos) },
  { key: 'qty', label: 'Qty', render: qty },
  {
    key: 'fwd',
    label: 'F.W',
    render: (r) => (
      <span className={s.clip} title={r.forwarderName ?? undefined}>
        {dash(r.forwarderName)}
      </span>
    ),
  },
  direction === 'EXPORT'
    ? { key: 'etd', label: 'ETD', render: (r) => fmtDate(r.etd) }
    : { key: 'eta', label: 'ETA', render: (r) => fmtDate(r.ata ?? r.eta) },
  // Customs clearance (declaration) date: the order the plan is listed in by default.
  {
    key: 'clearanceDate',
    label: 'Clear Date',
    render: (r) => fmtDate(r.declarations[0]?.declareDate),
  },
  direction === 'EXPORT'
    ? { key: 'atd', label: 'Departed', render: (r) => fmtDate(r.atd) }
    : { key: 'arriveFty', label: 'Arrive Factory', render: (r) => fmtDate(r.arriveFty) },
];
