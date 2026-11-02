import { eq, sql } from 'drizzle-orm';
import {
  fromCents,
  toCents,
  toMoneyString,
  type ClearFeePayment,
  type ClearFeePaymentMonth,
  clearFeePaymentInputSchema,
  clearFeePaymentUpdateSchema,
} from '@gs/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { db } from '../../db/client';
import { clearFeePayments } from '../../db/schema';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { queryRows } from '../../lib/listing';
import { clientCondition } from '../../lib/clientScope';

/** A ledger month's clear fee total, the payments made to Chea against it and the balance. */
export async function clearFeeMonth(
  month: string,
  clientIds?: string[],
): Promise<ClearFeePaymentMonth> {
  const start = `${month}-01`;
  const scoped = clientCondition(sql`a.client_id`, clientIds);
  const [fee] = await queryRows<{ total: string }>(
    db,
    sql`
    SELECT coalesce(sum(a.clear_fee), 0)::text AS total FROM accounting_records a
    WHERE a.inv_date >= ${start}::date AND a.inv_date < (${start}::date + interval '1 month')
      ${scoped ? sql`AND ${scoped}` : sql``}`,
  );
  const payments = await queryRows<ClearFeePayment>(
    db,
    sql`
    SELECT p.id, to_char(p.paid_on, 'YYYY-MM-DD') AS "paidOn", p.amount::text AS amount, p.remark,
           u.full_name AS "createdByName"
    FROM clear_fee_payments p LEFT JOIN users u ON u.id = p.created_by_id
    WHERE p.period_month = ${start}::date
    ORDER BY p.paid_on, p.created_at`,
  );
  const paidC = payments.reduce((s, p) => s + toCents(p.amount), 0);
  return {
    month,
    clearFee: toMoneyString(fee!.total),
    paid: toMoneyString(fromCents(paidC)),
    balance: toMoneyString(fromCents(toCents(fee!.total) - paidC)),
    payments,
  };
}

export async function createClearFeePayment(
  input: z.output<typeof clearFeePaymentInputSchema>,
  req: Request,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(clearFeePayments)
      .values({
        periodMonth: `${input.month}-01`,
        paidOn: input.paidOn,
        amount: input.amount!, // required by the schema (allowEmpty: false)
        remark: input.remark,
        createdById: req.auth!.userId,
        updatedById: req.auth!.userId,
      })
      .returning();
    await audit(
      tx,
      { action: 'CREATE', entity: 'clear_fee_payment', entityId: row!.id, after: row },
      req,
    );
  });
}

export async function updateClearFeePayment(
  id: string,
  patch: z.output<typeof clearFeePaymentUpdateSchema>,
  req: Request,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(clearFeePayments)
      .where(eq(clearFeePayments.id, id))
      .for('update');
    if (!before) throw notFound('Payment');
    const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const [after] = await tx
      .update(clearFeePayments)
      .set({ ...values, updatedById: req.auth!.userId })
      .where(eq(clearFeePayments.id, id))
      .returning();
    await audit(
      tx,
      { action: 'UPDATE', entity: 'clear_fee_payment', entityId: id, before, after },
      req,
    );
  });
}

export async function deleteClearFeePayment(id: string, req: Request): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx
      .delete(clearFeePayments)
      .where(eq(clearFeePayments.id, id))
      .returning();
    if (!before) throw notFound('Payment');
    await audit(tx, { action: 'DELETE', entity: 'clear_fee_payment', entityId: id, before }, req);
  });
}
