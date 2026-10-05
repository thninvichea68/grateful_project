import { PagePlaceholder } from '../../components/PagePlaceholder';

export function RecordSummaryPage() {
  return (
    <PagePlaceholder
      heading={'Record Summary Operations'}
      phase={5}
      summary={
        'Breakdown per shipment (import/export, CY/CY, LCL, AIR) linked to its invoice, disbursement and debit note numbers.'
      }
    />
  );
}
