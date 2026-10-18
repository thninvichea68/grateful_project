import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import type { Permission } from '@gs/shared';
import { lazy, Suspense, type ReactNode } from 'react';
import { AppLayout } from './layout/AppLayout';
import { RequireAuth, RequirePermission } from './auth/guards';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AccountingLayout } from './pages/accounting/AccountingLayout';
import { useAuth } from './auth/AuthProvider';
import { NAV } from './layout/nav';

const OverviewPage = lazy(() =>
  import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })),
);
const ShippingPlansPage = lazy(() =>
  import('./pages/ShippingPlansPage').then((m) => ({ default: m.ShippingPlansPage })),
);
const ShipmentFormPage = lazy(() =>
  import('./pages/plans/ShipmentFormPage').then((m) => ({ default: m.ShipmentFormPage })),
);
const ClientsPage = lazy(() =>
  import('./pages/ClientsPage').then((m) => ({ default: m.ClientsPage })),
);
const ClientDetailPage = lazy(() =>
  import('./pages/clients/ClientDetailPage').then((m) => ({ default: m.ClientDetailPage })),
);
const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })),
);
const CutStockPage = lazy(() =>
  import('./pages/CutStockPage').then((m) => ({ default: m.CutStockPage })),
);
const DocumentsPage = lazy(() =>
  import('./pages/DocumentsPage').then((m) => ({ default: m.DocumentsPage })),
);
const FollowUpPage = lazy(() =>
  import('./pages/FollowUpPage').then((m) => ({ default: m.FollowUpPage })),
);
const QuotationsPage = lazy(() =>
  import('./pages/QuotationsPage').then((m) => ({ default: m.QuotationsPage })),
);
const OperationsPage = lazy(() =>
  import('./pages/OperationsPage').then((m) => ({ default: m.OperationsPage })),
);
const StaffPage = lazy(() => import('./pages/StaffPage').then((m) => ({ default: m.StaffPage })));
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
/** Each page is its own chunk (charts load only on the dashboards). */
const LedgerPage = lazy(() =>
  import('./pages/accounting/LedgerPage').then((m) => ({ default: m.LedgerPage })),
);
const DocsListPage = lazy(() =>
  import('./pages/accounting/DocsListPage').then((m) => ({ default: m.DocsListPage })),
);
const DocEditorPage = lazy(() =>
  import('./pages/accounting/DocEditorPage').then((m) => ({ default: m.DocEditorPage })),
);
const BillingPage = lazy(() =>
  import('./pages/accounting/BillingPage').then((m) => ({ default: m.BillingPage })),
);
const BillingClientPage = lazy(() =>
  import('./pages/accounting/BillingClientPage').then((m) => ({ default: m.BillingClientPage })),
);
const ReceiptsPage = lazy(() =>
  import('./pages/accounting/ReceiptsPage').then((m) => ({ default: m.ReceiptsPage })),
);
const PrintPackPage = lazy(() =>
  import('./pages/print/PrintBillingPage').then((m) => ({ default: m.PrintPackPage })),
);
const PrintReceiptPage = lazy(() =>
  import('./pages/print/PrintBillingPage').then((m) => ({ default: m.PrintReceiptPage })),
);
const CreditNotesReview = lazy(() =>
  import('./pages/accounting/CreditNotesReview').then((m) => ({ default: m.CreditNotesReview })),
);
const CreditNotedList = lazy(() =>
  import('./pages/creditnoted/CreditNotedList').then((m) => ({ default: m.CreditNotedList })),
);
const CreditNotedRoute = lazy(() =>
  import('./pages/creditnoted/CreditNotedEditor').then((m) => ({ default: m.CreditNotedRoute })),
);
const ExpenseToClients = lazy(() =>
  import('./pages/accounting/ExpenseToClients').then((m) => ({ default: m.ExpenseToClients })),
);
const RecordSummariesList = lazy(() =>
  import('./pages/accounting/RecordSummariesList').then((m) => ({
    default: m.RecordSummariesList,
  })),
);
const RecordSummaryRoute = lazy(() =>
  import('./pages/accounting/RecordSummaryEditor').then((m) => ({
    default: m.RecordSummaryRoute,
  })),
);
const QuotationEditorPage = lazy(() =>
  import('./pages/quotations/QuotationEditorPage').then((m) => ({
    default: m.QuotationEditorPage,
  })),
);
const PrintQuotationPage = lazy(() =>
  import('./pages/print/PrintQuotationPage').then((m) => ({ default: m.PrintQuotationPage })),
);
const PrintDocPage = lazy(() =>
  import('./pages/print/PrintDocPage').then((m) => ({ default: m.PrintDocPage })),
);
const PrintCreditNotePackPage = lazy(() =>
  import('./pages/print/PrintCreditNotePackPage').then((m) => ({
    default: m.PrintCreditNotePackPage,
  })),
);
const guard = (permission: Permission, el: ReactNode) => (
  <RequirePermission permission={permission}>
    <Suspense fallback={<PageLoading />}>{el}</Suspense>
  </RequirePermission>
);

function PageLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ padding: 24, color: 'var(--text-tertiary)', fontSize: 13, fontWeight: 700 }}
    >
      Loading…
    </div>
  );
}

/**
 * Credit notes open in the two-pane Credit Noted editor, record summaries in the two-pane
 * Record Summary editor; other types in the generic one.
 */
function DocEditorRoute() {
  const { type = '' } = useParams();
  if (type === 'record-summaries')
    return (
      <RequirePermission permission="recordsummaries:read">
        <RecordSummaryRoute base="/accounting/record-summaries" />
      </RequirePermission>
    );
  return type === 'credit-notes' ? (
    <CreditNotedRoute base="/accounting/credit-notes" />
  ) : (
    <DocEditorPage />
  );
}

