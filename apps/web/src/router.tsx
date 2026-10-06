import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import type { Permission } from '@gs/shared';
import { lazy, Suspense, type ReactNode } from 'react';
import { AppLayout } from './layout/AppLayout';
import { RequireAuth, RequirePermission } from './auth/guards';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AccountingLayout } from './pages/accounting/AccountingLayout';

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

function DocsListRoute() {
  const { type = '' } = useParams();
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
    // Printable documents: full page, no sidebar.
    path: '/print/:type/:id',
    element: (
      <RequireAuth>
        <RequirePermission permission="accounting:read">
          <Suspense fallback={null}>
            <PrintDocPage />
          </Suspense>
        </RequirePermission>
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
      { index: true, element: <Navigate to="/overview" replace /> },
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
                <DocEditorPage />
              </Suspense>
            ),
          },
        ],
      },
      { path: 'quotations', element: guard('quotations:read', <QuotationsPage />) },
      { path: 'quotations/:id', element: guard('quotations:read', <QuotationEditorPage />) },
      { path: 'operations', element: guard('shipments:read', <OperationsPage />) },
      { path: 'staff', element: guard('staff:read', <StaffPage />) },
      { path: 'settings', element: guard('settings:read', <SettingsPage />) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
