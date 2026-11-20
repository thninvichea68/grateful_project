import { describe, expect, it } from 'vitest';
import { quotationServiceChoices } from './quotationServiceChoices';

describe('quotation service choices', () => {
  it('lists every template service and uses the client quotation rate when available', () => {
    expect(
      quotationServiceChoices(
        ['TRUCKING FEE 拖車費', 'IMPORT PROCESSING FEE 報關費', 'PERMIT FEE'],
        [
          { description: 'TRUCKING FEE', unitPrice: '280' },
          { description: 'IMPORT PROCESSING FEE', unitPrice: '180' },
        ],
      ),
    ).toEqual([
      { description: 'TRUCKING FEE', unitPrice: '280' },
      { description: 'IMPORT PROCESSING FEE', unitPrice: '180' },
      { description: 'PERMIT FEE', unitPrice: null },
    ]);
  });

  it('lists custom client-quote services not in the template', () => {
    expect(
      quotationServiceChoices(
        ['DOCUMENT FEE'],
        [
          { description: 'DOCUMENT FEE', unitPrice: '25' },
          { description: 'EXTRA DECLARATION', unitPrice: null },
        ],
      ),
    ).toEqual([
      { description: 'DOCUMENT FEE', unitPrice: '25' },
      { description: 'EXTRA DECLARATION', unitPrice: null },
    ]);
  });
});
