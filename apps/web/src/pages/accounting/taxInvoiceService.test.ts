import { describe, expect, it } from 'vitest';
import {
  EXPORT_PROCESSING_FEE_LABEL,
  IMPORT_PROCESSING_FEE_LABEL,
  taxInvoiceServiceChoices,
  taxInvoiceServiceDescription,
} from './taxInvoiceService';

describe('Tax Invoice service descriptions', () => {
  it('uses Khmer and English for only the import/export processing fee', () => {
    expect(taxInvoiceServiceDescription('IMPORT PROCESSING FEE 報關費')).toBe(
      IMPORT_PROCESSING_FEE_LABEL,
    );
    expect(taxInvoiceServiceDescription('EXPORT PROCESSING FEE')).toBe(EXPORT_PROCESSING_FEE_LABEL);
    expect(taxInvoiceServiceDescription('TRUCKING FEE 拖車費')).toBe('TRUCKING FEE 拖車費');
  });

  it('deduplicates bilingual fee options while keeping the quoted price', () => {
    expect(
      taxInvoiceServiceChoices([
        { description: 'IMPORT PROCESSING FEE 報關費', unitPrice: null },
        { description: IMPORT_PROCESSING_FEE_LABEL, unitPrice: '180' },
        { description: 'TRUCKING FEE', unitPrice: '280' },
      ]),
    ).toEqual([
      { description: IMPORT_PROCESSING_FEE_LABEL, unitPrice: '180' },
      { description: 'TRUCKING FEE', unitPrice: '280' },
    ]);
  });
});
