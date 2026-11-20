import { CREDIT_NOTE_QUOTATION_SECTIONS } from './creditNoteQuotationData';

export type CreditNotePortGroup = 'AIRPORT' | 'DRYPORT' | 'PNH' | 'SHV';
type Direction = 'IMPORT' | 'EXPORT';

type QuotationSection = (typeof CREDIT_NOTE_QUOTATION_SECTIONS)[number];
type QuotationRow = QuotationSection['rows'][number];

export interface CreditNoteRateContext {
  clientCode: string;
  direction: Direction;
  portGroup: CreditNotePortGroup;
  loadType: string;
  containerSize: string | null;
  grossWeightKg: string;
  cbm: string;
}

export interface CreditNoteQuotationService {
  description: string;
  unitPrice: string | null;
  unit: string | null;
  qty: string | null;
  note: string | null;
}

export function creditNotePortGroup(port: {
  code: string;
  name: string;
  shortName: string;
  kind: string;
}): CreditNotePortGroup | null {
  const label = `${port.code} ${port.name} ${port.shortName}`.toUpperCase();
  if (port.kind === 'AIR' || label.includes('AIRPORT')) return 'AIRPORT';
  if (port.kind === 'DRY' || /DRY\s*PORT|DRYPORT/.test(label)) return 'DRYPORT';
  if (/\bPNH\b|PHNOM PENH/.test(label)) return 'PNH';
  if (/\bSHV\b|SIHANOUKVILLE/.test(label)) return 'SHV';
  return null;
}

const serviceName = (value: string) => {
  const label = value.trim().toUpperCase().replace(/\s+/g, ' ');
  if (label === 'TRUCK' || label === 'TRUCK FEE') return 'TRUCKING';
  if (label === 'CUSTOMS PROCESSING FEE') return 'CUSTOM PROCESSING FEE';
  if (label === 'LOLO AT PP PORT') return 'LOLO';
  return label;
};

function clientScore(remark: string, clientCode: string): number {
  const text = remark.toUpperCase();
  const code = clientCode.toUpperCase();
  if (!text || !/(VFL|JYX|SPORTLINE|SAK|JR)/.test(text)) return 0;
  if (/SPORTLINE|SAK/.test(text)) return code === 'SAK' || code === 'JR' ? 3 : -1;
  if (/VFL\s*\/\s*JYX/.test(text)) return code === 'VFL' || code === 'JYX' ? 3 : -1;
  if (/VFL\s*\/\s*JR/.test(text)) {
    if (code === 'VFL') return 3;
    if (code === 'JYX') return 2;
    return code === 'JR' ? 1 : -1;
  }
  if (/VFL/.test(text)) return code === 'VFL' || code === 'JYX' ? 2 : -1;
  if (/JYX/.test(text)) return code === 'JYX' || code === 'VFL' ? 2 : -1;
  if (/JR/.test(text)) return code === 'JR' || code === 'SAK' ? 2 : -1;
  return 0;
}

function rateColumnIndex(section: QuotationSection, context: CreditNoteRateContext): number | null {
  const remarkIndex = section.columns.findIndex((column) => column.toUpperCase() === 'REMARK');
  const end = remarkIndex < 0 ? section.columns.length : remarkIndex;
  const columns = section.columns.slice(0, end);
  const find = (pattern: RegExp) => columns.findIndex((column) => pattern.test(column));
  if (context.loadType.toUpperCase() === 'LCL') {
    const lcl = find(/^(LCL|SHP)$/i);
    if (lcl >= 0) return lcl;
  }

  const size = /(?:^|\D)(20|40|45)(?:\D|$)/.exec(context.containerSize ?? '')?.[1];
  if (size) {
    const container = find(size === '20' ? /20/i : /40/i);
    if (container >= 0) return container;
  }

  const weightColumns = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => /(?:1\.5|2\.5|5)\s*T/i.test(column));
  if (weightColumns.length) {
    const weight = Number(context.grossWeightKg);
    if (!weight) return null;
    const label = weight <= 1500 ? /1\.5\s*T/i : weight <= 2500 ? /2\.5\s*T/i : /5\s*T/i;
    const match = weightColumns.find(({ column }) => label.test(column));
    if (match) return match.index;
  }

  const ship = find(/^SHP$/i);
  if (ship >= 0) return ship;
  const lcl = find(/^LCL$/i);
  return lcl >= 0 ? lcl : null;
}

