import type { BillingDocType, LookupsResponse } from '@gs/shared';

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'date' | 'select' | 'number';
  span?: number;
  options?: (l: LookupsResponse) => { value: string; label: string }[];
  placeholder?: string;
}

const customer: FieldDef[] = [
  { name: 'customerNameEn', label: 'Customer (English)', span: 2 },
  { name: 'customerNameKm', label: 'ឈ្មោះអតិថិជន (Khmer)', span: 2 },
  { name: 'customerAddress', label: 'Address', span: 3 },
  { name: 'customerVattin', label: 'VATTIN' },
];
const ship: FieldDef[] = [
  { name: 'shipper', label: 'Shipper', span: 2 },
  { name: 'consignee', label: 'Consignee', span: 2 },
  { name: 'hbl', label: 'HBL' },
  { name: 'pkgs', label: 'PKGS', placeholder: 'e.g. 978 CTNS' },
  { name: 'grossWeightKg', label: 'Gross weight (kg)', type: 'number' },
  { name: 'volumeCbm', label: 'Volume (CBM)', type: 'number' },
  { name: 'containerNo', label: 'Container No.', span: 2 },
  { name: 'pol', label: 'POL' },
  { name: 'pod', label: 'POD' },
];
const ports = (l: LookupsResponse) =>
  l.ports.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }));

export const DOC_CONFIG: Record<
  BillingDocType,
  {
    numberField: string | null;
    dateField: string;
    title: string;
    fields: FieldDef[];
    tax: boolean;
    khr: boolean;
  }
> = {
  'tax-invoices': {
    numberField: 'invoiceNo',
    dateField: 'invoiceDate',
    title: 'Tax Invoice',
    tax: true,
    khr: true,
    fields: [
      { name: 'invoiceNo', label: 'Invoice No.', placeholder: 'auto: GS26-###' },
      { name: 'invoiceDate', label: 'Invoice date', type: 'date' },
      { name: 'exchangeRate', label: '1 USD = KHR', type: 'number' },
      ...customer,
      ...ship,
    ],
  },
  disbursements: {
    numberField: 'disNo',
    dateField: 'disDate',
    title: 'Disbursement',
    tax: false,
    khr: true,
    fields: [
      { name: 'disNo', label: 'DIS No.', placeholder: 'auto: DIS###' },
      { name: 'disDate', label: 'Date', type: 'date' },
      { name: 'exchangeRate', label: '1 USD = KHR', type: 'number' },
      { name: 'reference', label: 'Reference' },
      ...customer,
      ...ship,
    ],
  },
  'debit-notes': {
    numberField: 'dnNo',
    dateField: 'dnDate',
    title: 'Debit Note',
    tax: false,
    khr: false,
    fields: [
      { name: 'dnNo', label: 'DN No.', placeholder: 'auto: JR2608###' },
      { name: 'dnDate', label: 'Date', type: 'date' },
      { name: 'billTo', label: 'Customer', span: 2 },
      { name: 'address', label: 'Address', span: 3 },
      { name: 'reference', label: 'Reference' },
      ...ship,
    ],
  },
  'credit-notes': {
    numberField: 'cnNo',
    dateField: 'cnDate',
    title: 'Credit Noted',
    tax: false,
    khr: false,
    fields: [
      { name: 'cnNo', label: 'CN No.', placeholder: 'auto: CN26-###' },
      { name: 'cnDate', label: 'Date', type: 'date' },
      { name: 'billTo', label: 'Bill to', span: 2 },
      { name: 'address', label: 'Address', span: 2 },
      { name: 'shipper', label: 'Shipper', span: 2 },
      { name: 'portId', label: 'Port', type: 'select', options: ports },
      { name: 'containerNo', label: 'Container No.' },
      { name: 'declareNo', label: 'Declare No.' },
      {
        name: 'refType',
        label: 'Ref type',
        type: 'select',
        options: () => [
          { value: 'HOUSE_BILL', label: 'House bill' },
          { value: 'BILL_NO', label: 'Bill no.' },
          { value: 'HAWB_NO', label: 'HAWB no.' },
        ],
      },
      { name: 'refNo', label: 'Ref number' },
      { name: 'quantityText', label: 'Qty / unit' },
      { name: 'grossWeightKg', label: 'Gross weight (kg)', type: 'number' },
      { name: 'cbm', label: 'CBM', type: 'number' },
    ],
  },
  'record-summaries': {
    numberField: null,
    dateField: 'summaryDate',
    title: 'Record Summary',
    tax: false,
    khr: false,
    fields: [
      { name: 'summaryDate', label: 'Date', type: 'date' },
      {
        name: 'direction',
        label: 'Shipment',
        type: 'select',
        options: () => [
          { value: 'IMPORT', label: 'IMPORT' },
          { value: 'EXPORT', label: 'EXPORT' },
        ],
      },
      {
        name: 'transportMode',
        label: 'Mode',
        type: 'select',
        options: () => ['SEA', 'AIR', 'ROAD', 'RAIL'].map((v) => ({ value: v, label: v })),
      },
      {
        name: 'loadType',
        label: 'Load',
        type: 'select',
        options: () => [
          { value: 'FCL', label: 'CY/CY' },
          { value: 'LCL', label: 'LCL' },
          { value: 'NONE', label: '—' },
        ],
      },
      { name: 'invNo', label: 'Invoice No.' },
      { name: 'disNo', label: 'Disbursement No.' },
      { name: 'dnNo', label: 'Debit note No.' },
      { name: 'declareNo', label: 'Declare No.' },
      {
        name: 'forwarderId',
        label: 'Forwarder',
        type: 'select',
        options: (l) => l.forwarders.map((f) => ({ value: f.id, label: f.name })),
      },
      { name: 'portId', label: 'Port', type: 'select', options: ports },
      { name: 'quantityText', label: 'Quantity' },
      { name: 'blNo', label: 'BL No.' },
      { name: 'containerNo', label: 'Container No.' },
      {
        name: 'containerSize',
        label: 'Size',
        type: 'select',
        options: () => ['20GP', '40GP', '40HQ', '45HQ'].map((v) => ({ value: v, label: v })),
      },
      { name: 'grossWeightKg', label: 'Gross weight (kg)', type: 'number' },
      { name: 'cbm', label: 'CBM', type: 'number' },
    ],
  },
};
