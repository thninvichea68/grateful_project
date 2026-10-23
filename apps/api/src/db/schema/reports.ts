import { integer, jsonb, pgTable, text, uniqueIndex, uuid, index, char } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { PayrollMonthDetail } from '@gs/shared';
import { id, money, timestamps } from './_common';
import { users } from './auth';
import { clients } from './reference';

/**
 * Reports → Payroll: a month's imported payroll, saved so it can be listed and reopened. One
 * per company and month; saving the month again replaces it. The staff rows (with each
 * person's pay) are kept as imported; the totals are copied out for the list.
 */
export const payrollMonths = pgTable(
  'payroll_months',
  {
    id: id(),
    /** "2026-07". */
    period: char('period', { length: 7 }).notNull(),
    company: text('company').notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    sheetName: text('sheet_name').notNull().default(''),
    fileName: text('file_name').notNull().default(''),
    staffCount: integer('staff_count').notNull(),
    female: integer('female').notNull(),
    male: integer('male').notNull(),
    gross: money('gross').notNull(),
    net: money('net').notNull(),
    sections: jsonb('sections').$type<string[]>().notNull().default([]),
    staff: jsonb('staff').$type<PayrollMonthDetail['staff']>().notNull(),
    issues: jsonb('issues').$type<PayrollMonthDetail['issues']>().notNull().default([]),
    savedById: uuid('saved_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('payroll_months_company_period_unique').on(sql`upper(${t.company})`, t.period),
    index('payroll_months_period_idx').on(t.period),
  ],
);
