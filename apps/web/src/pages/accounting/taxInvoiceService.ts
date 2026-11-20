export const IMPORT_PROCESSING_FEE_LABEL = 'កំរៃសេវាបំពេញបែបបទនាំចូល / IMPORT PROCESSING FEE';
export const EXPORT_PROCESSING_FEE_LABEL = 'កំរៃសេវាបំពេញបែបបទនាំចេញ / EXPORT PROCESSING FEE';

export interface TaxInvoiceServiceChoice {
  description: string;
  unitPrice: string | null;
}

export function taxInvoiceServiceDescription(description: string): string {
  const key = description
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  if (key.includes('IMPORT') && key.includes('PROCESSING FEE')) return IMPORT_PROCESSING_FEE_LABEL;
  if (key.includes('EXPORT') && key.includes('PROCESSING FEE')) return EXPORT_PROCESSING_FEE_LABEL;
  return description;
}

export function taxInvoiceServiceChoices(
  charges: readonly TaxInvoiceServiceChoice[],
): TaxInvoiceServiceChoice[] {
  const choices = new Map<string, TaxInvoiceServiceChoice>();
  for (const charge of charges) {
    const description = taxInvoiceServiceDescription(charge.description);
    const current = choices.get(description);
    if (!current || (current.unitPrice === null && charge.unitPrice !== null))
      choices.set(description, { description, unitPrice: charge.unitPrice });
  }
  return [...choices.values()];
}
