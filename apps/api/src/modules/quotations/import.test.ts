import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseQuotationWorkbook } from './import';

async function workbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const sea = workbook.addWorksheet('IMP-SIH');
  sea.getCell('B11').value = 'Date: 02 Jan 2026';
  sea.getCell('B12').value = 'TO:';
  sea.getCell('C12').value = 'SPORTLINE APPAREL CAMBODIA CO.,LTD';
  sea.getCell('B13').value = 'Attn:';
  sea.getCell('C13').value = 'Ms. May Chiu';
  sea.getCell('B19').value = 'customer';
  sea.getRow(21).values = [
    undefined,
    'NO',
    'Description',
    'Currency',
    "20'GP",
    "40'H",
    'LCL',
    'REMARK',
    undefined,
    '20GP',
  ];
  sea.getRow(22).values = [
    undefined,
    1,
    'TRUCKING FEE',
    'USD',
    280,
    360,
    60,
    'Per CTNR',
    undefined,
    999,
  ];
  sea.getCell('C23').value = 'Above rate is subjected to below items:';
  sea.getCell('C24').value = 'Extra declaration: USD 55 / Set';
  sea.getCell('B30').value = 'Payment Credit term 30days after invoice issue date';

  const air = workbook.addWorksheet('EXP+IMP AIR');
  air.getCell('C19').value = 'I. EXPORT AIRPORT';
  air.getRow(21).values = [
    undefined,
    'NO',
    'Description',
    'Currency',
    '-500k',
    '-1000k',
    '-2000k',
    '-3000k',
    '-5000k',
    'REMARK',
  ];
  air.getRow(22).values = [
    undefined,
    1,
    'Export Clearance',
    'USD',
    120,
    130,
    150,
    160,
    180,
    'Per set',
  ];
  air.getCell('C39').value = 'I. IMPORT AIRPORT';
  air.getRow(40).values = [
    undefined,
    'NO',
    'Description',
    'Currency',
    '-500k',
    '-1000k',
    '-2000k',
    '-3000k',
    '-5000k',
    'REMARK',
  ];
  air.getRow(41).values = [
    undefined,
    1,
    'Import Clearance',
    'USD',
    130,
    140,
    160,
    170,
    190,
    'Per set',
  ];

  const alternate = workbook.addWorksheet('N-IMP');
  alternate.getCell('B21').value = 'Description';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('quotation workbook import', () => {
  it('uses the leftmost quote rates, splits air directions, and ignores alternate N sheets', async () => {
    const result = await parseQuotationWorkbook(await workbookBuffer());

    expect(result.metadata).toMatchObject({
      quoteDate: '2026-01-02',
      toName: 'SPORTLINE APPAREL CAMBODIA CO.,LTD',
      attn: 'Ms. May Chiu',
      paymentTermDays: 30,
    });
    expect(result.quotations).toHaveLength(3);
    expect(result.quotations.map((quote) => quote.templateKey)).toEqual([
      'import_sih',
      'export_air',
      'import_air',
    ]);
    expect(result.quotations[0]!.lines[0]).toMatchObject({
      desc: 'TRUCKING FEE',
      c20: '280.00',
      c40: '360.00',
      lcl: '60.00',
    });
    expect(result.quotations[0]!.lines).toHaveLength(1);
    expect(result.quotations[0]!.notes).toContain('Extra declaration: USD 55 / Set');
    expect(result.quotations[1]!.lines[0]).toMatchObject({
      w500: '120.00',
      w1000: '130.00',
      w5000: '180.00',
    });
  });
});
