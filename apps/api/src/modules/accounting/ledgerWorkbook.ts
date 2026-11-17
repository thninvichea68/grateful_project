import type ExcelJS from 'exceljs';
import { vatLabel, type LedgerRow, type LedgerSummary } from '@gs/shared';

/*
 * The Monthly Ledger as the accounts' "LIST I & E" workbook keeps a month: one sheet named by
 * the month number ("08"), REVENUE & EXPENSE over a dark-blue header row, the client's figures
 * row by row with NET PROFIT shaded green, then a yellow TOTAL row and the clear fees split
 * into PAID and NOT YET. Net profit, the weekday and the totals are formulas (with their
 * values filled in), so the sheet still adds up when accounts edit it.
 */

const FONT = 'Aptos Narrow';
const MONEY = '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)';
const DATE = 'd-mmm-yy';
const HEADER_FILL = 'FF1F4E79';
const PROFIT_FILL = 'FFE2EFDA';
const TOTAL_FILL = 'FFFFFF00';
const thin = { style: 'thin' as const };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

type Value = ExcelJS.CellValue;
interface Col {
  header: string;
  width: number;
  value: (r: LedgerRow, row: number) => Value;
  numFmt?: string;
  align?: 'center' | 'left';
  bold?: boolean;
}

const money = (v: string) => Number(v);
const date = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
const weekday = (iso: string) =>
  date(iso).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
const cheaText = (s: string) => (s === 'PAID' ? 'PAID' : s === 'UNPAID' ? 'NOT YET' : 'N/A');
/** "11" as a number, as the workbook types it; "11+" stays text. */
const portNo = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : v);

function columns(vatHeader: string): Col[] {
  return [
    { header: 'CHEA\nPAYMENT', width: 14, value: (r) => cheaText(r.cheaStatus), align: 'center' },
    { header: 'PORT\nNUMBER', width: 10, value: (r) => portNo(r.portNo), align: 'center' },
    { header: 'PORT\nCODE', width: 12, value: (r) => r.portCode, align: 'center' },
    { header: 'PORT\nNAME', width: 18, value: (r) => r.portName, align: 'center' },
    { header: 'DECLARE/ INV F.W NO', width: 14, value: (r) => r.declareNo, align: 'center' },
    {
      header: 'DATE',
      width: 12,
      value: (r) => date(r.declareDate),
      numFmt: DATE,
      align: 'center',
    },
    { header: 'CLIENT', width: 25, value: (r) => r.clientName, align: 'center' },
    { header: 'INV', width: 14, value: (r) => r.invNo, align: 'center', bold: true },
    { header: 'DISBURSEMENT', width: 15, value: (r) => r.disNo, align: 'center' },
    { header: 'DN', width: 15, value: (r) => r.dnNo, align: 'center' },
    { header: 'DATE', width: 12, value: (r) => date(r.invDate), numFmt: DATE, align: 'center' },
    {
      header: 'EXCHANGE RATE',
      width: 11,
      value: (r) => Number(r.exchangeRate),
      numFmt: '#,##0',
      align: 'center',
    },
    {
      header: 'WEEKDAY',
      width: 12,
      value: (r, n) => ({ formula: `TEXT(K${n},"dddd")`, result: weekday(r.invDate) }),
      align: 'center',
    },
    { header: 'CLEAR\nFEE', width: 13, value: (r) => money(r.clearFee), numFmt: MONEY },
    { header: 'THC', width: 13, value: (r) => money(r.thc), numFmt: MONEY },
    { header: 'OTHER PAY', width: 12, value: (r) => money(r.otherPay), numFmt: MONEY },
    { header: 'CM', width: 11, value: (r) => money(r.commission), numFmt: MONEY },
    { header: 'INV (REVENUE)', width: 13, value: (r) => money(r.invRevenue), numFmt: MONEY },
    { header: 'REIM', width: 13, value: (r) => money(r.disTotal), numFmt: MONEY },
    { header: vatHeader, width: 12, value: (r) => money(r.vat), numFmt: MONEY },
    { header: 'DN', width: 13, value: (r) => money(r.dnTotal), numFmt: MONEY },
    {
      header: 'NET \nPROFIT',
      width: 14,
      value: (r, n) => ({
        formula: `(R${n}+S${n}+U${n})-(N${n}+O${n}+Q${n}+P${n})`,
        result: money(r.netProfit),
      }),
      numFmt: MONEY,
    },
    { header: 'MARK', width: 46, value: (r) => r.mark, align: 'left' },
  ];
}

const MONTHS = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
];

