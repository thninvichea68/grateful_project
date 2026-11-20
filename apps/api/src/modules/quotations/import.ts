import ExcelJS from 'exceljs';
import { badRequest } from '../../lib/errors';

const SHEETS: Record<string, string> = {
  'IMP-SIH': 'import_sih',
  'IMP-PNH': 'import_pnh',
  'EXP-PNH': 'export_pnh',
  'EXP-SIH': 'export_shv',
  'TRUCK LCL': 'dryport_lcl',
};

const AIR_SHEET = 'EXP+IMP AIR';
const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export interface ImportedQuotation {
  templateKey: string;
  quoteDate: string;
  toName: string | null;
  attn: string | null;
  paymentTermDays: number | null;
  lines: Record<string, string>[];
  notes: string | null;
  sourceSheet: string;
}

function raw(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value && typeof value === 'object' && 'result' in value)
    return (value as ExcelJS.CellFormulaValue).result;
  if (value && typeof value === 'object' && 'richText' in value) return cell.text;
  if (value && typeof value === 'object' && 'text' in value)
    return (value as { text: string }).text;
  return value;
}

function text(cell: ExcelJS.Cell): string {
  const value = raw(cell);
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? value.toFixed(2) : String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, ' ').trim();
}

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9.]+/g, '');

function dateFromText(value: string): string | null {
  const match = /date\s*:\s*(.+)$/i.exec(value);
  if (!match) return null;
  const date = match[1]!.trim();
  const parts = /^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(date);
  if (!parts) return null;
  const month = MONTHS[parts[2]!.slice(0, 3).toLowerCase()];
  if (!month) return null;
  const day = Number(parts[1]);
  const year = Number(parts[3]);
  const valueDate = new Date(Date.UTC(year, month - 1, day));
  if (
    valueDate.getUTCFullYear() !== year ||
    valueDate.getUTCMonth() !== month - 1 ||
    valueDate.getUTCDate() !== day
  )
    return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function metadata(workbook: ExcelJS.Workbook) {
  let quoteDate: string | null = null;
  let toName: string | null = null;
  let attn: string | null = null;
  let paymentTermDays: number | null = null;

  for (const sheet of workbook.worksheets) {
    if (sheet.state !== 'visible') continue;
    sheet.eachRow((row) => {
      for (let col = 1; col <= row.cellCount; col++) {
        const value = text(row.getCell(col));
        if (!quoteDate) quoteDate = dateFromText(value);
        const term = /credit\s+term\s+(\d+)\s*days?/i.exec(value);
        if (paymentTermDays === null && term) paymentTermDays = Number(term[1]);
        const label = normalized(value).replace(/:$/, '');
        if (label === 'to' && !toName) {
          for (let nextCol = col + 1; nextCol <= row.cellCount; nextCol++) {
            const name = text(row.getCell(nextCol));
            if (name) {
              toName = name;
              break;
            }
          }
        }
        if (label === 'attn' && !attn) {
          for (let nextCol = col + 1; nextCol <= row.cellCount; nextCol++) {
            const name = text(row.getCell(nextCol));
            if (name) {
              attn = name;
              break;
            }
          }
        }
      }
    });
  }
  if (!quoteDate) throw badRequest('Could not read the quotation date from the workbook');
  return { quoteDate, toName, attn, paymentTermDays };
}

interface TableHeader {
  rowNo: number;
  numberCol: number | null;
  descriptionCol: number;
  currencyCol: number;
  columns: Map<string, number>;
}

function rateKey(templateKey: string, value: string): string | null {
  const label = normalized(value);
  if (label === 'remark') return 'remark';
  if (templateKey.endsWith('_air')) {
    const weight = /(\d+)k/.exec(label)?.[1];
    return weight ? `w${weight}` : null;
  }
  if (templateKey === 'dryport_lcl') {
    if (label.includes('1.5t')) return 't15';
    if (label.includes('2.5t')) return 't25';
    if (label.includes('5t')) return 't5';
    return null;
  }
  if (label.includes('20')) return 'c20';
  if (label.includes('40')) return 'c40';
  if (label === 'lcl' || label.startsWith('lcl')) return 'lcl';
  return null;
}

function tableHeaders(sheet: ExcelJS.Worksheet, templateKey: string): TableHeader[] {
  const headers: TableHeader[] = [];
  for (let rowNo = 1; rowNo <= sheet.rowCount; rowNo++) {
    const row = sheet.getRow(rowNo);
    let numberCol: number | null = null;
    let descriptionCol: number | null = null;
    let currencyCol: number | null = null;
    for (let col = 1; col <= row.cellCount; col++) {
      const label = normalized(text(row.getCell(col)));
      if (label === 'no' || label === 'number') numberCol = col;
      if (label === 'description') descriptionCol = col;
      if (label === 'currency') currencyCol = col;
    }
    if (descriptionCol === null || currencyCol === null) continue;

    const columns = new Map<string, number>();
    columns.set('desc', descriptionCol);
    columns.set('ccy', currencyCol);
    for (let col = 1; col <= row.cellCount; col++) {
      const key = rateKey(templateKey, text(row.getCell(col)));
      // These worksheets repeat the rate headings in internal customer/profit blocks.
      // The leftmost block is the actual quotation table.
      if (key && !columns.has(key)) columns.set(key, col);
    }
    headers.push({ rowNo, numberCol, descriptionCol, currencyCol, columns });
  }
  return headers;
}

function tableDirection(sheet: ExcelJS.Worksheet, headerRow: number): 'import' | 'export' | null {
  for (let rowNo = Math.max(1, headerRow - 3); rowNo < headerRow; rowNo++) {
    const values: string[] = [];
    sheet.getRow(rowNo).eachCell((cell) => values.push(text(cell)));
    const rowText = values.join(' ').toUpperCase();
    if (rowText.includes('EXPORT')) return 'export';
    if (rowText.includes('IMPORT')) return 'import';
  }
  return null;
}

function notesFor(
  sheet: ExcelJS.Worksheet,
  header: TableHeader,
  endRow: number,
  nextHeaderRow: number | undefined,
): string | null {
  const remarkCol = header.columns.get('remark') ?? header.descriptionCol;
  const lastRow = Math.min(nextHeaderRow ? nextHeaderRow - 1 : sheet.rowCount, endRow + 30);
  const notes: string[] = [];
  for (let rowNo = endRow + 1; rowNo <= lastRow; rowNo++) {
    const values: string[] = [];
    for (let col = header.descriptionCol; col <= remarkCol; col++) {
      const value = text(sheet.getRow(rowNo).getCell(col));
      if (value && !/^\d+(?:\.\d+)?$/.test(value)) values.push(value);
    }
    const line = [...new Set(values)].join(' — ');
    if (line && !notes.includes(line)) notes.push(line);
  }
  const result = notes.join('\n');
  if (result.length > 4000)
    throw badRequest(`Quotation notes on worksheet "${sheet.name}" exceed 4,000 characters`);
  return result || null;
}

function parseTable(
  sheet: ExcelJS.Worksheet,
  header: TableHeader,
  templateKey: string,
  nextHeaderRow?: number,
): ImportedQuotation {
  const lines: Record<string, string>[] = [];
  let endRow = header.rowNo;
  for (let rowNo = header.rowNo + 1; rowNo <= sheet.rowCount; rowNo++) {
    if (nextHeaderRow && rowNo >= nextHeaderRow) break;
    const row = sheet.getRow(rowNo);
    const description = text(row.getCell(header.descriptionCol));
    if (!description) break;
    if (/^above\s+rate\b/i.test(description)) break;
    if (
      header.numberCol !== null &&
      !/^\d+(?:\.0+)?[A-Z]?$/i.test(text(row.getCell(header.numberCol)))
    )
      break;
    const cells: Record<string, string> = { desc: description };
    const currency = text(row.getCell(header.currencyCol));
    if (currency) cells.ccy = currency;
    for (const [key, col] of header.columns) {
      if (key === 'desc' || key === 'ccy') continue;
      const value = text(row.getCell(col));
      if (value) cells[key] = value;
    }
    lines.push(cells);
    endRow = rowNo;
  }
  if (!lines.length) throw badRequest(`No quotation rows found on worksheet "${sheet.name}"`);
  return {
    templateKey,
    quoteDate: '',
    toName: null,
    attn: null,
    paymentTermDays: null,
    lines,
    notes: notesFor(sheet, header, endRow, nextHeaderRow),
    sourceSheet: sheet.name,
  };
}

/**
 * Import the leftmost client-facing rate table on standard quotation worksheets.
 * The JR N-* worksheets are intentionally not mapped because they are separate schedules.
 */
export async function parseQuotationWorkbook(buffer: Buffer): Promise<{
  metadata: ReturnType<typeof metadata>;
  quotations: ImportedQuotation[];
}> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw badRequest('Could not read the Excel workbook');
  }

  const details = metadata(workbook);
  const quotations: ImportedQuotation[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheet.state !== 'visible') continue;
    const sheetName = sheet.name.trim().toUpperCase();
    if (sheetName === AIR_SHEET) {
      const headers = tableHeaders(sheet, 'export_air');
      if (headers.length < 2)
        throw badRequest(`Expected separate export and import tables on worksheet "${sheet.name}"`);
      for (const [index, header] of headers.entries()) {
        const direction =
          tableDirection(sheet, header.rowNo) ?? (index === 0 ? 'export' : 'import');
        const templateKey = `${direction}_air`;
        quotations.push(parseTable(sheet, header, templateKey, headers[index + 1]?.rowNo));
      }
      continue;
    }

    const templateKey = SHEETS[sheetName];
    if (!templateKey) continue;
    const header = tableHeaders(sheet, templateKey)[0];
    if (!header)
      throw badRequest(`No Description/Currency header found on worksheet "${sheet.name}"`);
    quotations.push(parseTable(sheet, header, templateKey));
  }

  if (!quotations.length) throw badRequest('No supported quotation worksheets were found');
  return {
    metadata: details,
    quotations: quotations.map((quote) => ({
      ...quote,
      quoteDate: details.quoteDate,
      toName: details.toName,
      attn: details.attn,
      paymentTermDays: details.paymentTermDays,
    })),
  };
}
