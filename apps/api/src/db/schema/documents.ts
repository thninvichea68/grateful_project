import {
  pgTable,
  text,
  uuid,
  bigint,
  integer,
  boolean,
  index,
  check,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  id,
  timestamps,
  softDelete,
  documentCategoryEnum,
  followUpPriorityEnum,
  followUpStatusEnum,
} from './_common';
import { users } from './auth';
import { clients } from './reference';
import { shipments } from './shipments';
import { creditNotes, recordSummaries } from './accounting';

/** File metadata. The bytes live in storage (disk volume or S3), keyed by storage_key. */
export const documents = pgTable(
  'documents',
  {
    id: id(),
    title: text('title').notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull().unique(),
    sha256: text('sha256').notNull(),
    category: documentCategoryEnum('category').notNull().default('OTHER'),
    statusLabel: text('status_label'),
    shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'set null' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    /** Support documents of a credit note or record summary. */
    creditNoteId: uuid('credit_note_id').references(() => creditNotes.id, {
      onDelete: 'set null',
    }),
    recordSummaryId: uuid('record_summary_id').references(() => recordSummaries.id, {
      onDelete: 'set null',
    }),
    /** Grateful's own files (Settings → Workspace & company → Attachments). */
    company: boolean('company').notNull().default(false),
    uploadedById: uuid('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('documents_shipment_idx').on(t.shipmentId),
    index('documents_credit_note_idx').on(t.creditNoteId),
    index('documents_record_summary_idx').on(t.recordSummaryId),
    index('documents_client_idx').on(t.clientId),
    index('documents_category_idx').on(t.category),
  ],
);

export const milestoneRules = pgTable(
  'milestone_rules',
  {
    id: id(),
    mode: text('mode').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    sequence: integer('sequence').notNull(),
    anchorCode: text('anchor_code').notNull(),
    offsetValue: integer('offset_value').notNull().default(0),
    offsetUnit: text('offset_unit').notNull().default('DAYS'),
    ownerRole: text('owner_role').notNull(),
    completionField: text('completion_field'),
    remindBefore: integer('remind_before').notNull().default(0),
    escalateAfter: integer('escalate_after').notNull().default(1),
    skipWhenClearedByOther: boolean('skip_when_cleared_by_other').notNull().default(false),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('milestone_rules_mode_code_unique').on(t.mode, t.code),
    index('milestone_rules_mode_sequence_idx').on(t.mode, t.sequence),
    check(
      'milestone_rules_mode_check',
      sql`${t.mode} IN ('SEA_IMPORT', 'SEA_EXPORT', 'AIR_IMPORT', 'AIR_EXPORT')`,
    ),
    check('milestone_rules_offset_unit_check', sql`${t.offsetUnit} IN ('DAYS', 'HOURS')`),
  ],
);

export const followUps = pgTable(
  'follow_ups',
  {
    id: id(),
    reference: text('reference').notNull(),
    subject: text('subject').notNull(),
    notes: text('notes'),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'set null' }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    milestoneRuleId: uuid('milestone_rule_id').references(() => milestoneRules.id, {
      onDelete: 'set null',
    }),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    plannedAt: timestamp('planned_at', { withTimezone: true }),
    actualAt: timestamp('actual_at', { withTimezone: true }),
    priority: followUpPriorityEnum('priority').notNull().default('MEDIUM'),
    status: followUpStatusEnum('status').notNull().default('OPEN'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedById: uuid('completed_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('follow_ups_reference_unique').on(t.reference),
    index('follow_ups_open_due_idx')
      .on(t.dueAt)
      .where(sql`${t.status} <> 'DONE' AND ${t.deletedAt} IS NULL`),
    index('follow_ups_assignee_idx').on(t.assigneeId),
    uniqueIndex('follow_ups_shipment_milestone_unique')
      .on(t.shipmentId, t.milestoneRuleId)
      .where(
        sql`${t.milestoneRuleId} IS NOT NULL AND ${t.shipmentId} IS NOT NULL AND ${t.deletedAt} IS NULL`,
      ),
  ],
);
