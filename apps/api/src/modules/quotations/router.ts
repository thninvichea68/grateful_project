import { Router, type Request } from 'express';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  decimal,
  hasPermission,
  parseChargeLines,
  quotationInputSchema,
  quotationListQuerySchema,
  toEnglish,
  type QuotationDetail,
  type QuotationRow,
  type QuotationTemplate,
} from '@gs/shared';
import { db, type Tx } from '../../db/client';
import {
  clients,
  quotationCharges,
  quotationLines,
  quotations,
  quotationTemplates,
} from '../../db/schema';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { badRequest, businessRule, conflict, notFound } from '../../lib/errors';
import { excelUpload, requireFile } from '../../lib/http';
import { likePattern, paginate, queryRows, toPaginated, whereAll } from '../../lib/listing';
import { nextNumber } from '../../lib/numbering';
import { parseQuotationWorkbook } from './import';
import {
  allowedClients,
  assertClientAllowed,
  assertClientVisible,
  clientCondition,
  scopeClients,
} from '../../lib/clientScope';

type Input = z.output<typeof quotationInputSchema>;
const idParam = z.object({ id: z.string().uuid() });
export const quotationsRouter = Router();
quotationsRouter.use(requireAuth, requirePermission('quotations:read'));
const write = requirePermission('quotations:write');

// Every /:id route: a quotation of a client this user can't see looks like it doesn't exist.
quotationsRouter.param('id', async (req, _res, next, id: string) => {
  try {
    if (allowedClients(req) && z.string().uuid().safeParse(id).success) {
      const [q] = await db
        .select({ clientId: quotations.clientId })
        .from(quotations)
        .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)));
      if (q) assertClientVisible(req, q.clientId, 'Quotation');
    }
    next();
  } catch (err) {
    next(err);
  }
});

quotationsRouter.get('/templates', async (_req, res) => {
  res.json(
    (await db
      .select()
      .from(quotationTemplates)
      .orderBy(asc(quotationTemplates.sortOrder))) as unknown as QuotationTemplate[],
  );
});

quotationsRouter.get('/', async (req, res) => {
  const q = parse(quotationListQuerySchema, req.query);
  const c = [sql`qt.deleted_at IS NULL`];
  if (q.status) c.push(sql`qt.status = ${q.status}`);
  if (q.clientId) c.push(sql`qt.client_id = ${q.clientId}`);
  const scoped = clientCondition(sql`qt.client_id`, scopeClients(req));
  if (scoped) c.push(scoped);
  if (q.templateKey) c.push(sql`qt.template_key = ${q.templateKey}`);
  if (q.latestOnly)
    c.push(
      sql`NOT EXISTS (SELECT 1 FROM quotations n WHERE n.quote_no = qt.quote_no AND n.version > qt.version AND n.deleted_at IS NULL)`,
    );
  if (q.q) {
    const like = likePattern(q.q);
    c.push(sql`(qt.quote_no ILIKE ${like} OR qt.to_name ILIKE ${like} OR c.name ILIKE ${like})`);
  }
  const rows = await queryRows<QuotationRow & { total_count: string }>(
    db,
    sql`
    SELECT qt.id, qt.quote_no AS "quoteNo", qt.version, qt.status, qt.template_key AS "templateKey", t.label AS "templateLabel",
           qt.client_id AS "clientId", c.name AS "clientName", qt.to_name AS "toName", to_char(qt.quote_date, 'YYYY-MM-DD') AS "quoteDate",
           (SELECT count(*) FROM quotation_lines l WHERE l.quotation_id = qt.id)::int AS "lineCount",
           (SELECT count(*) FROM quotation_charges x WHERE x.quotation_id = qt.id)::int AS "chargeCount",
           NOT EXISTS (SELECT 1 FROM quotations n WHERE n.quote_no = qt.quote_no AND n.version > qt.version AND n.deleted_at IS NULL) AS "isLatest",
           count(*) OVER () AS total_count
    FROM quotations qt JOIN quotation_templates t ON t.key = qt.template_key LEFT JOIN clients c ON c.id = qt.client_id
    ${whereAll(c)} ORDER BY qt.quote_date DESC, qt.quote_no DESC, qt.version DESC ${paginate(q.page, q.pageSize)}`,
  );
  res.json(toPaginated(rows, q.page, q.pageSize));
});

