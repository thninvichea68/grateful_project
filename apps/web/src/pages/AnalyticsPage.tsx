import { PagePlaceholder } from '../components/PagePlaceholder';

export function AnalyticsPage() {
  return (
    <PagePlaceholder
      heading={'Analytics — Full Operations Breakdown'}
      phase={4}
      summary={
        'Monthly volume (import vs export), share donut, customs clearance status, shipments by destination country, forwarder ranking, port of discharge and the key accounts breakdown, with date-range, client, transport-mode and import/export filters.'
      }
    />
  );
}
