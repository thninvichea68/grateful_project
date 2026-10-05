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
 * Invoice date = next business day after the declaration date
 * (Saturday → Monday, Sunday → Monday). Works on plain YYYY-MM-DD strings so the
 * result does not depend on the server's time zone.
 */
export function nextBusinessDay(isoDate: string): { date: string; weekday: string } {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid ISO date: ${isoDate}`);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const dow = dt.getUTCDay();
  if (dow === 6) dt.setUTCDate(dt.getUTCDate() + 2);
  else if (dow === 0) dt.setUTCDate(dt.getUTCDate() + 1);
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return { date: dt.toISOString().slice(0, 10), weekday: weekdays[dt.getUTCDay()]! };
}
