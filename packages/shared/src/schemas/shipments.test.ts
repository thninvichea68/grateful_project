import { describe, expect, it } from 'vitest';
import { shipmentInputSchema } from './shipments';

const base = {
  clientId: '069e236d-8701-432a-b786-834d24508c78',
  direction: 'EXPORT',
  transportMode: 'SEA',
  loadType: 'LCL',
};

describe('shipment declarations', () => {
  it('drops a declaration row left blank (the form always offers one)', () => {
    const v = shipmentInputSchema.parse({
      ...base,
      declarations: [{ id: '', declareNo: '', declareDate: '', portId: 'x', notes: '' }],
    });
    expect(v.declarations).toEqual([]);
  });

  it('keeps a filled row and still checks a half-filled one', () => {
    const ok = shipmentInputSchema.parse({
      ...base,
      declarations: [{ declareNo: 'e 291340', declareDate: '2026-09-28' }],
    });
    expect(ok.declarations.map((d) => d.declareNo)).toEqual(['E 291340']);
    const half = shipmentInputSchema.safeParse({
      ...base,
      declarations: [{ declareNo: 'E 291340', declareDate: '' }],
    });
    expect(half.success).toBe(false);
  });
});
