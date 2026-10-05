import { describe, expect, it } from 'vitest';
import {
  computeLedger,
  computeTaxDocument,
  computeTaxLine,
  nextBusinessDay,
  computeLinesTotal,
} from './accounting';
import { computeCutStockBalance, wouldOverImport } from './cutstock';
import { toMoneyString, sumMoney, round2 } from './money';

describe('computeLedger (Chea payment / monthly ledger row)', () => {
  it('matches declaration I 122050 (JR Apparel, commission 0)', () => {
    const r = computeLedger({
      clearFee: 982.45,
      thc: 355,
      otherPay: 0,
      commission: 0,
      invRevenue: 185,
      disTotal: 21.25,
      dnTotal: 1334,
    });
    expect(r.vat).toBe(18.5);
    expect(r.totalInflow).toBe(1540.25);
    expect(r.totalOutflow).toBe(1337.45);
    expect(r.netProfit).toBe(202.8);
  });

  it('matches declaration I 95925 (Sportline, commission 50)', () => {
    const r = computeLedger({
      clearFee: '285.53',
      thc: '0.00',
      otherPay: '0',
      commission: '50.00',
      invRevenue: '150.00',
      disTotal: '190.53',
      dnTotal: '347.11',
    });
    expect(r.vat).toBe(15);
    expect(r.netProfit).toBe(352.11);
  });

  it('excludes VAT from net profit', () => {
    const a = computeLedger({
      clearFee: 0,
      thc: 0,
      otherPay: 0,
      commission: 0,
      invRevenue: 100,
      disTotal: 0,
      dnTotal: 0,
    });
    expect(a.netProfit).toBe(100);
    expect(a.vat).toBe(10);
  });

  it('can be negative (loss-making shipment)', () => {
    const r = computeLedger({
      clearFee: 500,
      thc: 355,
      otherPay: 12.5,
      commission: 50,
      invRevenue: 150,
      disTotal: 0,
      dnTotal: 300,
    });
    expect(r.netProfit).toBe(-467.5);
  });

  it('has no floating point drift', () => {
    const r = computeLedger({
      clearFee: 0.1,
      thc: 0.2,
      otherPay: 0,
      commission: 0,
      invRevenue: 0.3,
      disTotal: 0,
      dnTotal: 0,
    });
    expect(r.netProfit).toBe(0);
  });
});

describe('tax invoice', () => {
  it('computes VAT 10% per line and KHR at the stored rate', () => {
    const t = computeTaxDocument([{ qty: 1, unitPrice: 185 }], 4026);
    expect(t).toEqual({
      subtotal: 185,
      vat: 18.5,
      total: 203.5,
      subtotalKhr: 744810,
      vatKhr: 74481,
      totalKhr: 819291,
    });
  });

  it('rounds VAT half-up to cents', () => {
    expect(computeTaxLine({ qty: 1, unitPrice: 18.75 }).vat).toBe(1.88);
    expect(computeTaxLine({ qty: 3, unitPrice: '0.335' }).subtotal).toBe(1.01);
  });

  it('disbursement lines carry no VAT', () => {
    expect(computeTaxLine({ qty: 2, unitPrice: 95.265, vatable: false })).toEqual({
      subtotal: 190.53,
      vat: 0,
      amount: 190.53,
    });
  });

  it('sums debit note lines', () => {
    expect(
      computeLinesTotal([
        { qty: 1, unitPrice: 420 },
        { qty: 1, unitPrice: 35 },
        { qty: 1, unitPrice: 25 },
        { qty: 1, unitPrice: 20 },
        { qty: 1, unitPrice: 69 },
        { qty: 1, unitPrice: 40 },
        { qty: 1, unitPrice: 273 },
        { qty: 1, unitPrice: 45 },
        { qty: 1, unitPrice: 40 },
      ]),
    ).toBe(967);
  });
});

describe('nextBusinessDay', () => {
  it('Friday → Monday', () =>
    expect(nextBusinessDay('2026-08-21')).toEqual({ date: '2026-08-24', weekday: 'Monday' }));
  it('Wednesday → Thursday', () =>
    expect(nextBusinessDay('2026-07-01')).toEqual({ date: '2026-07-02', weekday: 'Thursday' }));
  it('Saturday → Monday', () => expect(nextBusinessDay('2026-08-22').date).toBe('2026-08-24'));
  it('Sunday → Monday', () => expect(nextBusinessDay('2026-08-23').date).toBe('2026-08-24'));
  it('crosses year end', () => expect(nextBusinessDay('2026-12-31').date).toBe('2027-01-01'));
});

describe('cut stock', () => {
  it('matches spreadsheet row I-5 (60% → OK)', () => {
    expect(computeCutStockBalance(5, 2)).toEqual({ balance: 3, balancePct: 0.6, condition: 'OK' });
  });
  it('matches spreadsheet row I-10 (over-imported → CHECK)', () => {
    expect(computeCutStockBalance(40, 64)).toEqual({
      balance: -24,
      balancePct: -0.6,
      condition: 'CHECK',
    });
  });
  it('flags zero-quantity items as CHECK', () => {
    expect(computeCutStockBalance(0, 1).condition).toBe('CHECK');
  });
  it('detects over-import', () => {
    expect(wouldOverImport(10, 9, 1)).toBe(false);
    expect(wouldOverImport(10, 9, 1.001)).toBe(true);
  });
});

describe('money helpers', () => {
  it('formats NUMERIC strings', () => {
    expect(toMoneyString(1334)).toBe('1334.00');
    expect(toMoneyString(-0.5)).toBe('-0.50');
    expect(toMoneyString('2.345')).toBe('2.35');
  });
  it('sums exactly', () => expect(sumMoney([0.1, 0.2, '0.3'])).toBe(0.6));
  it('rounds half away from zero', () => expect(round2(-1.005)).toBe(-1.01));
});
