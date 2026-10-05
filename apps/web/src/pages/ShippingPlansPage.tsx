import { PagePlaceholder } from '../components/PagePlaceholder';

export function ShippingPlansPage() {
  return (
    <PagePlaceholder
      heading={'Shipping Plans'}
      phase={3}
      summary={
        'Filterable, sortable table of every shipment with expand-all and frozen columns, the multi-step Create Shipment wizard (shipment info → cargo, pricing & FOB → CDC lines), edit/delete and Excel import in the Export Template format.'
      }
    />
  );
}
