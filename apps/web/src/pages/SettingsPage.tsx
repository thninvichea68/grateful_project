import { PagePlaceholder } from '../components/PagePlaceholder';

export function SettingsPage() {
  return (
    <PagePlaceholder
      heading={'Workspace & Port Settings'}
      phase={5}
      summary={
        'Company details for invoices, default clearing port, USD→KHR exchange rates, and the lookup lists (ports, forwarders, consignees, units, CO forms) that replace the prototype’s localStorage “Add New” lists.'
      }
    />
  );
}
