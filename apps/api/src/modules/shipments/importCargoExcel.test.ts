import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RoleCode } from '@gs/shared';
import { createApp } from '../../app';
import { db, pool } from '../../db/client';
import { cutStockItems } from '../../db/schema';
import { createUser, resetDb, seedBasics, TEST_PASSWORD } from '../../test/helpers';

const app = createApp();
let basics: Awaited<ReturnType<typeof seedBasics>>;
let tokens: Partial<Record<RoleCode, string>> = {};

async function as(role: RoleCode) {
  if (!tokens[role]) {
    await createUser(role);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `${role.toLowerCase()}@test.local`, password: TEST_PASSWORD });
    tokens[role] = res.body.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[role]}` };
}

beforeEach(async () => {
  await resetDb();
  tokens = {};
  basics = await seedBasics();
  await db.insert(cutStockItems).values([
    {
      clientId: basics.jr.id,
      lineNo: 125,
      declareRef: 'II-125',
      category: 'RAW_MATERIAL',
      name: 'KNITTED FABRIC',
      unit: 'MTR',
      qty: '900000',
      unitPrice: '1',
    },
    {
      clientId: basics.jr.id,
      lineNo: 130,
      declareRef: 'III-130',
      category: 'ACCESSORY',
      name: 'INTERLINING',
      unit: 'MTR',
      qty: '50000',
      unitPrice: '0.2',
    },
  ]);
});
afterAll(async () => {
  await pool.end();
});

/** The downloaded template, as a workbook to fill in. */
async function template(h: Record<string, string>) {
  const tpl = await request(app)
    .get('/api/v1/shipments/import-cargo-template.xlsx')
    .query({ clientId: basics.jr.id })
    .set(h)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  expect(tpl.status).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(tpl.body as ArrayBuffer);
  return wb;
}

/** Fills rows from row 2, as a person would (the ITEM dropdown runs to row 500), and uploads them. */
async function upload(
  h: Record<string, string>,
  wb: ExcelJS.Workbook,
  rows: ExcelJS.CellValue[][],
) {
  const sheet = wb.getWorksheet('Import Invoices')!;
  rows.forEach((v, i) => (sheet.getRow(i + 2).values = v));
  const file = Buffer.from(await wb.xlsx.writeBuffer());
  return request(app)
    .post('/api/v1/shipments/parse-import-cargo-excel')
    .query({ clientId: basics.jr.id })
    .set(h)
    .attach('file', file, 'import.xlsx');
}

describe('import invoice Excel template', () => {
  it('has the import schedule columns and the client’s CDC master list', async () => {
    const wb = await template(await as('OPERATOR'));
    expect(wb.getWorksheet('Import Invoices')!.getRow(1).values).toEqual([
      undefined,
      'INV',
      'DATE',
      'ITEM',
      'PKGS',
      'QUANTITY',
      'CDC UNIT',
      'NW.KGS',
      'GW.KGS',
      'UNIT PRICE',
    ]);
    const ref = wb.getWorksheet('CDC Master List')!;
    expect([ref.getCell('A3').value, ref.getCell('B3').value]).toEqual(['INTERLINING', 'MTR']);
  });

  it('reads items found on the master list by name, with their CDC no. and material', async () => {
    const h = await as('OPERATOR');
    const res = await upload(h, await template(h), [
      ['JRCNQ25027', '2025-07-10', 'Knitted Fabric', 296, 32636.7, 'MTR', 17932.6, 18111.7, ''],
      ['JRCNQ25027', '2025-07-10', 'INTERLINING', '', 4968.8, 'mtr', 678.8, 697.8, 0.25],
    ]);
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.invoices).toMatchObject([
      {
        invoiceNo: 'JRCNQ25027',
        invoiceDate: '2025-07-10',
        lines: [
          {
            cdcNo: 'II-125',
            description: 'KNITTED FABRIC',
            material: 'II. RAW MATERIAL',
            unit: 'MTR',
            ctns: '296',
            pcs: '32636.7',
            fobUnitPrice: '1', // empty: the master list price
          },
          {
            cdcNo: 'III-130',
            description: 'INTERLINING',
            ctns: '',
            pcs: '4968.8',
            fobUnitPrice: '0.25',
          },
        ],
      },
    ]);
  });

  it('fills CDC UNIT and UNIT PRICE from the master list sheet, from the ITEM alone', async () => {
    const h = await as('OPERATOR');
    const wb = await template(h);
    const sheet = wb.getWorksheet('Import Invoices')!;
    const formula = (a: string) => (sheet.getCell(a).value as ExcelJS.CellFormulaValue).formula;
    expect(formula('F2')).toContain(`INDEX('CDC Master List'!$B$2:$B$3,MATCH($C2,`);
    expect(formula('I2')).toContain(`INDEX('CDC Master List'!$E$2:$E$3,MATCH($C2,`);
    expect(formula('F500')).toContain('MATCH($C500,');
    const [f2, i2, f3, i3] = ['F2', 'I2', 'F3', 'I3'].map(formula);
    // As saved by Excel: the formulas carry their results; uncalculated ones read as empty.
    sheet.getRow(2).values = ['JRCNQ25027', '2025-07-10', 'INTERLINING', 4, 10, undefined, 1, 2];
    sheet.getCell('F2').value = { formula: f2!, result: 'MTR' };
    sheet.getCell('I2').value = { formula: i2!, result: 0.2 };
    sheet.getRow(3).values = ['', '', 'KNITTED FABRIC', 2, 5, undefined, 1, 2];
    sheet.getCell('F3').value = { formula: f3! } as ExcelJS.CellFormulaValue;
    sheet.getCell('I3').value = { formula: i3! } as ExcelJS.CellFormulaValue;
    const res = await upload(h, wb, []);
    expect(res.body.errors).toEqual([]);
    expect(res.body.invoices[0].lines).toMatchObject([
      { description: 'INTERLINING', ctns: '4', unit: 'MTR', fobUnitPrice: '0.2' },
      { description: 'KNITTED FABRIC', unit: 'MTR', fobUnitPrice: '1' },
    ]);
  });

  it('returns nothing and names every row that does not match the master list', async () => {
    const h = await as('OPERATOR');
    const res = await upload(h, await template(h), [
      ['JRCNQ25027', '2025-07-10', 'KNITTED FABRIC', 1, 100, 'MTR', 1, 1, 1],
      ['JRCNQ25027', '2025-07-10', 'BOILER', 1, 1, 'SET', 1, 1, 1],
      ['JRCNQ25027', '2025-07-10', 'INTERLINING', 1, 5, 'KGS', 1, 1, 1],
    ]);
    expect(res.status).toBe(200);
    expect(res.body.invoices).toEqual([]);
    expect(res.body.errors).toEqual([
      { row: 3, message: '"BOILER" is not on JR\'s CDC master list.' },
      { row: 4, message: '"INTERLINING" is counted in MTR on the CDC master list, not KGS.' },
    ]);
  });

  it('refuses a sheet without the template columns', async () => {
    const h = await as('OPERATOR');
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').addRow(['INV', 'DATE', 'ITEM', 'QUANTITY']);
    const res = await request(app)
      .post('/api/v1/shipments/parse-import-cargo-excel')
      .query({ clientId: basics.jr.id })
      .set(h)
      .attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 'import.xlsx');
    expect(res.body.errors[0].message).toMatch(/missing CDC UNIT, NW.KGS, GW.KGS, UNIT PRICE/);
  });

  it('needs a client, and a Viewer cannot use it', async () => {
    const noClient = await request(app)
      .get('/api/v1/shipments/import-cargo-template.xlsx')
      .set(await as('OPERATOR'));
    expect(noClient.status).toBe(400);
    const viewer = await request(app)
      .get('/api/v1/shipments/import-cargo-template.xlsx')
      .query({ clientId: basics.jr.id })
      .set(await as('VIEWER'));
    expect(viewer.status).toBe(403);
  });
});

describe('export invoice Excel template', () => {
  it('downloads the columns the export upload reads, and reads them back', async () => {
    const h = await as('OPERATOR');
    const tpl = await request(app)
      .get('/api/v1/shipments/cargo-template.xlsx')
      .set(h)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(tpl.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body as ArrayBuffer);
    const sheet = wb.getWorksheet('Export Invoices')!;
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      'INVOICE NO',
      'INV DATE',
      'PO#',
      'STYLE',
      'HTS CODE',
      'PCS',
      'CTNS',
      'CBM',
      'N.W KGS',
      'G.W KGS',
      'FOB PRICE',
      'DESCRIPTION',
    ]);
    sheet.getRow(2).values = [
      'JRA26001',
      '2026-02-11',
      '003816',
      'RT26731CH',
      '6204.69',
      800,
      25,
      1.44,
      275,
      300,
      1.88,
      'LADIES WOVEN PANT',
    ];
    sheet.getRow(3).values = [
      '',
      '',
      '003876',
      'RT70952CH',
      '6204.69',
      600,
      38,
      1.01,
      131,
      150,
      2.096,
      'LADIES WOVEN PANT',
    ];
    const res = await request(app)
      .post('/api/v1/shipments/parse-cargo-excel')
      .set(h)
      .attach('file', Buffer.from(await wb.xlsx.writeBuffer()), 'export.xlsx');
    expect(res.status).toBe(200);
    expect(res.body.invoices).toMatchObject([
      {
        invoiceNo: 'JRA26001',
        invoiceDate: '2026-02-11',
        lines: [
          { styleNo: 'RT26731CH', pcs: '800' },
          { styleNo: 'RT70952CH', pcs: '600' },
        ],
      },
    ]);
  });

  it('is not for a Viewer', async () => {
    const res = await request(app)
      .get('/api/v1/shipments/cargo-template.xlsx')
      .set(await as('VIEWER'));
    expect(res.status).toBe(403);
  });
});
