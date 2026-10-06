import { sql } from 'drizzle-orm';
import type { BillingDocType } from '@gs/shared';
import { db } from '../../db/client';
import { notFound } from '../../lib/errors';
import { queryRows } from '../../lib/listing';

interface Ctx {
  recordId: string;
  clientId: string;
  invDate: string;
  exchangeRate: string;
  invNo: string | null;
  disNo: string | null;
  dnNo: string | null;
  clearFee: string;
  thc: string;
  otherPay: string;
  invRevenue: string;
  disTotal: string;
  dnTotal: string;
  declareNo: string;
  direction: 'IMPORT' | 'EXPORT';
  transportMode: string;
  loadType: string;
  forwarderId: string | null;
  portId: string | null;
  portName: string | null;
  originName: string | null;
  destinationName: string | null;
  clientName: string;
  legalName: string | null;
  legalNameKm: string | null;
  address: string | null;
  vattin: string | null;
  shipper: string | null;
  consignee: string | null;
  hbl: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  containers: string | null;
  containerSize: string | null;
  cbm: string;
  gw: string;
  ctns: string;
}

const n = (v: string | null | undefined) =>
  v === null || v === undefined ? '' : String(Number(v));

/** A ready-to-edit draft for a document type, built from a ledger row and its shipment. */
export async function prefill(
  type: BillingDocType,
  recordId: string,
): Promise<Record<string, unknown>> {
  const [c] = await queryRows<Ctx>(
    db,
    sql`
    SELECT a.id AS "recordId", a.client_id AS "clientId", to_char(a.inv_date, 'YYYY-MM-DD') AS "invDate", a.exchange_rate::text AS "exchangeRate",
           a.inv_no AS "invNo", a.dis_no AS "disNo", a.dn_no AS "dnNo", a.clear_fee::text AS "clearFee", a.thc::text AS thc,
           a.other_pay::text AS "otherPay", a.inv_revenue::text AS "invRevenue", a.dis_total::text AS "disTotal", a.dn_total::text AS "dnTotal",
           d.declare_no AS "declareNo", s.direction, s.transport_mode AS "transportMode", s.load_type AS "loadType", s.forwarder_id AS "forwarderId",
           coalesce(d.port_id, s.clearance_port_id) AS "portId", p.name AS "portName", oc.name AS "originName", dc.name AS "destinationName",
           c.name AS "clientName", c.legal_name AS "legalName", c.legal_name_km AS "legalNameKm", c.address, c.vattin,
           s.shipper_name AS shipper, cn.name AS consignee, s.hbl_no AS hbl, s.quantity::text AS quantity, s.quantity_unit AS "quantityUnit",
           (SELECT string_agg(container_no, ', ' ORDER BY sort_order) FROM containers WHERE shipment_id = s.id) AS containers,
           (SELECT size::text FROM containers WHERE shipment_id = s.id ORDER BY sort_order LIMIT 1) AS "containerSize",
           coalesce((SELECT sum(l.cbm) FROM cargo_invoice_lines l JOIN cargo_invoices ci ON ci.id = l.invoice_id WHERE ci.shipment_id = s.id), 0)::text AS cbm,
           coalesce((SELECT sum(l.gross_weight_kg) FROM cargo_invoice_lines l JOIN cargo_invoices ci ON ci.id = l.invoice_id WHERE ci.shipment_id = s.id), 0)::text AS gw,
           coalesce((SELECT sum(l.ctns) FROM cargo_invoice_lines l JOIN cargo_invoices ci ON ci.id = l.invoice_id WHERE ci.shipment_id = s.id), 0)::text AS ctns
    FROM accounting_records a
    JOIN customs_declarations d ON d.id = a.declaration_id JOIN shipments s ON s.id = d.shipment_id JOIN clients c ON c.id = a.client_id
    LEFT JOIN ports p ON p.id = coalesce(d.port_id, s.clearance_port_id) LEFT JOIN consignees cn ON cn.id = s.consignee_id
    LEFT JOIN countries oc ON oc.iso2 = s.origin_country_iso2 LEFT JOIN countries dc ON dc.iso2 = s.destination_country_iso2
    WHERE a.id = ${recordId}`,
  );
  if (!c) throw notFound('Ledger entry');

  const isImport = c.direction === 'IMPORT';
  const ship = {
    pol: isImport ? c.originName : c.portName,
    pod: isImport ? c.portName : c.destinationName,
    containerNo: c.containers,
    volumeCbm: n(c.cbm),
    grossWeightKg: n(c.gw),
    shipper: c.shipper,
    consignee: c.consignee,
    hbl: c.hbl ?? 'NON',
    pkgs: Number(c.ctns)
      ? `${n(c.ctns)} CTNS`
      : c.quantity
        ? `${n(c.quantity)} ${c.quantityUnit ?? ''}`.trim()
        : null,
  };
  const customer = {
    customerNameEn: (c.legalName ?? c.clientName).toUpperCase(),
    customerNameKm: c.legalNameKm,
    customerAddress: c.address,
    customerVattin: c.vattin,
  };
  const base = { accountingRecordId: c.recordId, clientId: c.clientId };
  const line = (description: string, price: string, unit = 'SHIP') => ({
    description,
    qty: '1',
    unit,
    unitPrice: n(price) || '0',
    mark: '',
  });
  const fee = isImport
    ? 'កំរៃសេវាបំពេញបែបបទនាំចូល / IMPORT PROCESSING FEE'
    : 'កំរៃសេវាបំពេញបែបបទនាំចេញ / EXPORT PROCESSING FEE';

  switch (type) {
    case 'tax-invoices':
      return {
        ...base,
        ...customer,
        ...ship,
        invoiceDate: c.invDate,
        exchangeRate: c.exchangeRate,
        lines: [line(fee, c.invRevenue)],
      };
    case 'disbursements':
      return {
        ...base,
        ...customer,
        ...ship,
        disDate: c.invDate,
        exchangeRate: c.exchangeRate,
        reference: c.declareNo,
        lines: [line('CUSTOMS PROCESSING FEE (as per receipt)', c.disTotal)],
      };
    case 'debit-notes':
      return {
        ...base,
        ...ship,
        dnDate: c.invDate,
        billTo: customer.customerNameEn,
        address: c.address,
        reference: c.declareNo,
        lines: [line('CLEARANCE, TRUCKING & HANDLING CHARGES', c.dnTotal)],
      };
    case 'credit-notes':
      return {
        ...base,
        cnDate: c.invDate,
        billTo: customer.customerNameEn,
        address: c.address,
        shipper: c.shipper,
        portId: c.portId,
        containerNo: c.containers,
        refType: 'HOUSE_BILL',
        refNo: c.hbl,
        quantityText: ship.pkgs,
        grossWeightKg: n(c.gw),
        cbm: n(c.cbm),
        declareNo: c.declareNo,
        lines: [
          line('CLEAR FEE', c.clearFee),
          ...(Number(c.thc) ? [line('THC FEE', c.thc)] : []),
          ...(Number(c.otherPay) ? [line('OTHER PAYMENT', c.otherPay)] : []),
        ],
      };
    case 'record-summaries':
      return {
        ...base,
        direction: c.direction,
        transportMode: c.transportMode,
        loadType: c.loadType,
        invNo: c.invNo,
        disNo: c.disNo,
        dnNo: c.dnNo,
        forwarderId: c.forwarderId,
        portId: c.portId,
        declareNo: c.declareNo,
        summaryDate: c.invDate,
        quantityText: ship.pkgs,
        blNo: c.hbl,
        containerNo: c.containers,
        containerSize: c.containerSize,
        grossWeightKg: n(c.gw),
        cbm: n(c.cbm),
        lines: [
          line('INVOICE (SERVICE FEE)', c.invRevenue),
          line('DISBURSEMENT', c.disTotal),
          line('DEBIT NOTE', c.dnTotal),
        ],
      };
  }
}
