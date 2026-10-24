/**
 * Accounting formulas ported from accounting-engine.html (`pushMonthlyRow`,
 * `renderTaxPreview`). The API calls these to compute and STORE totals; the web
 * app calls the same functions only to preview values while a form is edited.
 */
import {
  round2,
  sumMoney,
  toCents,
  fromCents,
  lineAmount,
  usdToKhr,
  toNumber,
  type Decimalish,
} from './money';

export const VAT_RATE = 0.1;

export interface LedgerInput {
  clearFee: Decimalish;
  thc: Decimalish;
  otherPay: Decimalish;
  /** "CM" — commission paid out. Comes from the client's `commission_usd` setting. */
  commission: Decimalish;
  /** "INV (REVENUE)" — service revenue on the tax invoice, before VAT. */
  invRevenue: Decimalish;
  /** "DIS" — disbursement total re-billed to the client. */
  disTotal: Decimalish;
  /** "DN TOTAL" — debit note total re-billed to the client. */
  dnTotal: Decimalish;
}

export interface LedgerTotals {
  vat: number;
  totalInflow: number;
  totalOutflow: number;
  netProfit: number;
}

/**
 * Net profit = (INV revenue + DIS + DN total) − (clear fee + THC + CM + other pay).
 * VAT 10% is computed on INV revenue but is pass-through: it is NOT part of profit.
 */
export function computeLedger(i: LedgerInput): LedgerTotals {
  const vat = round2(toNumber(i.invRevenue) * VAT_RATE);
  const inflowC = toCents(i.invRevenue) + toCents(i.disTotal) + toCents(i.dnTotal);
  const outflowC =
    toCents(i.clearFee) + toCents(i.thc) + toCents(i.commission) + toCents(i.otherPay);
  return {
    vat: fromCents(toCents(vat)),
    totalInflow: fromCents(inflowC),
    totalOutflow: fromCents(outflowC),
    netProfit: fromCents(inflowC - outflowC),
  };
}

export interface TaxLineInput {
  qty: Decimalish;
  unitPrice: Decimalish;
  /** Defaults to true. Disbursements are VAT 0%. */
  vatable?: boolean;
}

export interface TaxLineTotals {
  subtotal: number;
  vat: number;
  amount: number;
}

export function computeTaxLine(line: TaxLineInput): TaxLineTotals {
  const subtotal = lineAmount(line.qty, line.unitPrice);
  const vat = line.vatable === false ? 0 : round2(subtotal * VAT_RATE);
  return { subtotal, vat, amount: round2(subtotal + vat) };
}

export interface TaxDocumentTotals {
  subtotal: number;
  vat: number;
  total: number;
  subtotalKhr: number;
  vatKhr: number;
  totalKhr: number;
}

/**
 * Totals for a bilingual tax invoice. VAT is computed per line and summed, and the
 * KHR figures are converted from the USD totals (as in the prototype), rounded to riel.
 */
export function computeTaxDocument(
  lines: TaxLineInput[],
  exchangeRate: Decimalish,
): TaxDocumentTotals {
  const computed = lines.map(computeTaxLine);
  const subtotal = sumMoney(computed.map((l) => l.subtotal));
  const vat = sumMoney(computed.map((l) => l.vat));
  const total = round2(subtotal + vat);
  return {
    subtotal,
    vat,
    total,
    subtotalKhr: usdToKhr(subtotal, exchangeRate),
    vatKhr: usdToKhr(vat, exchangeRate),
    totalKhr: usdToKhr(total, exchangeRate),
  };
}

/** Sum of qty × price lines (credit notes, debit notes, record summaries). */
export function computeLinesTotal(lines: { qty: Decimalish; unitPrice: Decimalish }[]): number {
  return sumMoney(lines.map((l) => lineAmount(l.qty, l.unitPrice)));
}

/**
 * Credit notes and record summaries: the import / export processing fee is GS's own service,
 * charged with 10% VAT on top (its Mark reads "VAT 10%"). Every other line is a pass-through.
 */
export const isVatChargedLine = (description: string | null | undefined): boolean =>
  /^\s*(IMPORT|EXPORT)\s+PROCESSING\s+FEE\b/i.test(description ?? '');

