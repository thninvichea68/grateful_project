import { createBrowserRouter, Navigate } from 'react-router-dom';
import type { Permission } from '@gs/shared';
import type { ReactNode } from 'react';
import { AppLayout } from './layout/AppLayout';
import { RequireAuth, RequirePermission } from './auth/guards';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { ShippingPlansPage } from './pages/ShippingPlansPage';
import { CreateShipmentPage } from './pages/CreateShipmentPage';
import { ClientsPage } from './pages/ClientsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { CutStockPage } from './pages/CutStockPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { FollowUpPage } from './pages/FollowUpPage';
import { QuotationsPage } from './pages/QuotationsPage';
import { OperationsPage } from './pages/OperationsPage';
import { StaffPage } from './pages/StaffPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AccountingLayout } from './pages/accounting/AccountingLayout';
import { LedgerPage } from './pages/accounting/LedgerPage';
import { CreditNotesPage } from './pages/accounting/CreditNotesPage';
import { RecordSummaryPage } from './pages/accounting/RecordSummaryPage';
import { TaxInvoicesPage } from './pages/accounting/TaxInvoicesPage';
import { DisbursementsPage } from './pages/accounting/DisbursementsPage';
import { DebitNotesPage } from './pages/accounting/DebitNotesPage';

const guard = (permission: Permission, el: ReactNode) => (
  <RequirePermission permission={permission}>{el}</RequirePermission>
);

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
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
      { path: 'plans/new', element: guard('shipments:write', <CreateShipmentPage />) },
      { path: 'clients', element: guard('clients:read', <ClientsPage />) },
      { path: 'analytics', element: guard('dashboard:read', <AnalyticsPage />) },
      { path: 'cutstock', element: guard('cutstock:read', <CutStockPage />) },
      { path: 'documents', element: guard('documents:read', <DocumentsPage />) },
      { path: 'followup', element: guard('followups:read', <FollowUpPage />) },
      {
        path: 'accounting',
        element: guard('accounting:read', <AccountingLayout />),
        children: [
          { index: true, element: <LedgerPage /> },
          { path: 'credit-notes', element: <CreditNotesPage /> },
          { path: 'record-summary', element: <RecordSummaryPage /> },
          { path: 'tax-invoices', element: <TaxInvoicesPage /> },
          { path: 'disbursements', element: <DisbursementsPage /> },
          { path: 'debit-notes', element: <DebitNotesPage /> },
        ],
      },
      { path: 'quotations', element: guard('quotations:read', <QuotationsPage />) },
      { path: 'operations', element: guard('shipments:read', <OperationsPage />) },
      { path: 'staff', element: guard('staff:read', <StaffPage />) },
      { path: 'settings', element: guard('settings:read', <SettingsPage />) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
