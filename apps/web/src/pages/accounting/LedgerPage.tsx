import { PagePlaceholder } from '../../components/PagePlaceholder';

export function LedgerPage() {
  return (
    <PagePlaceholder
      heading={'Monthly Ledger'}
      phase={5}
      summary={
        'One row per customs declaration: clear fee, THC, other pay, CM, INV revenue, DIS, VAT 10%, DN total and net profit — computed and stored by the API with the formulas from the accounting engine. 225 seeded rows already exist.'
      }
    />
  );
}
