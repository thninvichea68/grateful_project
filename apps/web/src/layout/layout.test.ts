import { describe, expect, it } from 'vitest';
import { crumbsFor, titleFor } from './nav';

describe('titleFor', () => {
  it.each([
    ['/overview', 'Overview'],
    ['/plans', 'Shipping Plans'],
    ['/plans/import', 'Shipping Plans'],
    ['/plans/export', 'Shipping Plans'],
    ['/plans/new', 'Create Shipment'],
    ['/accounting', 'Accounting'],
    ['/accounting/credit-notes', 'Chea Payments'],
    ['/accounting/tax-invoices', 'Tax Invoice'],
    ['/cutstock', 'CDC Master List'],
    ['/staff', 'Staff Management'],
    ['/plans/3f6c0a1e-0000-4000-8000-000000000000', 'Shipment Details'],
    ['/clients/3f6c0a1e-0000-4000-8000-000000000000', 'Client Details'],
  ])('%s → %s', (path, title) => expect(titleFor(path)).toBe(title));
});

describe('crumbsFor', () => {
  it.each([
    ['/overview', ['Overview']],
    ['/accounting', ['Accounting', 'Monthly']],
    ['/accounting/billing', ['Accounting', 'Invoice to Clients', 'Clients']],
    ['/accounting/tax-invoices', ['Accounting', 'Invoice to Clients', 'Tax Invoices']],
    [
      '/accounting/tax-invoices/abc',
      ['Accounting', 'Invoice to Clients', 'Tax Invoices', 'Tax Invoice'],
    ],
    ['/accounting/billing/abc', ['Accounting', 'Invoice to Clients', 'Clients', 'Client']],
    ['/accounting/record-summaries', ['Accounting', 'Expense to Clients']],
    ['/co', ['CO', 'CO Plans']],
    ['/plans/import', ['Shipping Plans', 'Import Plans']],
    ['/plans/export', ['Shipping Plans', 'Export Plans']],
    ['/reports/mih', ['Reports', 'MIH']],
    ['/settings/company', ['Settings', 'Company']],
    ['/plans/new', ['Shipping Plans', 'Create Shipment']],
    ['/clients/abc', ['Clients', 'Client Details']],
  ])('%s → %j', (path, crumbs) => expect(crumbsFor(path)).toEqual(crumbs));
});
