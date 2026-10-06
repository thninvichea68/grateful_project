import type { ReactNode } from 'react';
import { CLEARANCE_STATUS_LABEL, freightMethodLabel, type ShipmentListItem } from '@gs/shared';
import { fmtDate, fmtMoney, fmtNum } from '../../lib/format';

export interface PlanColumn {
  key: string;
  label: string;
  render: (r: ShipmentListItem) => ReactNode;
  bold?: boolean;
}

const dash = (v: ReactNode) => (v === null || v === undefined || v === '' ? '-' : v);
const qty = (r: ShipmentListItem) =>
  r.quantity ? `${fmtNum(r.quantity)} ${r.quantityUnit ?? ''}`.trim() : '-';

/** Same columns, labels and order as the prototype's plansBaseColumns. */
export const BASE_COLUMNS: PlanColumn[] = [
  {
    key: 'invoice',
    label: 'Invoice No.',
    render: (r) => dash(r.invoiceNos.join(', ')),
    bold: true,
  },
  { key: 'qty', label: 'Quantity', render: qty },
  { key: 'eta', label: 'ETA Port', render: (r) => fmtDate(r.eta) },
  { key: 'fwd', label: 'Forwarder', render: (r) => dash(r.forwarderName) },
  { key: 'clearance', label: 'Clearance Port', render: (r) => dash(r.clearancePortName) },
  { key: 'hbl', label: 'HBL No', render: (r) => dash(r.hblNo) },
  {
    key: 'ctnr',
    label: 'Ctnr No',
    render: (r) =>
      dash(r.containers.map((c) => `${c.containerNo}${c.size ? ` / ${c.size}` : ''}`).join(', ')),
  },
  {
    key: 'freight',
    label: 'Freight Method',
    render: (r) => freightMethodLabel(r.transportMode, r.loadType),
  },
];

/** The prototype's plansExpandedColumns ("Expand All"). */
export const EXPANDED_COLUMNS: PlanColumn[] = [
  { key: 'reference', label: 'Reference', render: (r) => r.reference },
  { key: 'client', label: 'Client', render: (r) => r.clientCode },
  { key: 'transport', label: 'Transport', render: (r) => r.direction },
  { key: 'consignee', label: 'Consignee', render: (r) => dash(r.consigneeName) },
  { key: 'invoiceDate', label: 'Invoice Date', render: (r) => fmtDate(r.invoiceDate) },
  { key: 'country', label: 'Country', render: (r) => dash(r.countryName) },
  { key: 'bookingNo', label: 'Booking / SO No.', render: (r) => dash(r.bookingNo) },
  {
    key: 'linerSeal',
    label: 'Liner Seal',
    render: (r) =>
      dash(
        r.containers
          .map((c) => c.linerSeal)
          .filter(Boolean)
          .join(', '),
      ),
  },
  {
    key: 'customsSeal',
    label: 'Customs Seal',
    render: (r) =>
      dash(
        r.containers
          .map((c) => c.customsSeal)
          .filter(Boolean)
          .join(', '),
      ),
  },
  { key: 'crd', label: 'CRD', render: (r) => fmtDate(r.crd) },
  { key: 'thcHblNo', label: 'THC / HBL No.', render: (r) => dash(r.thcHblNo) },
  { key: 'thcHblDate', label: 'THC / HBL Date', render: (r) => fmtDate(r.thcHblDate) },
  {
    key: 'thcHblAmount',
    label: 'THC / HBL Amount',
    render: (r) => (r.thcHblAmount ? fmtMoney(r.thcHblAmount) : '-'),
  },
  {
    key: 'clearanceStatus',
    label: 'Clearance Status',
    render: (r) => CLEARANCE_STATUS_LABEL[r.clearanceStatus],
  },
  { key: 'vessel', label: 'Vessel Name', render: (r) => dash(r.vesselName) },
  { key: 'voyage', label: 'Voyage No.', render: (r) => dash(r.voyageNo) },
  { key: 'coForm', label: 'CO Form', render: (r) => dash(r.coForm) },
  { key: 'coNumber', label: 'CO Number', render: (r) => dash(r.coNumber) },
  { key: 'coStatus', label: 'CO Status', render: (r) => dash(r.coStatus) },
  { key: 'netWeight', label: 'Net Weight', render: (r) => `${fmtNum(r.totals.netWeightKg, 2)} KG` },
  {
    key: 'grossWeight',
    label: 'Gross Weight',
    render: (r) => `${fmtNum(r.totals.grossWeightKg, 2)} KG`,
  },
  { key: 'cbm', label: 'CBM', render: (r) => fmtNum(r.totals.cbm) },
  { key: 'poNo', label: 'PO No.', render: (r) => dash(r.firstLine?.poNo) },
  { key: 'styleNo', label: 'Style No.', render: (r) => dash(r.firstLine?.styleNo) },
  { key: 'htsCode', label: 'HTS Code', render: (r) => dash(r.firstLine?.htsCode) },
  { key: 'qtyPcs', label: 'Qty (PCS)', render: (r) => fmtNum(r.totals.pcs) },
  { key: 'ctns', label: 'CTNS', render: (r) => fmtNum(r.totals.ctns) },
  {
    key: 'fobPrice',
    label: 'FOB Price',
    render: (r) => (r.firstLine?.fobUnitPrice ? `$${fmtNum(r.firstLine.fobUnitPrice, 4)}` : '-'),
  },
  { key: 'totalFob', label: 'Total FOB', render: (r) => fmtMoney(r.totals.fob) },
  {
    key: 'declareNo',
    label: 'Declare No.',
    render: (r) => dash(r.declarations.map((d) => d.declareNo).join(', ')),
  },
  {
    key: 'declareDate',
    label: 'Declare Date',
    render: (r) => fmtDate(r.declarations[0]?.declareDate),
  },
  { key: 'description', label: 'Description', render: (r) => dash(r.firstLine?.description) },
  { key: 'etdPort', label: 'ETD Port', render: (r) => dash(r.etdPort) },
  { key: 'atd', label: 'ATD Date', render: (r) => fmtDate(r.atd) },
  { key: 'remark', label: 'Remark', render: (r) => dash(r.remark) },
];