function priceFrom(value: string): { unitPrice: string | null; unit: string | null } {
  const trimmed = value.trim();
  if (!trimmed) return { unitPrice: null, unit: null };
  const updated = /->\s*\$?\s*(\d+(?:\.\d+)?)/.exec(trimmed);
  const match =
    updated ??
    /^[$]?\s*(\d[\d,]*(?:\.\d+)?)\s*(?=$|\$|one\s+time|\/\s*[A-Z]+|PER\b)/i.exec(trimmed);
  const amount = match?.[1]?.replace(/,/g, '');
  const unit = /\/\s*CBM/i.test(trimmed) ? 'CBM' : null;
  return {
    unitPrice: amount && Number.isFinite(Number(amount)) ? String(Number(amount)) : null,
    unit,
  };
}

function rowRemark(section: QuotationSection, row: QuotationRow): string {
  const index = section.columns.findIndex((column) => column.toUpperCase() === 'REMARK');
  return index < 0 ? '' : (row.values[index] ?? '');
}

function rowNotes(section: QuotationSection, row: QuotationRow): string[] {
  const index = section.columns.findIndex((column) => column.toUpperCase() === 'REMARK');
  return index < 0
    ? []
    : row.values
        .slice(index)
        .map((value) => value.trim())
        .filter(Boolean);
}

function latestNoteRows(section: QuotationSection, rowIndex: number): string[] {
  const notes: string[] = [];
  for (let i = rowIndex + 1; i < section.rows.length; i++) {
    const row = section.rows[i]!;
    if (!/^(?:AUG|APR)\s+ONWARD\s+INCREASE$/i.test(row.service.trim())) break;
    const details = row.values.filter(Boolean).join(' — ');
    if (details) notes.push(`${row.service}: ${details}`);
  }
  return notes;
}

export function creditNoteQuotationServices(
  context: CreditNoteRateContext,
): CreditNoteQuotationService[] {
  const section = CREDIT_NOTE_QUOTATION_SECTIONS.find(
    (item) => item.direction === context.direction && item.port === context.portGroup,
  );
  if (!section) return [];

  const rateIndex = rateColumnIndex(section, context);

  const candidates = new Map<
    string,
    { service: CreditNoteQuotationService; score: number; hasRate: boolean; order: number }
  >();

  section.rows.forEach((row, order) => {
    if (/^(?:AUG|APR)\s+ONWARD\s+INCREASE$/i.test(row.service.trim())) return;
    const score = clientScore(rowRemark(section, row), context.clientCode);
    if (score < 0) return;

    const rateText = rateIndex === null ? '' : (row.values[rateIndex] ?? '');
    const parsed = priceFrom(rateText);
    const notes = [
      ...rowNotes(section, row),
      ...latestNoteRows(section, order),
      ...(rateText && parsed.unitPrice === null ? [rateText] : []),
    ];
    const description = serviceName(row.service);
    const unit = parsed.unit ?? (/PER\s*\/?\s*SET/i.test(notes.join(' ')) ? 'SET' : null);
    const service: CreditNoteQuotationService = {
      description,
      unitPrice: parsed.unitPrice,
      unit,
      qty: unit === 'CBM' ? context.cbm || '1' : null,
      note: [...new Set(notes)].join(' · ') || null,
    };
    const hasRate = !!rateText.trim();
    const current = candidates.get(description);
    if (
      !current ||
      Number(hasRate) > Number(current.hasRate) ||
      (hasRate === current.hasRate && score > current.score) ||
      (hasRate === current.hasRate && score === current.score && order > current.order)
    ) {
      candidates.set(description, { service, score, hasRate, order });
    }
  });

  section.rows.forEach((row, order) => {
    if (/^(?:AUG|APR)\s+ONWARD\s+INCREASE$/i.test(row.service.trim())) return;
    const description = serviceName(row.service);
    if (candidates.has(description)) return;
    candidates.set(description, {
      service: {
        description,
        unitPrice: null,
        unit: null,
        qty: null,
        note: 'No rate listed for this client.',
      },
      score: -1,
      hasRate: false,
      order,
    });
  });

  return [...candidates.values()].map(({ service }) => service);
}
