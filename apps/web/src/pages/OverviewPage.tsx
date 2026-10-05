import { PagePlaceholder } from '../components/PagePlaceholder';

export function OverviewPage() {
  return (
    <PagePlaceholder
      heading={'Logistics Operations Overview'}
      phase={4}
      summary={
        'KPI cards, the Shipment Summary of 2026 area chart, Key Logistics Accounts, Port of Discharge, Forwarder Statistics radar, net profit by client and Live Consignments Tracking — all read from /api/v1/overview and /api/v1/analytics.'
      }
    />
  );
}
