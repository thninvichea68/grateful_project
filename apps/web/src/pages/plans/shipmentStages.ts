import { clearanceStatusOf } from '@gs/shared';
import type { FormValues } from './formModel';

type StageValues = Pick<
  FormValues,
  | 'direction'
  | 'transportMode'
  | 'invoices'
  | 'hblDate'
  | 'ata'
  | 'doDate'
  | 'permitDate'
  | 'authorizeDate'
  | 'arriveFty'
  | 'bookingNo'
  | 'atd'
  | 'declarations'
  | 'containers'
  | 'checkInDate'
  | 'thcHblNo'
  | 'thcHblDate'
  | 'thcHblAmount'
  | 'coNumber'
  | 'coStatus'
>;

/** A field still to fill for a stage: the form field (its id is `f-<field>`) and its name. */
export interface StageGap {
  field: keyof FormValues;
  label: string;
}

export interface ShipmentStage {
  label: string;
  complete: boolean;
  /** What is still missing (empty when complete). */
  missing: StageGap[];
}

const hasText = (value: string | null | undefined) => !!value?.trim();
const gap = (ok: boolean, field: keyof FormValues, label: string): StageGap[] =>
  ok ? [] : [{ field, label }];
/** A stage from its gaps: complete when nothing is missing (or `done` says so). */
const stage = (label: string, missing: StageGap[], done = missing.length === 0): ShipmentStage => ({
  label,
  complete: done,
  missing: done ? [] : missing,
});

export function shipmentStages(values: StageValues): ShipmentStage[] {
  const isExport = values.direction === 'EXPORT';
  const isAir = values.transportMode === 'AIR';
  const invoicesEntered = (values.invoices ?? []).some((invoice) => hasText(invoice.invoiceNo));
  const cleared = clearanceStatusOf({ declarations: values.declarations }) === 'CLEARED';

  if (!isExport) {
    return [
      stage(
        'HBL Release',
        gap(hasText(values.hblDate), 'hblDate', isAir ? 'HAWB / MAWB date' : 'HBL date'),
      ),
      stage('Invoice / PL', gap(invoicesEntered, 'invoices', 'Cargo invoice no.')),
      stage('Permit', gap(hasText(values.permitDate), 'permitDate', 'Permit date')),
      stage('Arrival & DO', [
        ...gap(hasText(values.ata), 'ata', 'ATA'),
        ...gap(hasText(values.doDate), 'doDate', 'DO date'),
      ]),
      stage('Authorize', gap(hasText(values.authorizeDate), 'authorizeDate', 'Authorize date')),
      stage('Clearance', gap(cleared, 'declarations', 'Customs declaration no. and date')),
      stage('Delivery', gap(hasText(values.arriveFty), 'arriveFty', 'Arrive FTY date')),
    ];
  }

  const containerReady = isAir
    ? hasText(values.checkInDate)
    : (values.containers ?? []).some(
        (container) =>
          hasText(container.containerNo) &&
          (hasText(container.linerSeal) || hasText(container.customsSeal)),
      );
  const charged =
    hasText(values.thcHblNo) ||
    hasText(values.thcHblDate) ||
    (values.thcHblAmount != null && Number(values.thcHblAmount) > 0);
  const coDone = hasText(values.coNumber) || values.coStatus?.trim().toLowerCase() === 'approved';
  return [
    stage('Booking', gap(hasText(values.bookingNo), 'bookingNo', 'Booking no.')),
    stage('Invoice / PL', gap(invoicesEntered, 'invoices', 'Cargo invoice no.')),
    stage(
      'Container & Seal',
      isAir
        ? gap(containerReady, 'checkInDate', 'Check-in date')
        : gap(containerReady, 'containers', 'Container no. with a liner or customs seal'),
    ),
    stage('Clearance', gap(cleared, 'declarations', 'Customs declaration no. and date')),
    stage('Departure', gap(hasText(values.atd), 'atd', 'ATD')),
    stage(
      'BL Release',
      gap(hasText(values.hblDate), 'hblDate', isAir ? 'HAWB / MAWB date' : 'BL date'),
    ),
    stage('Invoice Charge', gap(charged, 'thcHblNo', 'Invoice / THC no., date or amount')),
    stage('CO', gap(coDone, 'coNumber', 'CO number (or CO status Approved)')),
  ];
}
