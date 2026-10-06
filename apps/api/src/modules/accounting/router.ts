import { Router } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import {
  BILLING_DOC_LABEL,
  BILLING_DOC_SCHEMAS,
  BILLING_DOC_TYPES,
  billingDocListQuerySchema,
  ledgerInputSchema,
  ledgerListQuerySchema,
  ledgerUpdateSchema,
  type BillingDocType,
} from '@gs/shared';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { attachmentName } from '../../lib/http';
import * as ledger from './ledger';
import * as docs from './docs';
import { prefill } from './prefill';

const idParam = z.object({ id: z.string().uuid('Invalid id') });
const typeParam = z.object({
  type: z.enum(BILLING_DOC_TYPES, { message: 'Unknown document type' }),
});

export const accountingRouter = Router();
accountingRouter.use(requireAuth, requirePermission('accounting:read'));

/* ---------- Monthly ledger ---------- */
accountingRouter.get('/ledger', async (req, res) =>
  res.json(await ledger.listLedger(parse(ledgerListQuerySchema, req.query))),
);
accountingRouter.get('/declarations', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().max(60).optional() }), req.query);
  res.json(await ledger.declarationOptions(q));
});

accountingRouter.get('/ledger/export.xlsx', async (req, res) => {
  const q = parse(ledgerListQuerySchema, { ...req.query, page: 1, pageSize: 500 });
  const { data, totals } = await ledger.listLedger({ ...q, sort: 'invDate' });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Ledger ${q.month ?? 'all'}`, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const cols: [string, number, (r: (typeof data)[number]) => string | number | null][] = [
    ['Inv Date', 12, (r) => r.invDate],
    ['Client', 8, (r) => r.clientCode],
    ['Declare No', 14, (r) => r.declareNo],
    ['Port', 8, (r) => r.portCode],
    ['INV No', 12, (r) => r.invNo],
    ['DIS No', 10, (r) => r.disNo],
    ['DN No', 13, (r) => r.dnNo],
    ['Clear Fee', 11, (r) => Number(r.clearFee)],
    ['THC', 10, (r) => Number(r.thc)],
    ['Other Pay', 10, (r) => Number(r.otherPay)],
    ['CM', 8, (r) => Number(r.commission)],
    ['INV (Revenue)', 13, (r) => Number(r.invRevenue)],
    ['DIS', 10, (r) => Number(r.disTotal)],
    ['VAT 10%', 10, (r) => Number(r.vat)],
    ['DN Total', 11, (r) => Number(r.dnTotal)],
    ['Net Profit', 12, (r) => Number(r.netProfit)],
    ['Chea', 9, (r) => r.cheaStatus],
    ['Mark', 18, (r) => r.mark],
  ];
  ws.columns = cols.map(([header, width]) => ({ header, width }));
  ws.getRow(1).font = { bold: true };
  data.forEach((r) => ws.addRow(cols.map(([, , f]) => f(r))));
  const t = ws.addRow([
    'TOTAL',
    '',
    '',
    '',
    '',
    '',
    '',
    Number(totals.clearFee),
    Number(totals.thc),
    Number(totals.otherPay),
    Number(totals.commission),
    Number(totals.invRevenue),
    Number(totals.disTotal),
    Number(totals.vat),
    Number(totals.dnTotal),
    Number(totals.netProfit),
  ]);
  t.font = { bold: true };
  for (let i = 8; i <= 16; i++) ws.getColumn(i).numFmt = '#,##0.00';
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', attachmentName(`monthly-ledger-${q.month ?? 'all'}.xlsx`));
  await wb.xlsx.write(res);
  res.end();
});

accountingRouter.get('/ledger/:id', async (req, res) =>
  res.json(await ledger.getLedger(parse(idParam, req.params).id)),
);
accountingRouter.post('/ledger', requirePermission('accounting:write'), async (req, res) => {
  const id = await ledger.createLedger(parse(ledgerInputSchema, req.body), req);
  res.status(201).json(await ledger.getLedger(id));
});
accountingRouter.patch('/ledger/:id', requirePermission('accounting:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  await ledger.updateLedger(id, parse(ledgerUpdateSchema, req.body), req);
  res.json(await ledger.getLedger(id));
});
accountingRouter.delete('/ledger/:id', requirePermission('accounting:write'), async (req, res) => {
  await ledger.deleteLedger(parse(idParam, req.params).id, req);
  res.status(204).end();
});

/* ---------- Billing documents (one set of routes for all five types) ---------- */
accountingRouter.get('/docs/:type', async (req, res) => {
  const { type } = parse(typeParam, req.params);
  res.json(await docs.listDocs(type, parse(billingDocListQuerySchema, req.query)));
});
accountingRouter.get('/docs/:type/prefill', async (req, res) => {
  const { type } = parse(typeParam, req.params);
  const { recordId } = parse(
    z.object({ recordId: z.string().uuid('Choose a ledger entry') }),
    req.query,
  );
  res.json(await prefill(type, recordId));
});
accountingRouter.get('/docs/:type/:id', async (req, res) => {
  const { type } = parse(typeParam, req.params);
  res.json(await docs.getDoc(type, parse(idParam, req.params).id));
});
accountingRouter.post('/docs/:type', requirePermission('accounting:write'), async (req, res) => {
  const { type } = parse(typeParam, req.params);
  const input = parse(BILLING_DOC_SCHEMAS[type] as z.ZodType, req.body) as Parameters<
    typeof docs.createDoc
  >[1];
  const id = await docs.createDoc(type, input, req);
  res.status(201).json(await docs.getDoc(type, id));
});
accountingRouter.put('/docs/:type/:id', requirePermission('accounting:write'), async (req, res) => {
  const { type } = parse(typeParam, req.params);
  const { id } = parse(idParam, req.params);
  await docs.updateDoc(
    type,
    id,
    parse(BILLING_DOC_SCHEMAS[type] as z.ZodType, req.body) as Parameters<typeof docs.updateDoc>[2],
    req,
  );
  res.json(await docs.getDoc(type, id));
});
accountingRouter.post(
  '/docs/:type/:id/issue',
  requirePermission('accounting:write'),
  async (req, res) => {
    const { type } = parse(typeParam, req.params);
    const { id } = parse(idParam, req.params);
    await docs.issueDoc(type, id, req);
    res.json(await docs.getDoc(type, id));
  },
);
accountingRouter.post(
  '/docs/:type/:id/void',
  requirePermission('accounting:write'),
  async (req, res) => {
    const { type } = parse(typeParam, req.params);
    const { id } = parse(idParam, req.params);
    const { reason } = parse(
      z.object({ reason: z.string().trim().min(3, 'Give a reason for voiding').max(300) }),
      req.body,
    );
    await docs.voidDoc(type, id, reason, req);
    res.json(await docs.getDoc(type, id));
  },
);
accountingRouter.delete(
  '/docs/:type/:id',
  requirePermission('accounting:write'),
  async (req, res) => {
    const { type } = parse(typeParam, req.params);
    await docs.deleteDoc(type, parse(idParam, req.params).id, req);
    res.status(204).end();
  },
);

accountingRouter.get('/docs/:type/:id/export.xlsx', async (req, res) => {
  const { type } = parse(typeParam, req.params) as { type: BillingDocType };
  const d = await docs.getDoc(type, parse(idParam, req.params).id);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(BILLING_DOC_LABEL[type]);
  ws.addRow([
    `GRATEFUL SOLUTIONS (CAMBODIA) CO., LTD. — ${BILLING_DOC_LABEL[type].toUpperCase()}`,
  ]).font = { bold: true, size: 13 };
  ws.addRow([]);
  ws.addRow(['No.', d.number ?? '-', 'Date', d.date, 'Status', d.status]);
  ws.addRow(['Client', d.clientName, 'Declare No', d.declareNo ?? '-']);
  for (const [k, v] of Object.entries(d.header))
    if (v && !/Id$|^number$/.test(k))
      ws.addRow([k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), v]);
  ws.addRow([]);
  const tax = type === 'tax-invoices';
  const head = ws.addRow([
    'No',
    'Description',
    'Qty',
    'Unit',
    'Unit Price',
    'Sub Total',
    ...(tax ? ['VAT 10%', 'Amount'] : ['Mark']),
  ]);
  head.font = { bold: true };
  d.lines.forEach((l) =>
    ws.addRow([
      l.lineNo,
      l.description,
      Number(l.qty),
      l.unit,
      Number(l.unitPrice),
      Number(l.subtotal),
      ...(tax ? [Number(l.vat), Number(l.amount)] : [l.mark]),
    ]),
  );
  ws.addRow([]);
  if (tax) {
    ws.addRow([
      '',
      'SUB TOTAL',
      '',
      '',
      'USD',
      Number(d.totals.subtotal),
      'KHR',
      Number(d.totals.subtotalKhr),
    ]);
    ws.addRow(['', 'VAT 10%', '', '', 'USD', Number(d.totals.vat), 'KHR', Number(d.totals.vatKhr)]);
  }
  ws.addRow([
    '',
    'GRAND TOTAL',
    '',
    '',
    'USD',
    Number(d.totals.total),
    ...(d.totals.totalKhr ? ['KHR', Number(d.totals.totalKhr)] : []),
  ]).font = { bold: true };
  ws.getColumn(2).width = 52;
  [5, 6, 7, 8].forEach((c) => (ws.getColumn(c).width = 14));
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', attachmentName(`${d.number ?? type}.xlsx`));
  await wb.xlsx.write(res);
  res.end();
});
