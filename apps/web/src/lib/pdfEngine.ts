/**
 * PDF Tools engine: everything runs in the browser (pdf-lib to build files, pdf.js to render
 * pages), so documents never leave the user's machine.
 */
import { degrees, PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface OutFile {
  name: string;
  blob: Blob;
}

const PDF_MIME = 'application/pdf';
const pdfBlob = (bytes: Uint8Array) => new Blob([bytes], { type: PDF_MIME });
export const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

/** pdf.js is loaded on first use only, so it isn't in the main bundle. */
let pdfjsReady: Promise<typeof import('pdfjs-dist')> | null = null;
function pdfjs() {
  pdfjsReady ??= (async () => {
    const lib = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })();
  return pdfjsReady;
}

/** Open a PDF with pdf.js for drawing pages; the caller destroys it. */
export async function openForRender(file: Blob): Promise<PDFDocumentProxy> {
  const lib = await pdfjs();
  return lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false })
    .promise;
}

async function openForEdit(file: Blob): Promise<PDFDocument> {
  return PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not draw page'))),
      type,
      quality,
    ),
  );
}

/** Draw every page to a canvas at `scale` (1 = 72 dpi) and hand it to `each`. */
async function eachRenderedPage(
  file: Blob,
  scale: number,
  each: (canvas: HTMLCanvasElement, index: number, total: number) => Promise<void>,
): Promise<void> {
  const doc = await openForRender(file);
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d')!;
      // White behind transparent pages, so JPEGs don't come out black.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      await each(canvas, i - 1, doc.numPages);
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
}

/** Small page previews (data URLs) for the page organizer. */
export async function thumbnails(file: Blob, width = 160): Promise<string[]> {
  const doc = await openForRender(file);
  const out: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
      out.push(canvas.toDataURL('image/jpeg', 0.7));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return out;
}

/**
 * Page ranges like "1-3, 5, 8-" (1-based, open end = last page) → groups of 0-based indexes.
 * Throws on anything outside 1..total.
 */
export function parseRanges(input: string, total: number): number[][] {
  const groups: number[][] = [];
  for (const raw of input.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d*)\s*(?:-\s*(\d*))?$/.exec(part);
    if (!m || (!m[1] && !m[2])) throw new Error(`"${part}" is not a page range`);
    const from = m[1] ? Number(m[1]) : 1;
    const to = part.includes('-') ? (m[2] ? Number(m[2]) : total) : from;
    if (from < 1 || to > total || from > to)
      throw new Error(`"${part}" is outside pages 1–${total}`);
    groups.push(Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i));
  }
  if (!groups.length) throw new Error('Enter at least one page range');
  return groups;
}

export async function pageCount(file: Blob): Promise<number> {
  return (await openForEdit(file)).getPageCount();
}

/** Join PDFs in the given order. */
export async function mergePdfs(files: Blob[]): Promise<Blob> {
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await openForEdit(f);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return pdfBlob(await out.save());
}

async function pickPages(src: PDFDocument, indexes: number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indexes);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

/**
 * Split by ranges. `mode: 'each'` makes one file per range; `'single'` puts every selected
 * page into one file (extract pages).
 */
export async function splitPdf(
  file: File,
  ranges: string,
  mode: 'each' | 'single',
): Promise<OutFile[]> {
  const src = await openForEdit(file);
  const groups = parseRanges(ranges, src.getPageCount());
  const stem = baseName(file.name);
  if (mode === 'single')
    return [{ name: `${stem}-extract.pdf`, blob: pdfBlob(await pickPages(src, groups.flat())) }];
  const out: OutFile[] = [];
  for (const g of groups) {
    const label = g.length === 1 ? `p${g[0]! + 1}` : `p${g[0]! + 1}-${g[g.length - 1]! + 1}`;
    out.push({ name: `${stem}-${label}.pdf`, blob: pdfBlob(await pickPages(src, g)) });
  }
  return out;
}

/** Every page as its own PDF. */
export async function burstPdf(file: File): Promise<OutFile[]> {
  const src = await openForEdit(file);
  const stem = baseName(file.name);
  const out: OutFile[] = [];
  for (const i of src.getPageIndices())
    out.push({ name: `${stem}-p${i + 1}.pdf`, blob: pdfBlob(await pickPages(src, [i])) });
  return out;
}

export interface PagePlan {
  /** 0-based page in the source file. */
  index: number;
  /** Extra clockwise rotation, a multiple of 90. */
  rotate: number;
}