quotationsRouter.post('/import', write, excelUpload, async (req, res) => {
  const { clientId, preview } = parse(
    z.object({
      clientId: z.string().uuid(),
      preview: z.preprocess(
        (value) =>
          value === true || value === 'true'
            ? true
            : value === false || value === 'false'
              ? false
              : value,
        z.boolean().default(false),
      ),
    }),
    req.body,
  );
  if (allowedClients(req)) assertClientAllowed(req, clientId);
  const file = requireFile(req.file);
  if (!/\.xlsx$/i.test(file.originalname)) throw badRequest('Upload an .xlsx workbook');

  const workbook = await parseQuotationWorkbook(file.buffer);
  const [client] = await db
    .select({ name: clients.name, legalName: clients.legalName })
    .from(clients)
    .where(eq(clients.id, clientId));
  if (!client) throw notFound('Client');

  if (preview) {
    const duplicates: string[] = [];
    for (const quote of workbook.quotations) {
      const [existing] = await db
        .select({ id: quotations.id })
        .from(quotations)
        .where(
          and(
            eq(quotations.clientId, clientId),
            eq(quotations.templateKey, quote.templateKey),
            eq(quotations.quoteDate, quote.quoteDate),
            isNull(quotations.deletedAt),
          ),
        )
        .limit(1);
      if (existing) duplicates.push(quote.sourceSheet);
    }
    return res.json({
      preview: true,
      quoteDate: workbook.metadata.quoteDate,
      toName: workbook.metadata.toName ?? client.legalName ?? client.name,
      duplicates,
      quotations: workbook.quotations.map((quote) => ({
        templateKey: quote.templateKey,
        sourceSheet: quote.sourceSheet,
        lineCount: quote.lines.length,
      })),
    });
  }

  const created = await db.transaction(async (tx) => {
    const result: {
      id: string;
      quoteNo: string;
      templateKey: string;
      quoteDate: string;
      sourceSheet: string;
    }[] = [];
    for (const quote of workbook.quotations) {
      await assertTemplate(tx, quote.templateKey);
      const [existing] = await tx
        .select({ id: quotations.id })
        .from(quotations)
        .where(
          and(
            eq(quotations.clientId, clientId),
            eq(quotations.templateKey, quote.templateKey),
            eq(quotations.quoteDate, quote.quoteDate),
            isNull(quotations.deletedAt),
          ),
        )
        .limit(1);
      if (existing)
        throw conflict(
          `A ${quote.templateKey} quotation for this client and date already exists. Edit or revise the existing quote instead.`,
        );

      const input = parse(quotationInputSchema, {
        templateKey: quote.templateKey,
        clientId,
        toName: quote.toName ?? client.legalName ?? client.name,
        attn: quote.attn,
        quoteDate: quote.quoteDate,
        paymentTermDays: quote.paymentTermDays,
        latePenaltyPctPerDay: null,
        // The notes become the extra-charges list (English only).
        notes: null,
        lines: quote.lines,
        charges: parseChargeLines(quote.notes),
      });
      const year = input.quoteDate.slice(0, 4);
      const quoteNo = `Q${year.slice(2)}-${String(await nextNumber(tx, `QUOTATION:${year}`)).padStart(3, '0')}`;
      const [row] = await tx
        .insert(quotations)
        .values({
          ...header(input),
          quoteNo,
          version: 1,
          status: 'ACCEPTED',
          createdById: req.auth!.userId,
        })
        .returning();
      await writeLines(tx, row!.id, input);
      await audit(
        tx,
        {
          action: 'CREATE',
          entity: 'quotation',
          entityId: row!.id,
          after: {
            ...row,
            lines: input.lines,
            importedFrom: file.originalname,
            sourceSheet: quote.sourceSheet,
          },
        },
        req,
      );
      result.push({
        id: row!.id,
        quoteNo: row!.quoteNo,
        templateKey: quote.templateKey,
        quoteDate: quote.quoteDate,
        sourceSheet: quote.sourceSheet,
      });
    }
    return result;
  });

  res.status(201).json({ created: created.length, quotations: created });
});

/** Costs and margins: only with quotations:cost (Sales Manager); others see client prices. */
const canCost = (req: Request) => hasPermission(req.auth?.permissions ?? [], 'quotations:cost');

