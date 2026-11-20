import { and, asc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import type { MilestoneMode } from '@gs/shared';
import { db, type Tx } from '../../db/client';
import { followUps, milestoneRules, shipments } from '../../db/schema';
import { formatNumber, nextNumber } from '../../lib/numbering';

type DateValue = Date | string | null | undefined;

export interface MilestoneShipment {
  id: string;
  direction: string;
  transportMode: string;
  clearedBy?: string | null;
  createdAt: DateValue;
  eta?: DateValue;
  ata?: DateValue;
  etd?: DateValue;
  atd?: DateValue;
  crd?: DateValue;
  arriveFty?: DateValue;
  receivedDocumentDate?: DateValue;
  doDate?: DateValue;
  permitDate?: DateValue;
  authorizeDate?: DateValue;
  checkInDate?: DateValue;
  cutOffDate?: DateValue;
  airCutoffAt?: DateValue;
  cyCutoffAt?: DateValue;
  siCutoffAt?: DateValue;
  vgmCutoffAt?: DateValue;
  stuffingDate?: DateValue;
  clientId?: string;
  reference?: string;
}

const ACTUAL_FIELDS = {
  CREATED_AT: 'createdAt',
  ATA: 'ata',
  ATD: 'atd',
  ARRIVE_FTY: 'arriveFty',
  DO_DATE: 'doDate',
  PERMIT_DATE: 'permitDate',
  AUTHORIZE_DATE: 'authorizeDate',
  STUFFING_DATE: 'stuffingDate',
} as const;

export function milestoneModeFor(shipment: Pick<MilestoneShipment, 'direction' | 'transportMode'>) {
  if (shipment.transportMode !== 'SEA' && shipment.transportMode !== 'AIR') return null;
  return `${shipment.transportMode}_${shipment.direction}` as MilestoneMode;
}

function asDate(value: DateValue): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const withZone = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T17:00:00+07:00`
    : /[zZ]|[+-]\d{2}:?\d{2}$/.test(value)
      ? value
      : `${value}+07:00`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateForField(shipment: MilestoneShipment, code: string): Date | null {
  const value = {
    CREATED_AT: shipment.createdAt,
    ETA: shipment.eta,
    ATA: shipment.ata,
    ETD: shipment.etd,
    ATD: shipment.atd,
    CRD: shipment.crd,
    ARRIVE_FTY: shipment.arriveFty,
    RECEIVED_DOCUMENT: shipment.receivedDocumentDate,
    DO_DATE: shipment.doDate,
    CHECKIN: shipment.checkInDate,
    AIR_CUTOFF: shipment.airCutoffAt ?? shipment.cutOffDate,
    CY_CUTOFF: shipment.cyCutoffAt,
    SI_CUTOFF: shipment.siCutoffAt,
    VGM_CUTOFF: shipment.vgmCutoffAt,
    STUFFING_DATE: shipment.stuffingDate,
  }[code];
  return asDate(value);
}

function actualDateFor(rule: typeof milestoneRules.$inferSelect, shipment: MilestoneShipment) {
  const field = rule.completionField as keyof typeof ACTUAL_FIELDS | null;
  return field && field in ACTUAL_FIELDS
    ? asDate(shipment[ACTUAL_FIELDS[field] as keyof MilestoneShipment] as DateValue)
    : null;
}

function plannedDateFor(
  rule: typeof milestoneRules.$inferSelect,
  shipment: MilestoneShipment,
  milestones: Map<string, Date>,
) {
  const [kind, code] = rule.anchorCode.split(':', 2);
  const anchor =
    kind === 'MILESTONE' ? (milestones.get(code!) ?? null) : dateForField(shipment, kind!);
  if (!anchor) return null;
  const multiplier = rule.offsetUnit === 'HOURS' ? 3_600_000 : 86_400_000;
  return new Date(anchor.getTime() + rule.offsetValue * multiplier);
}

function relevantActual(
  rule: typeof milestoneRules.$inferSelect,
  shipment: MilestoneShipment,
  existingActual: Date | null,
) {
  return rule.completionField ? actualDateFor(rule, shipment) : existingActual;
}

async function syncShipmentMilestones(
  tx: Tx,
  shipment: MilestoneShipment,
  actorId: string | null,
  mode: MilestoneMode,
) {
  const rules = await tx
    .select()
    .from(milestoneRules)
    .where(and(eq(milestoneRules.mode, mode), eq(milestoneRules.active, true)))
    .orderBy(asc(milestoneRules.sequence));
  const existing = await tx
    .select()
    .from(followUps)
    .where(and(eq(followUps.shipmentId, shipment.id), isNull(followUps.deletedAt)));
  const byRule = new Map(
    existing.filter((r) => r.milestoneRuleId).map((r) => [r.milestoneRuleId!, r]),
  );
  const milestoneDates = new Map<string, Date>();

  for (const rule of rules) {
    const row = byRule.get(rule.id);
    const previousActual = row?.actualAt ?? null;
    const actualAt = relevantActual(rule, shipment, previousActual);
    const plannedAt =
      row?.actualAt && row.plannedAt
        ? row.plannedAt
        : plannedDateFor(rule, shipment, milestoneDates);
    const effectiveDate = actualAt ?? plannedAt;
    if (effectiveDate) milestoneDates.set(rule.code, effectiveDate);

    if (row) {
      const completed = !!actualAt;
      await tx
        .update(followUps)
        .set({
          subject: rule.name,
          clientId: shipment.clientId ?? row.clientId,
          plannedAt,
          actualAt,
          status: completed ? 'DONE' : row.status === 'DONE' ? 'OPEN' : row.status,
          completedAt: completed ? actualAt : null,
          completedById: completed
            ? rule.completionField &&
              (!row.actualAt || row.actualAt.getTime() !== actualAt.getTime())
              ? actorId
              : row.completedById
            : null,
        })
        .where(eq(followUps.id, row.id));
      continue;
    }

    const reference = formatNumber.followUp(await nextNumber(tx, 'FOLLOW_UP'));
    await tx.insert(followUps).values({
      reference,
      subject: rule.name,
      clientId: shipment.clientId ?? null,
      shipmentId: shipment.id,
      milestoneRuleId: rule.id,
      dueAt: plannedAt ?? asDate(shipment.createdAt) ?? new Date(),
      plannedAt,
      actualAt,
      completedAt: actualAt,
      completedById: actualAt ? actorId : null,
      status: actualAt ? 'DONE' : 'OPEN',
      createdById: actorId,
    });
  }
}

export async function generateShipmentMilestones(
  tx: Tx,
  shipment: MilestoneShipment,
  actorId: string | null,
) {
  const mode = milestoneModeFor(shipment);
  if (mode) await syncShipmentMilestones(tx, shipment, actorId, mode);
}

export async function replanShipmentMilestones(
  tx: Tx,
  shipment: MilestoneShipment,
  actorId: string | null,
) {
  await generateShipmentMilestones(tx, shipment, actorId);
}

export async function replanMilestonesForMode(tx: Tx, mode: MilestoneMode, actorId: string | null) {
  const [transportMode, direction] = mode.split('_');
  const rows = await tx
    .select()
    .from(shipments)
    .where(
      and(
        eq(shipments.transportMode, transportMode as 'SEA' | 'AIR'),
        eq(shipments.direction, direction as 'IMPORT' | 'EXPORT'),
        isNull(shipments.deletedAt),
      ),
    );
  for (const shipment of rows) await syncShipmentMilestones(tx, shipment, actorId, mode);
}

export async function backfillExistingShipmentMilestones() {
  const [rows, completed] = await Promise.all([
    db
      .select()
      .from(shipments)
      .where(and(isNull(shipments.deletedAt), ne(shipments.status, 'COMPLETED'))),
    db
      .select({ id: shipments.id })
      .from(shipments)
      .where(and(isNull(shipments.deletedAt), eq(shipments.status, 'COMPLETED'))),
  ]);
  let processed = 0;
  await db.transaction(async (tx) => {
    if (completed.length)
      await tx
        .update(followUps)
        .set({ deletedAt: new Date() })
        .where(
          and(
            inArray(
              followUps.shipmentId,
              completed.map((shipment) => shipment.id),
            ),
            isNotNull(followUps.milestoneRuleId),
            isNull(followUps.deletedAt),
          ),
        );
    for (const shipment of rows) {
      const mode = milestoneModeFor(shipment);
      if (!mode) continue;
      await syncShipmentMilestones(
        tx,
        shipment,
        shipment.updatedById ?? shipment.createdById,
        mode,
      );
      processed += 1;
    }
  });
  return processed;
}
