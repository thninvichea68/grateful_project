export interface QuotationServiceChoice {
  description: string;
  unitPrice: string | null;
}

const normalized = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

function matches(a: string, b: string): boolean {
  if (a.length < 5 || b.length < 5) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function quotationServiceChoices(
  defaultDescriptions: readonly string[],
  quotedCharges: readonly QuotationServiceChoice[],
): QuotationServiceChoice[] {
  const choices: QuotationServiceChoice[] = [];

  for (const rawDescription of defaultDescriptions) {
    const description = rawDescription.trim();
    const key = normalized(description);
    if (!key || choices.some((choice) => normalized(choice.description) === key)) continue;

    const exact = quotedCharges.find((charge) => normalized(charge.description) === key);
    const similar = exact
      ? undefined
      : quotedCharges.filter((charge) => matches(key, normalized(charge.description)));
    const quote = exact ?? (similar?.length === 1 ? similar[0] : undefined);
    choices.push(
      quote
        ? { description: quote.description, unitPrice: quote.unitPrice }
        : { description, unitPrice: null },
    );
  }

  for (const charge of quotedCharges) {
    const key = normalized(charge.description);
    if (!key || choices.some((choice) => matches(key, normalized(choice.description)))) continue;
    choices.push(charge);
  }

  return choices;
}