async function getDetail(id: string, withCost = false): Promise<QuotationDetail> {
  const [q] = await queryRows<
    Omit<QuotationDetail, 'lines' | 'charges' | 'versions' | 'columns'> & {
      columns: QuotationDetail['columns'];
    }
  >(
    db,
    sql`
    SELECT qt.id, qt.quote_no AS "quoteNo", qt.version, qt.status, qt.template_key AS "templateKey", t.label AS "templateLabel", t.doc_title AS "docTitle",
           t.columns, qt.client_id AS "clientId", c.name AS "clientName", qt.to_name AS "toName", qt.attn, to_char(qt.quote_date, 'YYYY-MM-DD') AS "quoteDate",
           qt.payment_term_days AS "paymentTermDays", qt.late_penalty_pct_per_day::text AS "latePenaltyPctPerDay", qt.notes
    FROM quotations qt JOIN quotation_templates t ON t.key = qt.template_key LEFT JOIN clients c ON c.id = qt.client_id
    WHERE qt.id = ${id} AND qt.deleted_at IS NULL`,
  );
  if (!q) throw notFound('Quotation');
  const lines = await db
    .select()
    .from(quotationLines)
    .where(eq(quotationLines.quotationId, id))
    .orderBy(asc(quotationLines.lineNo));
  const charges = await queryRows<QuotationDetail['charges'][number]>(
    db,
    sql`SELECT description, amount::text AS amount, unit, remark, cost::text AS cost FROM quotation_charges
        WHERE quotation_id = ${id} ORDER BY line_no`,
  );
  if (!withCost) for (const c of charges) delete c.cost;
  const versions = await queryRows<QuotationDetail['versions'][number]>(
    db,
    sql`
    SELECT id, version, status, to_char(quote_date, 'YYYY-MM-DD') AS "quoteDate" FROM quotations
    WHERE quote_no = ${q.quoteNo} AND deleted_at IS NULL ORDER BY version DESC`,
  );
  return {
    ...q,
    lines: lines.map((l) => l.cells),
    ...(withCost ? { costs: lines.map((l) => l.costs ?? {}) } : {}),
    charges,
    versions,
  };
}

/** Numeric value of a price cell when it is a plain number ("60" → 60, "As per receipt" → none). */
function amounts(cells: Record<string, string>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(cells)
      .filter(([, v]) => /^\d+(\.\d+)?$/.test(v.trim().replace(/,/g, '')))
      .map(([k, v]) => [k, Number(v.replace(/,/g, ''))]),
  );
}

/** The rates and the extra charges, in English only (any Chinese is dropped). */
async function writeLines(tx: Tx, quotationId: string, input: Input, withCost = false) {
  // Without quotations:cost the costs already set stay as they were (by row, by charge name).
  const oldLines = withCost
    ? []
    : await tx
        .select({ costs: quotationLines.costs })
        .from(quotationLines)
        .where(eq(quotationLines.quotationId, quotationId))
        .orderBy(asc(quotationLines.lineNo));
  const oldCharges = withCost
    ? []
    : await tx
        .select({ description: quotationCharges.description, cost: quotationCharges.cost })
        .from(quotationCharges)
        .where(eq(quotationCharges.quotationId, quotationId));
  await tx.delete(quotationLines).where(eq(quotationLines.quotationId, quotationId));
  const rows = input.lines
    .map((l, i) => ({
      cells: Object.fromEntries(Object.entries(l).map(([k, v]) => [k, toEnglish(v)])),
      costs: withCost
        ? Object.fromEntries(Object.entries(input.costs?.[i] ?? {}).filter(([, v]) => v.trim()))
        : (oldLines[i]?.costs ?? {}),
    }))
    .filter((l) => Object.values(l.cells).some((v) => v.trim()));
  await tx.delete(quotationCharges).where(eq(quotationCharges.quotationId, quotationId));
  const charges = input.charges
    .map((c) => ({
      description: toEnglish(c.description),
      amount: c.amount,
      unit: c.unit ? toEnglish(c.unit) || null : null,
      remark: c.remark ? toEnglish(c.remark) || null : null,
      cost: withCost
        ? (c.cost ?? null)
        : (oldCharges.find((o) => o.description === toEnglish(c.description))?.cost ?? null),
    }))
    .filter((c) => c.description);
  if (charges.length)
    await tx
      .insert(quotationCharges)
      .values(charges.map((c, i) => ({ ...c, quotationId, lineNo: i + 1 })));
  if (rows.length)
    await tx.insert(quotationLines).values(
      rows.map(({ cells, costs }, i) => ({
        quotationId,
        lineNo: i + 1,
        cells,
        costs,
        amounts: amounts(cells),
      })),
    );
}

