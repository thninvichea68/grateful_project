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

describe('shipment cargo invoices', () => {
  const blankLine = {
    poNo: '',
    styleNo: '',
    cdcNo: '',
    pcs: '',
    netWeightKg: '',
    fobUnitPrice: '',
  };

  it('are optional: an untouched invoice row (even with a preset date) is dropped', () => {
    const v = shipmentInputSchema.parse({
      ...base,
      invoices: [
        {
          invoiceNo: '',
          invoiceDate: '2026-10-01',
          description: '',
          packages: '',
          lines: [blankLine],
        },
      ],
    });
    expect(v.invoices).toEqual([]);
  });

  it('still checks an invoice with something typed in', () => {
    const half = shipmentInputSchema.safeParse({
      ...base,
      invoices: [{ invoiceNo: '', lines: [{ ...blankLine, pcs: '10' }] }],
    });
    expect(half.success).toBe(false);
  });
});
