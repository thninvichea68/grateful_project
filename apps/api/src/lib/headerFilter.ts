import { sql, type SQL } from 'drizzle-orm';
import type { HeaderFilters } from '@gs/shared';

/**
 * One list column's Excel-style header filter: the text it shows (`value`), or the texts when a
 * cell lists several (`many`, a text[] such as a shipment's containers), and what it sorts by.
 */
export type FilterColumn = { value: SQL; order?: SQL } | { many: SQL; order?: SQL };
export type FilterColumns = Record<string, FilterColumn>;

const textArray = (vals: string[]) =>
  sql`ARRAY[${sql.join(
    vals.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;

/** What the column sorts by: its own order, else its value (the first of several). */
export const columnOrder = (c: FilterColumn): SQL =>
  c.order ?? ('value' in c ? c.value : sql`(${c.many})[1]`);

/**
 * The header filters as conditions; `except` leaves out that column's own filter (its value
 * list shows what the other filters leave, as Excel does). Unknown columns are ignored.
 * A cell with several values is kept when any of them is.
 */
export function headerFilterConds(
  cols: FilterColumns,
  filters: HeaderFilters | undefined,
  except?: string,
): SQL[] {
  const out: SQL[] = [];
  for (const [k, kept] of Object.entries(filters ?? {})) {
    const c = Object.hasOwn(cols, k) ? cols[k] : undefined;
    if (!c || k === except) continue;
    if (!kept.length) {
      out.push(sql`false`);
      continue;
    }
    if ('value' in c) {
      out.push(
        sql`coalesce(${c.value}, '') IN (${sql.join(
          kept.map((v) => sql`${v}`),
          sql`, `,
        )})`,
      );
      continue;
    }
    const arr = sql`coalesce(${c.many}, '{}'::text[])`;
    const blank = kept.includes('') ? sql` OR cardinality(${arr}) = 0` : sql``;
    out.push(sql`(${arr} && ${textArray(kept)}${blank})`);
  }
  return out;
}

/**
 * A column's distinct values for its checklist, in the column's order ('' = blank cells).
 * `from` is the list's FROM … WHERE, already holding the other filters.
 */
export function headerFilterValuesQuery(c: FilterColumn, from: SQL): SQL {
  if ('value' in c)
    return sql`SELECT v FROM (
        SELECT DISTINCT coalesce(${c.value}, '') AS v, ${columnOrder(c)} AS o ${from}
      ) x ORDER BY o NULLS LAST, v LIMIT 2000`;
  return sql`SELECT v FROM (
      SELECT DISTINCT v FROM (
        SELECT CASE WHEN cardinality(coalesce(${c.many}, '{}'::text[])) = 0 THEN ARRAY['']
                    ELSE ${c.many} END AS vs ${from}
      ) x, unnest(x.vs) AS v
    ) y ORDER BY v = '', v LIMIT 2000`;
}