async function assertTemplate(tx: Tx, key: string) {
  const [t] = await tx
    .select({ key: quotationTemplates.key })
    .from(quotationTemplates)
    .where(eq(quotationTemplates.key, key));
  if (!t) throw businessRule('Unknown service category');
}

const header = (v: Input) => ({
  templateKey: v.templateKey,
  clientId: v.clientId,
  toName: v.toName,
  attn: v.attn,
  quoteDate: v.quoteDate,
  paymentTermDays: v.paymentTermDays,
  latePenaltyPctPerDay: v.latePenaltyPctPerDay,
  notes: v.notes ? toEnglish(v.notes) || null : null,
});

quotationsRouter.get('/:id', async (req, res) =>
  res.json(await getDetail(parse(idParam, req.params).id, canCost(req))),
);

quotationsRouter.post('/', write, async (req, res) => {
  const v = parse(quotationInputSchema, req.body);
  if (allowedClients(req)) assertClientAllowed(req, v.clientId);
  const id = await db.transaction(async (tx) => {
    await assertTemplate(tx, v.templateKey);
    const year = v.quoteDate.slice(0, 4);
    const quoteNo = `Q${year.slice(2)}-${String(await nextNumber(tx, `QUOTATION:${year}`)).padStart(3, '0')}`;
    const [row] = await tx
      .insert(quotations)
      .values({ ...header(v), quoteNo, version: 1, createdById: req.auth!.userId })
      .returning();
    await writeLines(tx, row!.id, v, canCost(req));
    await audit(
      tx,
      {
        action: 'CREATE',
        entity: 'quotation',
        entityId: row!.id,
        after: { ...row, lines: v.lines },
      },
      req,
    );
    return row!.id;
  });
  res.status(201).json(await getDetail(id, canCost(req)));
});

quotationsRouter.put('/:id', write, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const v = parse(quotationInputSchema, req.body);
  if (allowedClients(req)) assertClientAllowed(req, v.clientId);
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .for('update');
    if (!before) throw notFound('Quotation');
    if (before.status !== 'DRAFT')
      throw conflict('Only drafts can be edited. Use "Revise" to make a new version.');
    await assertTemplate(tx, v.templateKey);
    await tx.update(quotations).set(header(v)).where(eq(quotations.id, id));
    await writeLines(tx, id, v, canCost(req));
    await audit(tx, { action: 'UPDATE', entity: 'quotation', entityId: id, before, after: v }, req);
  });
  res.json(await getDetail(id, canCost(req)));
});

/**
 * Costs only (Sales Manager): what we pay per rate cell and per extra charge. Internal, so they
 * can be set on any version, sent or accepted too, without a new version for the client.
 */
quotationsRouter.put('/:id/costs', requirePermission('quotations:cost'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const v = parse(
    z.object({
      costs: z.array(z.record(z.string().max(300))),
      chargeCosts: z.array(decimal(2, { min: 0 })),
    }),
    req.body,
  );
  await db.transaction(async (tx) => {
    const [q] = await tx
      .select({ id: quotations.id, clientId: quotations.clientId })
      .from(quotations)
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)));
    if (!q) throw notFound('Quotation');
    if (allowedClients(req)) assertClientAllowed(req, q.clientId);
    const lines = await tx
      .select({ id: quotationLines.id })
      .from(quotationLines)
      .where(eq(quotationLines.quotationId, id))
      .orderBy(asc(quotationLines.lineNo));
    for (const [i, l] of lines.entries())
      await tx
        .update(quotationLines)
        .set({
          costs: Object.fromEntries(Object.entries(v.costs[i] ?? {}).filter(([, x]) => x.trim())),
        })
        .where(eq(quotationLines.id, l.id));
    const charges = await tx
      .select({ id: quotationCharges.id })
      .from(quotationCharges)
      .where(eq(quotationCharges.quotationId, id))
      .orderBy(asc(quotationCharges.lineNo));
    for (const [i, c] of charges.entries())
      await tx
        .update(quotationCharges)
        .set({ cost: v.chargeCosts[i] ?? null })
        .where(eq(quotationCharges.id, c.id));
    await audit(tx, { action: 'UPDATE', entity: 'quotation_costs', entityId: id }, req);
  });
  res.json(await getDetail(id, true));
});

