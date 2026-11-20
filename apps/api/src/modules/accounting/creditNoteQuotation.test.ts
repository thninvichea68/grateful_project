import { describe, expect, it } from 'vitest';
import { creditNotePortGroup, creditNoteQuotationServices } from './creditNoteQuotation';

const services = (
  clientCode: string,
  direction: 'IMPORT' | 'EXPORT',
  portGroup: 'DRYPORT' | 'AIRPORT' | 'PNH' | 'SHV',
  options: Partial<{
    loadType: string;
    containerSize: string | null;
    grossWeightKg: string;
    cbm: string;
  }> = {},
) =>
  creditNoteQuotationServices({
    clientCode,
    direction,
    portGroup,
    loadType: options.loadType ?? 'FCL',
    containerSize: options.containerSize ?? null,
    grossWeightKg: options.grossWeightKg ?? '1500',
    cbm: options.cbm ?? '1',
  });

describe('credit note quotation rates', () => {
  it('selects the client’s original dry-port rate and exposes the case-specific increase note', () => {
    const truck = services('SAK', 'IMPORT', 'DRYPORT', { grossWeightKg: '1400' }).find(
      (service) => service.description === 'TRUCKING',
    );
    expect(truck).toMatchObject({
      unitPrice: '35',
      note: expect.stringContaining('INCREASE TRUCKING FEE 5/10/15'),
    });
  });

  it('uses the selected port and client row without applying its increase automatically', () => {
    const truck = services('SAK', 'EXPORT', 'PNH', { containerSize: '20GP' }).find(
      (service) => service.description === 'TRUCKING',
    );
    expect(truck).toMatchObject({
      unitPrice: '200',
      note: expect.stringContaining('INCREASE TRUCKING FEE 20%'),
    });
  });

  it('matches the existing LOLO line to the quoted port service', () => {
    const lolo = services('SAK', 'EXPORT', 'PNH', { containerSize: '20GP' }).find(
      (service) => service.description === 'LOLO',
    );
    expect(lolo?.unitPrice).toBe('50.6');
  });

  it('lists client-specific services even when this client has no quoted rate', () => {
    const truck = services('OTHER', 'IMPORT', 'DRYPORT', { grossWeightKg: '1400' }).find(
      (service) => service.description === 'TRUCKING',
    );
    expect(truck).toMatchObject({
      unitPrice: null,
      note: 'No rate listed for this client.',
    });
  });

  it('maps clearance ports to workbook sections', () => {
    expect(
      creditNotePortGroup({
        code: 'TSDP',
        name: 'Tecrsun Dry Port',
        shortName: 'TSDP',
        kind: 'DRY',
      }),
    ).toBe('DRYPORT');
    expect(
      creditNotePortGroup({
        code: 'SHV',
        name: 'Sihanoukville Port',
        shortName: 'SHV',
        kind: 'SEA',
      }),
    ).toBe('SHV');
  });
});