/** A credit note / record summary line's subtotal: qty × price, plus 10% VAT on the processing fee. */
export function chargeLineAmount(line: {
  description?: string | null;
  qty: Decimalish;
  unitPrice: Decimalish;
}): number {
  const amount = lineAmount(line.qty, line.unitPrice);
  return isVatChargedLine(line.description) ? lineAmount(amount, '1.1') : amount;
}

/**
 * A record summary's standard breakdown ("Updated IM & EX -Record Summary-R.xlsx"), import and
 * export; each with its usual Mark. Prices are filled in per shipment.
 */
export const RECORD_SUMMARY_ITEMS: Record<
  'IMPORT' | 'EXPORT',
  readonly (readonly [description: string, mark: string])[]
> = {
  IMPORT: [
    ['IMPORT PROCESSING FEE', 'VAT 10%'],
    ['THC FEE', 'Receipt'],
    ['CUSTOMS PROCESSING FEE', 'Receipt'],
    ['LOLO AT PORT', 'Receipt'],
    ['LOLO EMPTY CONTAINER', 'Receipt'],
    ['WAREHOUSE / STORAGE FEE', 'Receipt'],
    ['TRUCKING FEE', ''],
    ['INCREASE TRUCKING FEE', ''],
    ['EXTRA TRUCKING FEE', ''],
    ['HANDLING FEE', ''],
    ['PERMIT FEE', ''],
    ['SERVICE TAXATION', ''],
    ['DOCUMENT FEE', ''],
    ['MISSING INSURANCE', ''],
    ['FUEL SURCHARGE', ''],
    ['RETURN EMPTY CONTAINER', ''],
    ['EXPRESS PERMIT FEE', ''],
    ['RED SIGNAL', ''],
    ['TRUCK STAND FEE', ''],
    ['OVER WEIGHT', ''],
    ['ADDITIONAL DECLARATION', ''],
    ['OT DOCUMENT', ''],
    ['SCAN FEE', ''],
    ['TRUCKING TO SECOND PLACE', ''],
  ],
  EXPORT: [
    ['EXPORT PROCESSING FEE', 'VAT 10%'],
    ['HBL FEE', 'Receipt'],
    ['CUSTOMS PROCESSING FEE', 'Receipt'],
    ['LOLO AT PORT', 'Receipt'],
    ['LOLO EMPTY CONTAINER', 'Receipt'],
    ['WAREHOUSE / STORAGE FEE', ''],
    ['TRUCKING FEE', ''],
    ['HANDLING FEE', ''],
    ['DOCUMENT FEE', ''],
    ['FUEL SURCHARGE', ''],
    ['SERVICE TAXATION', ''],
    ['PETROL ALLOWANCE FEE', ''],
    ['RED SIGNAL', ''],
    ['TRUCKING STANDBY FEE', ''],
    ['OVER WEIGHT', ''],
    ['ADDITIONAL DECLARATION', ''],
    ['OT DOCUMENT', ''],
    ['OT INSPECTION', ''],
    ['OT CHECK IN SUNDAY', ''],
    ['INCREASE TRUCKING FEE', ''],
    ['LOCK SEAL DRYPORT', ''],
    ['APPLY CO FOR INV:', ''],
    ['EQMC FOR INV:', ''],
  ],
};

/** Charges billed per set, whatever the shipment. */
export const PER_SET_CHARGES = [
  'PERMIT FEE',
  'SERVICE TAXATION',
  'MISSING INSURANCE',
  'DOCUMENT FEE',
];