/** Rebuild a PDF with pages reordered, rotated or removed. */
export async function organizePdf(file: Blob, plan: PagePlan[]): Promise<Blob> {
  const src = await openForEdit(file);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(
    src,
    plan.map((p) => p.index),
  );
  pages.forEach((page, i) => {
    const extra = plan[i]!.rotate;
    if (extra) page.setRotation(degrees((page.getRotation().angle + extra) % 360));
    out.addPage(page);
  });
  return pdfBlob(await out.save());
}

const A4: [number, number] = [595.28, 841.89];

/** JPEG and PNG embed directly; anything else the browser can show is redrawn as PNG. */
async function imageBytes(file: File): Promise<{ bytes: ArrayBuffer; kind: 'jpg' | 'png' }> {
  if (file.type === 'image/jpeg') return { bytes: await file.arrayBuffer(), kind: 'jpg' };
  if (file.type === 'image/png') return { bytes: await file.arrayBuffer(), kind: 'png' };
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  return { bytes: await (await canvasBlob(canvas, 'image/png')).arrayBuffer(), kind: 'png' };
}

/** One image per page; `fit` sizes each page to its image, `a4` centres it on A4 with a margin. */
export async function imagesToPdf(files: File[], pageSize: 'fit' | 'a4'): Promise<Blob> {
  const out = await PDFDocument.create();
  for (const f of files) {
    const { bytes, kind } = await imageBytes(f);
    const img = kind === 'jpg' ? await out.embedJpg(bytes) : await out.embedPng(bytes);
    if (pageSize === 'fit') {
      out.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0 });
      continue;
    }
    const landscape = img.width > img.height;
    const [w, h] = landscape ? [A4[1], A4[0]] : A4;
    const margin = 28;
    const s = Math.min((w - margin * 2) / img.width, (h - margin * 2) / img.height, 1);
    const dw = img.width * s;
    const dh = img.height * s;
    out.addPage([w, h]).drawImage(img, { x: (w - dw) / 2, y: (h - dh) / 2, width: dw, height: dh });
  }
  return pdfBlob(await out.save());
}

/** Each page as a PNG or JPEG at the given dpi. */
export async function pdfToImages(
  file: File,
  format: 'png' | 'jpeg',
  dpi: number,
  onProgress?: (done: number, total: number) => void,
): Promise<OutFile[]> {
  const stem = baseName(file.name);
  const ext = format === 'png' ? 'png' : 'jpg';
  const out: OutFile[] = [];
  await eachRenderedPage(file, dpi / 72, async (canvas, i, total) => {
    out.push({
      name: `${stem}-p${i + 1}.${ext}`,
      blob: await canvasBlob(canvas, `image/${format}`, 0.92),
    });
    onProgress?.(i + 1, total);
  });
  return out;
}

export const COMPRESS_LEVELS = {
  low: { label: 'Light — best quality', dpi: 150, quality: 0.8 },
  medium: { label: 'Recommended', dpi: 110, quality: 0.65 },
  high: { label: 'Strong — smallest file', dpi: 80, quality: 0.5 },
} as const;
export type CompressLevel = keyof typeof COMPRESS_LEVELS;

/**
 * Two passes, keeping whichever is smaller: a lossless re-save (object streams, drops unused
 * objects), and a scan-style rebuild that redraws each page as a JPEG. The rebuild shrinks
 * scanned and image-heavy files a lot but makes text unselectable, so it's only kept when it
 * is meaningfully smaller.
 */
export async function compressPdf(
  file: File,
  level: CompressLevel,
  onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; method: 'lossless' | 'rasterized' | 'unchanged' }> {
  const lossless = pdfBlob(await (await openForEdit(file)).save({ useObjectStreams: true }));

  const { dpi, quality } = COMPRESS_LEVELS[level];
  const out = await PDFDocument.create();
  await eachRenderedPage(file, dpi / 72, async (canvas, i, total) => {
    const jpg = await out.embedJpg(
      await (await canvasBlob(canvas, 'image/jpeg', quality)).arrayBuffer(),
    );
    // Keep the original page size in points.
    const w = (canvas.width * 72) / dpi;
    const h = (canvas.height * 72) / dpi;
    out.addPage([w, h]).drawImage(jpg, { x: 0, y: 0, width: w, height: h });
    onProgress?.(i + 1, total);
  });
  const rasterized = pdfBlob(await out.save());

  const best = Math.min(file.size, lossless.size, rasterized.size);
  if (rasterized.size === best && rasterized.size < lossless.size * 0.85)
    return { blob: rasterized, method: 'rasterized' };
  if (lossless.size < file.size) return { blob: lossless, method: 'lossless' };
  return { blob: file, method: 'unchanged' };
}

/** Bundle several outputs into one download. */
export async function zipFiles(files: OutFile[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  files.forEach((f) => zip.file(f.name, f.blob));
  return zip.generateAsync({ type: 'blob' });
}
