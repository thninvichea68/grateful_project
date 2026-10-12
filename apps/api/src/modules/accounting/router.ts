import { Router, type RequestHandler } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import {
  BILLING_DOC_LABEL,
  BILLING_DOC_SCHEMAS,
  BILLING_DOC_TYPES,
  billingDocListQuerySchema,
  creditNoteListQuerySchema,
  creditNoteReviewInputSchema,
  creditNoteReviewQuerySchema,
  ledgerInputSchema,
  ledgerListQuerySchema,
  ledgerUpdateSchema,
  type BillingDocType,
} from '@gs/shared';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { notFound } from '../../lib/errors';
import { attachmentName } from '../../lib/http';
import * as ledger from './ledger';
import * as docs from './docs';
import { creditNotePrefill, prefill } from './prefill';
import {
  allowedClients,
  assertClientAllowed,
  assertClientVisible,
  scopeClients,
} from '../../lib/clientScope';

const idParam = z.object({ id: z.string().uuid('Invalid id') });
const typeParam = z.object({
  type: z.enum(BILLING_DOC_TYPES, { message: 'Unknown document type' }),
});

export const accountingRouter = Router();
accountingRouter.use(requireAuth);

/**
 * Credit Noted (the customs broker's vouchers) has its own permissions so a broker can work
 * on it without seeing the rest of accounting; everything else needs accounting access.
 */
const isCreditNotes = (path: string) =>
  path.startsWith('/docs/credit-notes') || path.startsWith('/credit-notes/');
accountingRouter.use((req, res, next) =>
  requirePermission(isCreditNotes(req.path) ? 'creditnotes:read' : 'accounting:read')(
    req,
    res,
    next,
  ),
);
/** Writing a document: credit notes need creditnotes:write, the others accounting:write. */
const docWrite: RequestHandler = (req, res, next) =>
  requirePermission(req.params.type === 'credit-notes' ? 'creditnotes:write' : 'accounting:write')(
    req,
    res,
    next,
  );

// Every /:id route (ledger entries and billing documents): a record of a client this user
// can't see looks like it doesn't exist.
accountingRouter.param('id', async (req, _res, next, id: string) => {
  try {
    if (allowedClients(req) && z.string().uuid().safeParse(id).success) {
      const type = req.params.type as BillingDocType | undefined;
      const clientId =
        type && BILLING_DOC_TYPES.includes(type)
          ? (await docs.getDoc(type, id)).clientId
          : (await ledger.getLedger(id)).clientId;
      assertClientVisible(req, clientId, type ? 'Document' : 'Ledger entry');
    }
    next();
  } catch (err) {
    next(err);
  }
});

/* ---------- Monthly ledger ---------- */
accountingRouter.get('/ledger', async (req, res) =>
  res.json(
    await ledger.listLedger({
      ...parse(ledgerListQuerySchema, req.query),
      clientIds: scopeClients(req),
    }),
  ),
);
accountingRouter.get('/declarations', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().max(60).optional() }), req.query);
  res.json(await ledger.declarationOptions(q, scopeClients(req)));
});

