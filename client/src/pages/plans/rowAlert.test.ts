import { describe, expect, it } from 'vitest';
import { rowAlert } from './rowAlert';

const TODAY = '2026-10-25';
const base = {
  direction: 'IMPORT' as const,
  status: 'PENDING' as const,
  clearanceStatus: 'PENDING' as const,
  eta: null,
  etd: null,
};

describe('rowAlert', () => {
  it('flags a customs exception first', () => {
    expect(rowAlert({ ...base, status: 'COMPLETED', clearanceStatus: 'EXCEPTION' }, TODAY)).toEqual(
      { tone: 'danger', label: 'Customs exception' },
    );
  });

  it('flags a completed shipment whose customs is not cleared', () => {
    expect(rowAlert({ ...base, status: 'COMPLETED' }, TODAY)?.label).toBe('Customs not cleared');
    expect(
      rowAlert({ ...base, status: 'COMPLETED', clearanceStatus: 'CLEARED' }, TODAY),
    ).toBeNull();
  });

  it('counts days to an import ETA', () => {
    expect(rowAlert({ ...base, eta: '2026-10-20' }, TODAY)).toEqual({
      tone: 'danger',
      label: 'ETA 5d ago',
    });
    expect(rowAlert({ ...base, eta: TODAY }, TODAY)?.label).toBe('ETA today');
    expect(rowAlert({ ...base, eta: '2026-11-01' }, TODAY)).toEqual({
      tone: 'info',
      label: 'ETA in 7d',
    });
    expect(rowAlert({ ...base, eta: '2026-11-02' }, TODAY)).toBeNull();
  });

  it('uses the ETD for an export', () => {
    expect(
      rowAlert({ ...base, direction: 'EXPORT', eta: '2026-12-01', etd: '2026-10-27' }, TODAY)
        ?.label,
    ).toBe('ETD in 2d');
  });
});

describe('rowAlert: air export cut-off', () => {
  // 2026-11-02 08:00 in Phnom Penh.
  const now = Date.parse('2026-11-02T08:00:00+07:00');
  const air = {
    direction: 'EXPORT' as const,
    transportMode: 'AIR' as const,
    status: 'IN_PROGRESS' as const,
    clearanceStatus: 'PENDING' as const,
    eta: null,
    etd: '2026-11-20',
    atd: null,
  };
  it('warns within 48 hours and turns red in the last 6 or once passed', () => {
    expect(rowAlert({ ...air, cutOffAt: '2026-11-03T14:00' }, '2026-11-02', now)).toEqual({
      tone: 'warning',
      label: 'Cut-off in 30h',
    });
    expect(rowAlert({ ...air, cutOffAt: '2026-11-02T12:00' }, '2026-11-02', now)).toEqual({
      tone: 'danger',
      label: 'Cut-off in 4h',
    });
    expect(rowAlert({ ...air, cutOffAt: '2026-11-02T07:00' }, '2026-11-02', now)).toEqual({
      tone: 'danger',
      label: 'Cut-off passed',
    });
  });
  it('says nothing once departed, or for sea', () => {
    expect(
      rowAlert({ ...air, cutOffAt: '2026-11-02T12:00', atd: '2026-11-02' }, '2026-11-02', now),
    ).toBeNull();
    expect(
      rowAlert({ ...air, transportMode: 'SEA', cutOffAt: '2026-11-02T12:00' }, '2026-11-02', now),
    ).toBeNull();
  });
});
