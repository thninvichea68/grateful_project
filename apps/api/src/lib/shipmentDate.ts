import { sql, type SQL } from 'drizzle-orm';

/**
 * The date a shipment belongs to, for periods and monthly figures: an import's ETA, an
 * export's ETD (exports have no ETA). Each falls back to the other date when it is missing.
 */
export const shipmentDate = (alias = 's'): SQL => {
  const s = sql.raw(alias);
  return sql`(CASE WHEN ${s}.direction = 'EXPORT' THEN coalesce(${s}.etd, ${s}.eta) ELSE coalesce(${s}.eta, ${s}.etd) END)`;
};

/** The same rule for a shipment being saved (its numbering year). */
export const shipmentDateOf = (s: {
  direction: string;
  eta?: string | null;
  etd?: string | null;
}): string | null => (s.direction === 'EXPORT' ? (s.etd ?? s.eta) : (s.eta ?? s.etd)) || null;
