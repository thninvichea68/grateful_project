import { SHIPMENT_STATUS_LABEL, SHIPMENT_STATUS_PILL, type ShipmentStatus } from '@gs/shared';

type Tone = 'completed' | 'progress' | 'pending' | 'exception';

/** The prototype's `.status-tag` pill. */
export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`status-tag ${tone}`}>
      <span className="dot" />
      {children}
    </span>
  );
}

export function ShipmentStatusPill({ status }: { status: ShipmentStatus }) {
  return <Pill tone={SHIPMENT_STATUS_PILL[status]}>{SHIPMENT_STATUS_LABEL[status]}</Pill>;
}
