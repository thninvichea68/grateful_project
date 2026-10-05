import { PagePlaceholder } from '../components/PagePlaceholder';

export function CreateShipmentPage() {
  return (
    <PagePlaceholder
      heading={'Create Shipment'}
      phase={3}
      summary={
        'Multi-step wizard: IMPORT and EXPORT flows from the prototype, cargo invoices with line items, containers and CDC lines that draw down the cut-stock balance.'
      }
    />
  );
}
