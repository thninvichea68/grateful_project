// @vitest-environment node
import { degrees, PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  burstPdf,
  formatRanges,
  mergePdfs,
  organizePdf,
  parseRanges,
  removePages,
  splitPdf,
} from './pdfEngine';

/** A PDF whose pages are 100, 200, … points wide, so pages can be told apart. */
async function makePdf(pages: number, name = 'doc.pdf'): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pages; i++) doc.addPage([i * 100, 500]);
  return new File([await doc.save()], name, { type: 'application/pdf' });
}

const widths = async (blob: Blob) =>
  (await PDFDocument.load(await blob.arrayBuffer())).getPages().map((p) => p.getWidth());

describe('parseRanges', () => {
  it('reads single pages, ranges and open ends', () => {
    expect(parseRanges('1-3, 5, 8-', 9)).toEqual([[0, 1, 2], [4], [7, 8]]);
    expect(parseRanges('-2', 5)).toEqual([[0, 1]]);
  });

  it('rejects pages outside the document', () => {
    expect(() => parseRanges('4-6', 5)).toThrow(/outside pages 1–5/);
    expect(() => parseRanges('3-1', 5)).toThrow();
    expect(() => parseRanges('0', 5)).toThrow();
  });

  it('formats a selection back into ranges', () => {
    expect(formatRanges([4, 0, 1, 2, 7, 1])).toBe('1-3, 5, 8');
    expect(formatRanges([])).toBe('');
  });

  it('rejects text that is not a range', () => {
    expect(() => parseRanges('a-b', 5)).toThrow(/not a page range/);
    expect(() => parseRanges(' , ', 5)).toThrow(/at least one/);
  });
});

describe('page tools', () => {
  it('merges in order', async () => {
    expect(await widths(await mergePdfs([await makePdf(2), await makePdf(1)]))).toEqual([
      100, 200, 100,
    ]);
  });

  it('splits per range or into one extract', async () => {
    const file = await makePdf(5, 'inv.pdf');
    const each = await splitPdf(file, '1-2, 4', 'each');
    expect(each.map((f) => f.name)).toEqual(['inv-p1-2.pdf', 'inv-p4.pdf']);
    expect(await widths(each[0]!.blob)).toEqual([100, 200]);
    const single = await splitPdf(file, '5, 1', 'single');
    expect(await widths(single[0]!.blob)).toEqual([500, 100]);
    expect(await burstPdf(file)).toHaveLength(5);
  });

  it('removes pages and keeps at least one', async () => {
    const file = await makePdf(5);
    expect(await widths(await removePages(file, [0, 2, 3]))).toEqual([200, 500]);
    await expect(removePages(file, [0, 1, 2, 3, 4])).rejects.toThrow(/At least one page/);
  });

  it('reorders, drops and rotates pages', async () => {
    const out = await organizePdf(await makePdf(3), [
      { index: 2, rotate: 90 },
      { index: 0, rotate: 0 },
    ]);
    const doc = await PDFDocument.load(await out.arrayBuffer());
    expect(doc.getPages().map((p) => p.getWidth())).toEqual([300, 100]);
    expect(doc.getPage(0).getRotation()).toEqual(degrees(90));
  });
});