/** Adds the month's sheet ("2026-08" → sheet "08") to the workbook. */
export function addMonthlyLedgerSheet(
  wb: ExcelJS.Workbook,
  month: string,
  data: LedgerRow[],
  totals: LedgerSummary,
): ExcelJS.Worksheet {
  const [year, mm] = month.split('-');
  // "VAT 10%" when every row has the same percent; just "VAT" across a rate change.
  const rates = new Set(data.map((r) => Number(r.vatRate)));
  const cols = columns(rates.size === 1 ? vatLabel([...rates][0]) : 'VAT');
  const last = cols.length; // W
  const ws = wb.addWorksheet(mm!, {
    views: [{ state: 'frozen', xSplit: 8, ySplit: 2, zoomScale: 85 }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '2:2',
      margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
  });
  ws.properties.defaultRowHeight = 18;
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));
  const font = (o: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({
    name: FONT,
    size: 12,
    ...o,
  });

  // Row 1: the title over the declarations.
  const title = ws.getCell('E1');
  title.value = `REVENUE & EXPENSE — ${MONTHS[Number(mm) - 1]} ${year}`;
  title.font = font({ bold: true, size: 14 });
  title.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 22;

  // Row 2: the header.
  const head = ws.getRow(2);
  head.height = 47.25;
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = font({ bold: true, color: { argb: 'FFFFFFFF' } });
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = BORDER;
  });

  // The rows.
  data.forEach((r, k) => {
    const n = 3 + k;
    const row = ws.getRow(n);
    row.height = 18;
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = c.value(r, n);
      cell.font = font({ bold: c.bold });
      cell.border = BORDER;
      cell.alignment = { horizontal: c.align, vertical: 'middle' };
      if (c.numFmt) cell.numFmt = c.numFmt;
    });
    row.getCell(22).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PROFIT_FILL } };
  });

  // TOTAL: counts of the ports and numbers, sums of the money (SUBTOTAL, so a filter narrows them).
  const first = 3;
  const end = Math.max(first, 2 + data.length);
  const t = ws.getRow(end + 1);
  t.height = 20;
  const count = (col: string, result: number) => ({
    formula: `SUBTOTAL(3,${col}${first}:${col}${end})`,
    result,
  });
  const sum = (col: string, result: string) => ({
    formula: `SUBTOTAL(9,${col}${first}:${col}${end})`,
    result: money(result),
  });
  const filled = (f: (r: LedgerRow) => unknown) => data.filter((r) => !!f(r)).length;
  const totalCells: Record<string, Value> = {
    B: count(
      'B',
      filled((r) => r.portNo),
    ),
    E: 'TOTAL:',
    H: count(
      'H',
      filled((r) => r.invNo),
    ),
    I: count(
      'I',
      filled((r) => r.disNo),
    ),
    J: count(
      'J',
      filled((r) => r.dnNo),
    ),
    N: sum('N', totals.clearFee),
    O: sum('O', totals.thc),
    P: sum('P', totals.otherPay),
    Q: sum('Q', totals.commission),
    R: sum('R', totals.invRevenue),
    S: sum('S', totals.disTotal),
    T: sum('T', totals.vat),
    U: sum('U', totals.dnTotal),
    V: sum('V', totals.netProfit),
  };
  for (let i = 1; i <= last; i++) {
    const cell = t.getCell(i);
    const key = cell.address.replace(/\d+/g, '');
    cell.value = totalCells[key] ?? null;
    cell.font = font({ bold: true });
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } };
    cell.border = BORDER;
    cell.alignment = { horizontal: i >= 14 && i <= 22 ? undefined : 'center', vertical: 'middle' };
    if (i >= 14 && i <= 22) cell.numFmt = MONEY;
  }

  // Under the total: the month's clear fees paid to Chea and still owed.
  const cents = (s: string) => Math.round(Number(s) * 100);
  const clearBy = (status: string) =>
    data
      .filter((r) => cheaText(r.cheaStatus) === status)
      .reduce((a, r) => a + cents(r.clearFee), 0) / 100;
  (['PAID', 'NOT YET'] as const).forEach((status, k) => {
    const n = end + 2 + k;
    const lbl = ws.getCell(`M${n}`);
    lbl.value = status;
    lbl.font = font({ bold: true });
    lbl.alignment = { horizontal: 'center' };
    lbl.border = BORDER;
    const v = ws.getCell(`N${n}`);
    v.value = {
      formula: `SUMIFS($N$${first}:$N$${end},$A$${first}:$A$${end},$M$${n})`,
      result: clearBy(status),
    };
    v.font = font({ bold: true });
    v.numFmt = MONEY;
    v.border = BORDER;
  });

  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: end, column: last } };
  return ws;
}
