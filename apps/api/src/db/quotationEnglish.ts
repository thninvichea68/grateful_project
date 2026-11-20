import { eq } from 'drizzle-orm';
import { hasCjk, parseChargeLines, toEnglish } from '@gs/shared';
import type { DbOrTx } from './client';
import {
  quotationCharges,
  quotationLines,
  quotations,
  quotationTemplates,
  quotationTextBackup,
} from './schema';

/**
 * Quotations are kept in English only, with their notes as a list of extra charges. Run after
 * migrating (db:migrate); safe to run again: it only touches text that still has Chinese in it
 * and notes not yet turned into charges, and keeps the text it replaces in quotation_text_backup.
 */
export async function quotationsToEnglish(db: DbOrTx): Promise<{
  templates: number;
  quotes: number;
  lines: number;
  charges: number;
}> {
  const out = { templates: 0, quotes: 0, lines: 0, charges: 0 };
  return db.transaction(async (tx) => {
    // Service templates: label, document title, standard rows and notes.
    for (const t of await tx.select().from(quotationTemplates)) {
      const before = JSON.stringify([t.label, t.docTitle, t.defaultRows, t.notes]);
      if (!hasCjk(before)) continue;
      await tx.insert(quotationTextBackup).values({ kind: 'template', ref: t.key, data: t });
      await tx
        .update(quotationTemplates)
        .set({
          label: toEnglish(t.label),
          docTitle: toEnglish(t.docTitle),
          defaultRows: t.defaultRows.map((r) => r.map((c) => toEnglish(c))),
          notes: t.notes ? toEnglish(t.notes) || null : null,
        })
        .where(eq(quotationTemplates.key, t.key));
      out.templates++;
    }

    // Rate rows.
    for (const l of await tx.select().from(quotationLines)) {
      if (!hasCjk(JSON.stringify(l.cells))) continue;
      await tx.insert(quotationTextBackup).values({ kind: 'line', ref: l.id, data: l });
      const cells = Object.fromEntries(Object.entries(l.cells).map(([k, v]) => [k, toEnglish(v)]));
      await tx.update(quotationLines).set({ cells }).where(eq(quotationLines.id, l.id));
      out.lines++;
    }

    // Notes → extra charges (once per quotation), the free text cleared once it is a list.
    const quotes = await tx.select().from(quotations);
    const withCharges = new Set(
      (
        await tx
          .select({ q: quotationCharges.quotationId })
          .from(quotationCharges)
          .groupBy(quotationCharges.quotationId)
      ).map((r) => r.q),
    );
    for (const q of quotes) {
      const toFix = (q.notes && !withCharges.has(q.id)) || hasCjk(q.toName) || hasCjk(q.attn);
      if (!toFix) continue;
      await tx.insert(quotationTextBackup).values({
        kind: 'quotation',
        ref: q.id,
        data: { notes: q.notes, toName: q.toName, attn: q.attn },
      });
      if (q.notes && !withCharges.has(q.id)) {
        const charges = parseChargeLines(q.notes);
        if (charges.length)
          await tx
            .insert(quotationCharges)
            .values(charges.map((c, i) => ({ ...c, quotationId: q.id, lineNo: i + 1 })));
        out.charges += charges.length;
      }
      await tx
        .update(quotations)
        .set({
          notes: null,
          toName: toEnglish(q.toName) || q.toName,
          attn: q.attn ? toEnglish(q.attn) || null : null,
        })
        .where(eq(quotations.id, q.id));
      out.quotes++;
    }
    return out;
  });
}
