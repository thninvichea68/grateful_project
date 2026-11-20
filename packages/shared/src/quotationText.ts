/**
 * Quotations are kept in English only: Chinese (and other CJK) text is dropped, full-width
 * punctuation becomes plain, and the note lines become a list of extra charges
 * (description · amount · per · remark) that bills and record summaries can pick from.
 */

/** One extra charge on a quotation ("Red signal · 45 · Shipment · (if any)"). */
export interface QuotationExtraCharge {
  description: string;
  /** USD; null when the line has no fixed price ("as per receipt", "case by case"). */
  amount: string | null;
  /** Per what: Set, Shipment, CTNR, Declaration, Truck/night… */
  unit: string | null;
  /** The condition in full, when it says more than description + amount + per. */
  remark: string | null;
}

const FULL_WIDTH: Record<string, string> = {
  '：': ':',
  '；': ';',
  '，': ',',
  '。': '.',
  '（': '(',
  '）': ')',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '、': ',',
  '／': '/',
  '＊': '*',
  '－': '-',
};
// CJK scripts and symbols, Hangul and Kana, compatibility ideographs and forms, full-width forms.
const CJK = /[\u2E80-\u2FFF\u3000-\u303F\u3040-\u30FF\u3100-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/g;

/** The English text only: CJK dropped, punctuation made plain, leftover brackets tidied. */
export function toEnglish(value: string | null | undefined): string {
  let t = String(value ?? '');
  t = t.replace(/[：；，。（）“”‘’、／＊－]/g, (c) => FULL_WIDTH[c] ?? c);
  t = t.replace(CJK, ' ');
  return t
    .split('\n')
    .map((line) =>
      line
        .replace(/\(\s*\)|\[\s*\]/g, ' ') // brackets left empty
        .replace(/\s+([,.:;)])/g, '$1')
        .replace(/\(\s+/g, '(')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s*-\s*$/, '') // a dash that only led into Chinese
        .replace(/^[\s,;:/-]+/, '')
        .replace(/[\s,;:/]+$/, '')
        .trim(),
    )
    .filter((line, i, all) => line || (i > 0 && all[i - 1]))
    .join('\n')
    .trim();
}

/** True when the text has any CJK left to drop. */
export const hasCjk = (value: string | null | undefined) =>
  /[\u3000-\u9FFF\uFF00-\uFFEF]/.test(String(value ?? ''));

const UNIT_WORDS: [RegExp, string][] = [
  [/^sets?\b|^per\s*sets?\b/i, 'Set'],
  [/^shi?pm?ents?\b|^shpt\b/i, 'Shipment'],
  [/^(ctnrs?|cntrs?|containers?|cont)\b/i, 'CTNR'],
  [/^declarations?\b/i, 'Declaration'],
  [/^truck\s*\/\s*night\b/i, 'Truck/night'],
  [/^trucks?\b/i, 'Truck'],
  [/^times?\b/i, 'Time'],
  [/^tons?\b/i, 'Ton'],
  [/^kgs?\b/i, 'KG'],
  [/^cbm\b/i, 'CBM'],
  [/^days?\b/i, 'Day'],
];
const unitOf = (text: string): string | null => {
  const t = text.trim().replace(/^per\s+/i, '');
  for (const [re, unit] of UNIT_WORDS) if (re.test(t)) return unit;
  return null;
};

/** The first price in a line: "US$ 45", "USD80.5", "$30", "50$", "120 USD". */
const PRICE = /(?:US\s*\$|USD|\$)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:\$|USD|usd)/;

/** One note line as an extra charge; null for headings and empty lines. */
export function parseChargeLine(raw: string): QuotationExtraCharge | null {
  const text = toEnglish(raw)
    .replace(/^\*+\s*/, '')
    .trim();
  if (!text || /^above rate/i.test(text) || /^I\.\s/.test(text)) return null;
  // A line that was only a Chinese translation leaves numbers and symbols, not words.
  if ((text.match(/[A-Za-z]/g) ?? []).length < 6) return null;
  const m = PRICE.exec(text);
  const amount = m ? (m[1] ?? m[2] ?? null) : null;
  // The name: up to the first colon, else up to the price, else the whole line.
  const colon = text.indexOf(':');
  const cut = colon > 2 && (!m || colon < m.index) ? colon : m ? m.index : text.length;
  let description = text
    .slice(0, cut)
    .replace(/[\s*,;:(-]+$/, '')
    .trim();
  if (description.length < 3) description = text;
  // Per what: the word after "/" right behind the price, or "per X".
  let unit: string | null = null;
  if (m) {
    const after = text.slice(m.index + m[0].length);
    const slash = /^\s*\/\s*([A-Za-z][A-Za-z/ ]*)/.exec(after);
    unit = slash ? unitOf(slash[1]!) : null;
  }
  if (!unit) {
    const per = /\bper\s+([A-Za-z]+)/i.exec(text);
    unit = per ? unitOf(per[1]!) : null;
  }
  // Keep the full line as the remark only when it says more than name, price and per.
  const words = (s: string) => s.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) ?? [];
  const known = new Set([
    ...words(description),
    ...words(unit ?? ''),
    amount ?? '',
    'us',
    'usd',
    'per',
  ]);
  const extra = words(text).filter((w) => !known.has(w) && !known.has(w.replace(/s$/, '')));
  return {
    description: description.slice(0, 200),
    amount,
    unit,
    remark: extra.length ? text.slice(0, 500) : null,
  };
}

/** A quotation's notes as its extra charges, one per line that says something. */
export function parseChargeLines(notes: string | null | undefined): QuotationExtraCharge[] {
  return String(notes ?? '')
    .split(/\r?\n/)
    .map(parseChargeLine)
    .filter((c): c is QuotationExtraCharge => !!c);
}
