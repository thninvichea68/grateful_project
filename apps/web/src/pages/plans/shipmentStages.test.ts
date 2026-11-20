import { describe, expect, it } from 'vitest';
import { emptyForm } from './formModel';
import { shipmentStages } from './shipmentStages';

describe('shipment stages', () => {
  it('tracks Import Permit and Authorize from dates entered on the Shipping Plan', () => {
    const values = emptyForm('IMPORT');
    const stages = shipmentStages(values);
    expect(stages.map(({ label }) => label)).toEqual([
      'HBL Release',
      'Invoice / PL',
      'Permit',
      'Arrival & DO',
      'Authorize',
      'Clearance',
      'Delivery',
    ]);
    expect(stages[2]?.complete).toBe(false);
    expect(stages[4]?.complete).toBe(false);

    values.permitDate = '2026-02-20';
    values.authorizeDate = '2026-02-21';
    const completed = shipmentStages(values);
    expect([completed[2]?.complete, completed[4]?.complete]).toEqual([true, true]);
  });

  it('shows all eight Export stages and requires an actual ATD and a seal for progress', () => {
    const values = emptyForm('EXPORT');
    values.bookingNo = 'BK-1';
    values.containers = [
      {
        containerNo: 'ABCD1234567',
        size: '40HQ',
        linerSeal: '',
        customsSeal: '',
        truckNo: '',
      },
    ];
    values.etd = '2026-02-20';

    const stages = shipmentStages(values);
    expect(stages.map(({ label }) => label)).toEqual([
      'Booking',
      'Invoice / PL',
      'Container & Seal',
      'Clearance',
      'Departure',
      'BL Release',
      'Invoice Charge',
      'CO',
    ]);
    expect(stages[2]?.complete).toBe(false);
    expect(stages[4]?.complete).toBe(false);

    values.containers![0]!.linerSeal = 'SEAL-1';
    values.atd = '2026-02-21';
    const updated = shipmentStages(values);
    expect([updated[2]?.complete, updated[4]?.complete]).toEqual([true, true]);
  });
});