const NEXT: Record<string, string[]> = {
  DRAFT: ['SENT'],
  SENT: ['ACCEPTED', 'DRAFT'],
  ACCEPTED: [],
  SUPERSEDED: [],
};
quotationsRouter.post('/:id/status', write, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const { status } = parse(z.object({ status: z.enum(['DRAFT', 'SENT', 'ACCEPTED']) }), req.body);
  await db.transaction(async (tx) => {
    const [q] = await tx
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .for('update');
    if (!q) throw notFound('Quotation');
    if (!NEXT[q.status]!.includes(status))
      throw conflict(
        `A ${q.status.toLowerCase()} quotation can't be marked ${status.toLowerCase()}`,
      );
    await tx.update(quotations).set({ status }).where(eq(quotations.id, id));
    await audit(
      tx,
      {
        action: 'UPDATE',
        entity: 'quotation',
        entityId: id,
        before: { status: q.status },
        after: { status },
      },
      req,
    );
  });
  res.json(await getDetail(id, canCost(req)));
});

/** New version as a draft copy; the previous version becomes Superseded. */
quotationsRouter.post('/:id/revise', write, async (req, res) => {
  const { id } = parse(idParam, req.params);
  const newId = await db.transaction(async (tx) => {
    const [q] = await tx
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .for('update');
    if (!q) throw notFound('Quotation');
    const [latest] = await queryRows<{ v: number }>(
      tx,
      sql`SELECT max(version)::int AS v FROM quotations WHERE quote_no = ${q.quoteNo} AND deleted_at IS NULL`,
    );
    if (latest!.v !== q.version) throw conflict('Revise the latest version');
    if (q.status === 'DRAFT') throw conflict('This version is still a draft; edit it directly');
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = q;
    const [copy] = await tx
      .insert(quotations)
      .values({
        ...rest,
        version: q.version + 1,
        previousVersionId: q.id,
        status: 'DRAFT',
        createdById: req.auth!.userId,
      })
      .returning();
    const lines = await tx.select().from(quotationLines).where(eq(quotationLines.quotationId, id));
    if (lines.length)
      await tx.insert(quotationLines).values(
        lines.map((l) => ({
          quotationId: copy!.id,
          lineNo: l.lineNo,
          cells: l.cells,
          amounts: l.amounts,
          costs: l.costs,
        })),
      );
    const extras = await tx
      .select()
      .from(quotationCharges)
      .where(eq(quotationCharges.quotationId, id));
    if (extras.length)
      await tx.insert(quotationCharges).values(
        extras.map(({ id: _x, createdAt: _c2, updatedAt: _u2, ...c }) => ({
          ...c,
          quotationId: copy!.id,
        })),
      );
    if (q.status !== 'ACCEPTED')
      await tx.update(quotations).set({ status: 'SUPERSEDED' }).where(eq(quotations.id, id));
    await audit(
      tx,
      {
        action: 'CREATE',
        entity: 'quotation',
        entityId: copy!.id,
        after: { revisedFrom: id, version: copy!.version },
      },
      req,
    );
    return copy!.id;
  });
  res.status(201).json(await getDetail(newId, canCost(req)));
});

quotationsRouter.delete('/:id', write, async (req, res) => {
  const { id } = parse(idParam, req.params);
  await db.transaction(async (tx) => {
    const [q] = await tx
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), isNull(quotations.deletedAt)))
      .for('update');
    if (!q) throw notFound('Quotation');
    // Any version can be deleted (client management); bills already made keep their prices.
    await tx.update(quotations).set({ deletedAt: new Date() }).where(eq(quotations.id, id));
    if (q.previousVersionId)
      await tx
        .update(quotations)
        .set({ status: 'SENT' })
        .where(and(eq(quotations.id, q.previousVersionId), eq(quotations.status, 'SUPERSEDED')));
    await audit(tx, { action: 'DELETE', entity: 'quotation', entityId: id, before: q }, req);
  });
  res.status(204).end();
});