accountingRouter.get('/ledger/export.xlsx', async (req, res) => {
  const q = parse(ledgerListQuerySchema, { ...req.query, page: 1 });
  const period = q.month ?? q.year ?? 'all';
  // Every matching row (a full year can exceed one page), not just the first page.
  const { data, totals } = await ledger.listLedger({
    ...q,
    clientIds: scopeClients(req),
    pageSize: 100_000,
    sort: 'invDate',
  });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Ledger ${period}`, {
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
  res.setHeader(
    'Content-Disposition',
    attachmentName(`${q.month ? 'monthly' : q.year ? 'yearly' : 'full'}-ledger-${period}.xlsx`),
  );
  await wb.xlsx.write(res);
  res.end();
});

accountingRouter.get('/ledger/:id', async (req, res) =>
  res.json(await ledger.getLedger(parse(idParam, req.params).id)),
);
accountingRouter.post('/ledger', requirePermission('accounting:write'), async (req, res) => {
  const input = parse(ledgerInputSchema, req.body);
  if (allowedClients(req))
    assertClientAllowed(req, await ledger.declarationClientId(input.declarationId));
  const id = await ledger.createLedger(input, req);
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

/** Declarations to start a Credit Noted from (any declaration, ledger row or not). */
accountingRouter.get('/credit-notes/declarations', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().max(60).optional() }), req.query);
  res.json(await ledger.creditNoteDeclarations(q, scopeClients(req)));
});

/** Accounting's check of submitted credit notes: an accounting page, not the broker's. */
accountingRouter.get(
  '/credit-notes/review',
  requirePermission('accounting:read'),
  async (req, res) => {
    const q = parse(creditNoteReviewQuerySchema, req.query);
    if (q.clientId) assertClientAllowed(req, q.clientId);
    res.json(await docs.listCreditNoteReview({ ...q, clientIds: scopeClients(req) }));
  },
);
/** Sidebar → Credit Noted: every credit note (drafts too) with shipment details. */
accountingRouter.get('/credit-notes/list', async (req, res) => {
  const q = parse(creditNoteListQuerySchema, req.query);
  if (q.clientId) assertClientAllowed(req, q.clientId);
  res.json(
    await docs.listCreditNoteReview({ ...q, allStatuses: true, clientIds: scopeClients(req) }),
  );
});
accountingRouter.patch(
  '/docs/:type/:id/review',
  requirePermission('accounting:write'),
  async (req, res) => {
    const { type } = parse(typeParam, req.params);
    if (type !== 'credit-notes') throw notFound('Document');
    const { id } = parse(idParam, req.params);
    const { reviewStatus, message } = parse(creditNoteReviewInputSchema, req.body);
    await docs.setCreditNoteReview(id, reviewStatus, message, req);
    res.status(204).end();
  },
);

/** Accounting's messages about one credit note (the editor shows the latest one). */
accountingRouter.get('/docs/:type/:id/messages', async (req, res) => {
  const { type } = parse(typeParam, req.params);
  if (type !== 'credit-notes') throw notFound('Document');
  const { id } = parse(idParam, req.params);
  res.json(await docs.creditNoteMessagesFor(id));
});

/* The broker's Credit Noted inbox: messages from accounting addressed to me. */
accountingRouter.get('/credit-notes/inbox', async (req, res) => {
  res.json(await docs.creditNoteInbox(req.auth!.userId));
});
accountingRouter.post('/credit-notes/inbox/read', async (req, res) => {
  const { messageId } = parse(z.object({ messageId: z.string().uuid().optional() }), req.body);
  await docs.markCreditNoteMessagesRead(req.auth!.userId, messageId);
  res.status(204).end();
});

/* ---------- Billing documents (one set of routes for all five types) ---------- */
accountingRouter.get('/docs/:type', async (req, res) => {
  const { type } = parse(typeParam, req.params);
  res.json(
    await docs.listDocs(type, {
      ...parse(billingDocListQuerySchema, req.query),
      clientIds: scopeClients(req),
    }),
  );
});
accountingRouter.get('/docs/:type/prefill', async (req, res) => {
  const { type } = parse(typeParam, req.params);
  if (type === 'credit-notes' && typeof req.query.declarationId === 'string') {
    const { declarationId } = parse(
      z.object({ declarationId: z.string().uuid('Choose a declaration') }),
      req.query,
    );
    const draft = await creditNotePrefill(declarationId);
    assertClientVisible(req, draft.clientId as string, 'Declaration');
    return void res.json(draft);
  }
  const { recordId } = parse(
    z.object({ recordId: z.string().uuid('Choose a ledger entry') }),
    req.query,
  );
  if (allowedClients(req))
    assertClientVisible(req, (await ledger.getLedger(recordId)).clientId, 'Ledger entry');
  res.json(await prefill(type, recordId));
});
accountingRouter.get('/docs/:type/:id', async (req, res) => {
  const { type } = parse(typeParam, req.params);
  res.json(await docs.getDoc(type, parse(idParam, req.params).id));
});
accountingRouter.post('/docs/:type', docWrite, async (req, res) => {
  const { type } = parse(typeParam, req.params);
  const input = parse(BILLING_DOC_SCHEMAS[type] as z.ZodType, req.body) as Parameters<
    typeof docs.createDoc
  >[1];
  assertClientAllowed(req, input.clientId);
  const id = await docs.createDoc(type, input, req);
  res.status(201).json(await docs.getDoc(type, id));
});
accountingRouter.put('/docs/:type/:id', docWrite, async (req, res) => {
  const { type } = parse(typeParam, req.params);
  const { id } = parse(idParam, req.params);
  const input = parse(BILLING_DOC_SCHEMAS[type] as z.ZodType, req.body) as Parameters<
    typeof docs.updateDoc
  >[2];
  assertClientAllowed(req, input.clientId);
  await docs.updateDoc(type, id, input, req);
  res.json(await docs.getDoc(type, id));
});
accountingRouter.post('/docs/:type/:id/issue', docWrite, async (req, res) => {
  const { type } = parse(typeParam, req.params);
  const { id } = parse(idParam, req.params);
  await docs.issueDoc(type, id, req);
  res.json(await docs.getDoc(type, id));
});
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
accountingRouter.delete('/docs/:type/:id', docWrite, async (req, res) => {
  const { type } = parse(typeParam, req.params);
  await docs.deleteDoc(type, parse(idParam, req.params).id, req);
  res.status(204).end();
});

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