/** Credit notes print for anyone with Credit Noted access (the customs broker too). */
function PrintDocRoute() {
  const { type } = useParams();
  return (
    <RequirePermission
      permission={
        type === 'credit-notes'
          ? 'creditnotes:read'
          : type === 'record-summaries'
            ? 'recordsummaries:read'
            : 'accounting:read'
      }
    >
      <Suspense fallback={null}>
        <PrintDocPage />
      </Suspense>
    </RequirePermission>
  );
}

/** "/" lands on the first sidebar page the role can open (a broker has no dashboard). */
function HomeRedirect() {
  const { can } = useAuth();
  const first = NAV.flatMap((g) => g.items).find((i) => can(i.permission));
  return <Navigate to={first?.to ?? '/overview'} replace />;
}

function DocsListRoute() {
  const { type = '' } = useParams();
  // Accounting's Credit Noted tab checks the broker's submitted notes.
  if (type === 'credit-notes') return <CreditNotesReview />;
  // Expense to Clients: accounting's check of Operations' submitted record summaries.
  if (type === 'record-summaries') return <ExpenseToClients />;
  return <DocsListPage type={type} key={type} />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/print/quotation/:id',
    element: (
      <RequireAuth>
        <RequirePermission permission="quotations:read">
          <Suspense fallback={null}>
            <PrintQuotationPage />
          </Suspense>
        </RequirePermission>
      </RequireAuth>
    ),
  },
  {
    // A client's month pack (documents, statements, receipts, checklist) for printing.
    path: '/print/billing/:clientId',
    element: (
      <RequireAuth>
        <RequirePermission permission="accounting:read">
          <Suspense fallback={null}>
            <PrintPackPage />
          </Suspense>
        </RequirePermission>
      </RequireAuth>
    ),
  },
  {
    path: '/print/receipts/:id',
    element: (
      <RequireAuth>
        <RequirePermission permission="accounting:read">
          <Suspense fallback={null}>
            <PrintReceiptPage />
          </Suspense>
        </RequirePermission>
      </RequireAuth>
    ),
  },
  {
    // Credit Noted → ⋯ → PDF Pack: every credit note matching the list's filters.
    path: '/print/credit-noted-pack',
    element: (
      <RequireAuth>
        <RequirePermission permission="creditnotes:read">
          <Suspense fallback={null}>
            <PrintCreditNotePackPage />
          </Suspense>
        </RequirePermission>
      </RequireAuth>
    ),
  },
  {
    // Printable documents: full page, no sidebar.
    path: '/print/:type/:id',
    element: (
      <RequireAuth>
        <PrintDocRoute />
      </RequireAuth>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'overview', element: guard('dashboard:read', <OverviewPage />) },
      { path: 'plans', element: guard('shipments:read', <ShippingPlansPage />) },
      { path: 'plans/new', element: guard('shipments:write', <ShipmentFormPage />) },
      { path: 'plans/:id', element: guard('shipments:read', <ShipmentFormPage />) },
      { path: 'clients', element: guard('clients:read', <ClientsPage />) },
      { path: 'clients/:id', element: guard('clients:read', <ClientDetailPage />) },
      { path: 'analytics', element: guard('dashboard:read', <AnalyticsPage />) },
      { path: 'cutstock', element: guard('cutstock:read', <CutStockPage />) },
      { path: 'documents', element: guard('documents:read', <DocumentsPage />) },
      { path: 'followup', element: guard('followups:read', <FollowUpPage />) },
      {
        path: 'accounting',
        element: guard('accounting:read', <AccountingLayout />),
        children: [
          {
            index: true,
            element: (
              <Suspense fallback={null}>
                <LedgerPage />
              </Suspense>
            ),
          },
          {
            path: 'billing',
            element: (
              <Suspense fallback={null}>
                <BillingPage />
              </Suspense>
            ),
          },
          {
            path: 'billing/:clientId',
            element: (
              <Suspense fallback={null}>
                <BillingClientPage />
              </Suspense>
            ),
          },
          {
            path: 'receipts',
            element: (
              <Suspense fallback={null}>
                <ReceiptsPage />
              </Suspense>
            ),
          },
          {
            path: ':type',
            element: (
              <Suspense fallback={null}>
                <DocsListRoute />
              </Suspense>
            ),
          },
          {
            path: ':type/:id',
            element: (
              <Suspense fallback={null}>
                <DocEditorRoute />
              </Suspense>
            ),
          },
        ],
      },
      {
        path: 'credit-noted',
        element: guard('creditnotes:read', <CreditNotedList />),
      },
      {
        path: 'credit-noted/:id',
        element: guard('creditnotes:read', <CreditNotedRoute base="/credit-noted" />),
      },
      {
        // Sidebar → Record Summary: the list (like Credit Noted); a row opens the editor.
        path: 'record-summary',
        element: guard('recordsummaries:read', <RecordSummariesList base="/record-summary" />),
      },
      {
        path: 'record-summary/:id',
        element: guard('recordsummaries:read', <RecordSummaryRoute base="/record-summary" />),
      },
      { path: 'quotations', element: guard('quotations:read', <QuotationsPage />) },
      { path: 'quotations/:id', element: guard('quotations:read', <QuotationEditorPage />) },
      { path: 'operations', element: guard('shipments:read', <OperationsPage />) },
      { path: 'staff', element: guard('staff:read', <StaffPage />) },
      {
        // Everyone reaches My profile; the workspace tabs check settings:read themselves.
        path: 'settings',
        element: (
          <Suspense fallback={<PageLoading />}>
            <SettingsPage />
          </Suspense>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
