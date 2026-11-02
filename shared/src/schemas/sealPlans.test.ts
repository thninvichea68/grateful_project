import { describe, expect, it } from 'vitest';
import { sealPlanReadiness } from './sealPlans';

const TODAY = '2026-10-25';
const full = {
  atd: null,
  loadingDate: '2026-10-28',
  linerSeal: 'LS-1',
  customsSeal: 'CS-1',
  truckBy: 'GS Trucking',
  truckNo: null,
  tareWeightKg: '3800',
};

describe('sealPlanReadiness', () => {
  it('is ready when nothing is missing', () => {
    expect(sealPlanReadiness(full, TODAY)).toEqual({ stage: 'READY', missing: [] });
  });

  it('lists what is missing while planning', () => {
    expect(
      sealPlanReadiness(
        { ...full, loadingDate: null, customsSeal: ' ', truckBy: null, tareWeightKg: null },
        TODAY,
      ),
    ).toEqual({
      stage: 'PLANNING',
      missing: ['Loading date', 'Customs seal', 'Truck', 'Tare weight'],
    });
  });

  it('counts a truck plate alone as the truck', () => {
    expect(
      sealPlanReadiness({ ...full, truckBy: null, truckNo: '3A-1234' }, TODAY).missing,
    ).toEqual([]);
  });

  it('is loaded from the loading date on, still reporting what is missing', () => {
    expect(sealPlanReadiness({ ...full, loadingDate: TODAY, linerSeal: null }, TODAY)).toEqual({
      stage: 'LOADED',
      missing: ['Carrier seal'],
    });
  });

  it('is departed once the shipment has an ATD', () => {
    expect(sealPlanReadiness({ ...full, atd: '2026-10-20', linerSeal: null }, TODAY)).toEqual({
      stage: 'DEPARTED',
      missing: [],
    });
  });
});
