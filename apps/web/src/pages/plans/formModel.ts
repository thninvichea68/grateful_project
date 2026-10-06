import type { Direction, ShipmentDetail, ShipmentInput } from '@gs/shared';

export type FormValues = ShipmentInput;
export type InvoiceValues = NonNullable<FormValues['invoices']>[number];
export type LineValues = InvoiceValues['lines'][number];
export type DeclValues = NonNullable<FormValues['declarations']>[number];

export const blankLine = (): LineValues => ({
  poNo: '',
  styleNo: '',
  htsCode: '',
  pcs: '',
  ctns: '',
  cbm: '',
  netWeightKg: '',
  grossWeightKg: '',
  fobUnitPrice: '',
  description: '',
});
export const blankInvoice = (invoiceDate = ''): InvoiceValues => ({
  invoiceNo: '',
  invoiceDate,
  description: '',
  lines: [blankLine()],
});
export const blankDeclaration = (portId = ''): DeclValues => ({
  id: '',
  declareNo: '',
  declareDate: '',
  portId,
  notes: '',
  cdcLines: [],
});

export function emptyForm(direction: Direction, clientId = ''): FormValues {
  return {
    clientId,
    direction,
    transportMode: 'SEA',
    loadType: 'FCL',
    status: 'PENDING',
    clearanceStatus: 'PENDING',
    shipperName: '',
    consigneeId: '',
    forwarderId: '',
    broker: '',
    clearancePortId: '',
    originCountryIso2: '',
    destinationCountryIso2: '',
    etdPort: '',
    quantity: '',
    quantityUnit: direction === 'EXPORT' ? 'CTNS' : '',
    material: direction === 'EXPORT' ? 'Garments' : '',
    bookingNo: '',
    hblNo: '',
    vesselName: '',
    voyageNo: '',
    crd: '',
    etd: '',
    atd: '',
    eta: '',
    ata: '',
    arriveFty: '',
    thcHblNo: '',
    thcHblDate: '',
    thcHblAmount: '',
    coForm: '',
    coNumber: '',
    coStatus: '',
    remark: '',
    containers: [],
    invoices: [blankInvoice()],
    declarations: [],
  };
}

const s = (v: string | null | undefined) => v ?? '';

export function fromDetail(d: ShipmentDetail): FormValues {
  return {
    clientId: d.clientId,
    direction: d.direction,
    transportMode: d.transportMode,
    loadType: d.loadType,
    status: d.status,
    clearanceStatus: d.clearanceStatus,
    shipperName: s(d.shipperName),
    consigneeId: s(d.consigneeId),
    forwarderId: s(d.forwarderId),
    broker: s(d.broker),
    clearancePortId: s(d.clearancePortId),
    originCountryIso2: s(d.originCountryIso2),
    destinationCountryIso2: s(d.destinationCountryIso2),
    etdPort: s(d.etdPort),
    quantity: s(d.quantity && String(Number(d.quantity))),
    quantityUnit: s(d.quantityUnit),
    material: s(d.material),
    bookingNo: s(d.bookingNo),
    hblNo: s(d.hblNo),
    vesselName: s(d.vesselName),
    voyageNo: s(d.voyageNo),
    crd: s(d.crd),
    etd: s(d.etd),
    atd: s(d.atd),
    eta: s(d.eta),
    ata: s(d.ata),
    arriveFty: s(d.arriveFty),
    thcHblNo: s(d.thcHblNo),
    thcHblDate: s(d.thcHblDate),
    thcHblAmount: s(d.thcHblAmount),
    coForm: s(d.coForm),
    coNumber: s(d.coNumber),
    coStatus: s(d.coStatus),
    remark: s(d.remark),
    containers: d.containers.map((c) => ({
      containerNo: c.containerNo,
      size: c.size,
      linerSeal: s(c.linerSeal),
      customsSeal: s(c.customsSeal),
    })),
    invoices: d.invoices.length
      ? d.invoices.map((i) => ({
          invoiceNo: i.invoiceNo,
          invoiceDate: s(i.invoiceDate),
          description: s(i.description),
          lines: i.lines.map((l) => ({
            poNo: s(l.poNo),
            styleNo: s(l.styleNo),
            htsCode: s(l.htsCode),
            pcs: num(l.pcs),
            ctns: num(l.ctns),
            cbm: num(l.cbm),
            netWeightKg: num(l.netWeightKg),
            grossWeightKg: num(l.grossWeightKg),
            fobUnitPrice: num(l.fobUnitPrice),
            description: s(l.description),
          })),
        }))
      : [blankInvoice()],
    declarations: d.declarations.map((x) => ({
      id: x.id,
      declareNo: x.declareNo,
      declareDate: x.declareDate,
      portId: s(x.portId),
      notes: s(x.notes),
      cdcLines: x.cdcLines.map((c) => ({
        cutStockItemId: c.cutStockItemId,
        qty: num(c.qty),
        unitPrice: num(c.unitPrice),
        netWeightKg: num(c.netWeightKg),
        overrideReason: s(c.overrideReason),
      })),
    })),
  };
}

/** "1234.000" → "1234"; keeps the user's precision when editing. */
function num(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : v;
}

/** Drop invoices the user never filled in, so an untouched blank card doesn't fail validation. */
export function cleanForSubmit(v: FormValues): FormValues {
  const lineFilled = (l: LineValues) =>
    Object.values(l).some((x) => x !== '' && x !== null && x !== undefined);
  return {
    ...v,
    containers: v.loadType === 'FCL' ? v.containers : [],
    invoices: (v.invoices ?? [])
      .filter((i) => i.invoiceNo || i.lines.some(lineFilled))
      .map((i) => ({ ...i, lines: i.lines.filter(lineFilled) })),
    declarations: (v.declarations ?? []).map((d) => ({
      ...d,
      cdcLines: v.direction === 'IMPORT' ? d.cdcLines : [],
    })),
  };
}

export const toNum = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
