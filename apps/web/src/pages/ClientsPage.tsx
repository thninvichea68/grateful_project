import { PagePlaceholder } from '../components/PagePlaceholder';

export function ClientsPage() {
  return (
    <PagePlaceholder
      heading={'Registered Shipping Clients'}
      phase={3}
      summary={
        'Client list with create, edit and deactivate, plus a client detail page with that client’s shipments, consignees, commission setting and CDC master list.'
      }
    />
  );
}