/** "40HQ" → "40'HQ", the unit container charges are billed in. */
export const containerUnit = (size: string): string => size.trim().replace(/^(\d+)'?/, "$1'");

/**
 * The unit a shipment's charges are billed in: its container size ("40'HQ"), or SHIP for air,
 * LCL and anything without a size.
 */
export function shipmentChargeUnit(s: {
  transportMode?: string | null;
  loadType?: string | null;
  containerSize?: string | null;
}): string {
  if (s.transportMode === 'AIR' || s.loadType === 'LCL' || !s.containerSize?.trim()) return 'SHIP';
  return containerUnit(s.containerSize);
}

/** A credit note / record summary line's unit: SET for the per-set charges, else the shipment's. */
export const chargeLineUnit = (description: string | null | undefined, shipUnit: string): string =>
  PER_SET_CHARGES.includes((description ?? '').trim().toUpperCase()) ? 'SET' : shipUnit;

/**
 * A unit that follows the shipment (SHIP, SET or a container size: 20GP, 40'HQ, 40'). Others
 * (DAY, CBM, TRUCK 5T…) were picked on purpose and are left alone.
 */
export const isShipmentUnit = (unit: string | null | undefined): boolean =>
  /^(SHIP|SET|\d{2}'?\s*[A-Z]{0,2})$/i.test((unit ?? '').trim());

/** A line's unit once the shipment's unit or the line's description changed. */
export const followShipmentUnit = (
  line: { description?: string | null; unit?: string | null },
  shipUnit: string,
): string =>
  isShipmentUnit(line.unit) ? chargeLineUnit(line.description, shipUnit) : (line.unit ?? '');

/**
 * Where a record summary line goes ("Accountant (Monthly) data flow"):
 * - INV: the Import / Export Processing Fee (GS's service, VAT 10% on top);
 * - DIS: every line marked "Receipt" (paid on the client's behalf and re-billed at cost),
 *   except LOLO Empty Container, which is billed on the debit note even with a receipt;
 * - DN: everything else (trucking, handling, document, permit, LOLO empty container…).
 */
export type RecordSummaryLedgerGroup = 'INV' | 'DIS' | 'DN';
export function recordSummaryLedgerGroup(
  description: string,
  mark?: string | null,
): RecordSummaryLedgerGroup {
  if (isVatChargedLine(description)) return 'INV';
  if (/^\s*LOLO\s+EMPTY\s+CONTAINER\b/i.test(description)) return 'DN';
  if (/^\s*receipts?\s*$/i.test(mark ?? '')) return 'DIS';
  return 'DN';
}

/** The THC / HBL fee line: the THC the ledger pays out (also re-billed in DIS by its receipt). */
export const isThcLine = (description: string): boolean => /^\s*(THC|HBL)\b/i.test(description);

/**
 * The Monthly Ledger amounts a checked record summary fills: INV (processing fee before VAT),
 * DIS / REIM (receipt lines), DN (the rest) and THC (the THC / HBL fee).
 */
export function recordSummaryLedger(
  lines: { description: string; mark?: string | null; qty: Decimalish; unitPrice: Decimalish }[],
): { invRevenue: number; thc: number; disTotal: number; dnTotal: number } {
  const sum = (keep: (l: (typeof lines)[number]) => boolean) =>
    sumMoney(lines.filter(keep).map((l) => lineAmount(l.qty, l.unitPrice)));
  const group = (g: RecordSummaryLedgerGroup) => (l: (typeof lines)[number]) =>
    recordSummaryLedgerGroup(l.description, l.mark) === g;
  return {
    invRevenue: sum(group('INV')),
    thc: sum((l) => isThcLine(l.description)),
    disTotal: sum(group('DIS')),
    dnTotal: sum(group('DN')),
  };
}

/** Sum of credit note / record summary lines (see {@link chargeLineAmount}). */
export function computeChargeLinesTotal(
  lines: { description?: string | null; qty: Decimalish; unitPrice: Decimalish }[],
): number {
  return sumMoney(lines.map(chargeLineAmount));
}

/**
 * Issue date of a tax invoice, disbursement or debit note = the next working day after the
 * customs declaration (clearance) date: Saturdays, Sundays and the given Cambodian public
 * holidays (YYYY-MM-DD) are skipped, however many in a row (Friday → Monday; Friday before a
 * holiday Monday → Tuesday). Always the next working day, even in the next month or year.
 * Works on plain YYYY-MM-DD strings, so the result doesn't depend on the server's time zone.
 */
export function nextBusinessDay(
  isoDate: string,
  holidays: ReadonlySet<string> = new Set(),
): { date: string; weekday: string } {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid ISO date: ${isoDate}`);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const off = () => {
    const dow = dt.getUTCDay();
    return dow === 0 || dow === 6 || holidays.has(dt.toISOString().slice(0, 10));
  };
  // At least one day on; then on past weekends and holidays (a year has well under 200).
  dt.setUTCDate(dt.getUTCDate() + 1);
  for (let guard = 0; off() && guard < 200; guard++) dt.setUTCDate(dt.getUTCDate() + 1);
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return { date: dt.toISOString().slice(0, 10), weekday: weekdays[dt.getUTCDay()]! };
}
