import { Outlet } from 'react-router-dom';

/**
 * The accounting pages (Monthly Ledger, Client Billing, Chea Payments, Expense to Clients) as
 * native routes. Their sections are listed under Accounting in the sidebar, and the top bar
 * names the one that is open, so the pages need no tab row of their own.
 */
export function AccountingLayout() {
  return <Outlet />;
}
