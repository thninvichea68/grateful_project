import { describe, expect, it } from 'vitest';
import { clockParts } from './LiveClock';
import { titleFor } from './nav';

describe('clockParts', () => {
  it('formats in Phnom Penh time (UTC+7) like the prototype', () => {
    // 2026-09-01 04:04 UTC = Tuesday 11:04 AM in Phnom Penh
    expect(clockParts(new Date('2026-09-01T04:04:00Z'))).toEqual({
      day: 'Tuesday',
      date: '01, Sep 26',
      time: '11:04 AM',
    });
  });
  it('rolls the date over at Phnom Penh midnight, not UTC', () => {
    expect(clockParts(new Date('2026-12-31T17:30:00Z')).date).toBe('01, Jan 27');
  });
});

describe('titleFor', () => {
  it.each([
    ['/overview', 'Overview'],
    ['/plans', 'Shipping Plans'],
    ['/plans/new', 'Create Shipment'],
    ['/accounting', 'Accounting'],
    ['/accounting/credit-notes', 'Chea Payments / Credit Noted'],
    ['/accounting/tax-invoices', 'Tax Invoice'],
    ['/cutstock', 'Cut Stock Master List'],
    ['/staff', 'Staff Management'],
    ['/plans/3f6c0a1e-0000-4000-8000-000000000000', 'Shipment Details'],
    ['/clients/3f6c0a1e-0000-4000-8000-000000000000', 'Client Details'],
  ])('%s → %s', (path, title) => expect(titleFor(path)).toBe(title));
});

describe('clockParts edge cases', () => {
  it('shows 12 AM at midnight and 12 PM at noon', () => {
    expect(clockParts(new Date('2026-03-01T17:00:00Z')).time).toBe('12:00 AM');
    expect(clockParts(new Date('2026-03-01T05:00:00Z')).time).toBe('12:00 PM');
  });
});
