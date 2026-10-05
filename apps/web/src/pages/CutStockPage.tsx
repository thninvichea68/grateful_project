import { PagePlaceholder } from '../components/PagePlaceholder';

export function CutStockPage() {
  return (
    <PagePlaceholder
      heading={'Cut Stock Master List'}
      phase={3}
      summary={
        'Each client’s CDC master list with live imported quantity, balance and balance % (CHECK below 50%), the declarations that drew it down, Excel import/export, and Manager overrides for over-imports.'
      }
    />
  );
}
