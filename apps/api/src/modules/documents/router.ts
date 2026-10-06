import { Router } from 'express';
import multer from 'multer';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { documentListQuerySchema, documentMetaSchema, type DocumentRow } from '@gs/shared';
import { db } from '../../db/client';
import { documents } from '../../db/schema';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { parse } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { likePattern, paginate, queryRows, toPaginated, whereAll, isoTs } from '../../lib/listing';
import { fileExists, putFile, readFile } from '../../lib/storage';

const ALLOWED = /\.(pdf|png|jpe?g|webp|xlsx|xls|csv|docx|doc|txt)$/i;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) =>
    ALLOWED.test(file.originalname)
      ? cb(null, true)
      : cb(badRequest('Allowed files: PDF, images (PNG/JPG/WEBP), Excel, CSV, Word or text')),
}).single('file');

/**
 * The extension must match the file's actual content (magic bytes), so e.g. an
 * executable renamed to .pdf is refused. Text formats are checked for binary bytes.
 */
export function contentMatchesExtension(name: string, buf: Buffer): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const starts = (...bytes: number[]) => bytes.every((b, i) => buf[i] === b);
  switch (ext) {
    case 'pdf':
      return buf.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'png':
      return starts(0x89, 0x50, 0x4e, 0x47);
    case 'jpg':
    case 'jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'webp':
      return (
        buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
        buf.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    case 'xlsx':
    case 'docx':
      return starts(0x50, 0x4b, 0x03, 0x04); // zip container
    case 'xls':
    case 'doc':
      return starts(0xd0, 0xcf, 0x11, 0xe0); // OLE container
    case 'csv':
    case 'txt':
      return !buf.subarray(0, 4096).includes(0);
    default:
      return false;
  }
}

const idParam = z.object({ id: z.string().uuid() });
export const documentsRouter = Router();
documentsRouter.use(requireAuth);

const SELECT = sql`
  SELECT d.id, d.title, d.original_name AS "originalName", d.mime_type AS "mimeType", d.size_bytes AS "sizeBytes", d.category,
         d.status_label AS "statusLabel", d.shipment_id AS "shipmentId", s.reference AS "shipmentReference", d.client_id AS "clientId",
         c.name AS "clientName", u.full_name AS "uploadedBy", ${isoTs('d.created_at')} AS "createdAt"
  FROM documents d LEFT JOIN shipments s ON s.id = d.shipment_id LEFT JOIN clients c ON c.id = d.client_id LEFT JOIN users u ON u.id = d.uploaded_by_id`;

documentsRouter.get('/', requirePermission('documents:read'), async (req, res) => {
  const q = parse(documentListQuerySchema, req.query);
  const c = [sql`d.deleted_at IS NULL`];
  if (q.category) c.push(sql`d.category = ${q.category}`);
  if (q.shipmentId) c.push(sql`d.shipment_id = ${q.shipmentId}`);
  if (q.clientId) c.push(sql`d.client_id = ${q.clientId}`);
  if (q.q) {
    const like = likePattern(q.q);
    c.push(
      sql`(d.title ILIKE ${like} OR d.original_name ILIKE ${like} OR s.reference ILIKE ${like} OR c.name ILIKE ${like})`,
    );
  }
  const rows = await queryRows<DocumentRow & { total_count: string }>(
    db,
    sql`
    SELECT x.*, count(*) OVER () AS total_count FROM (${SELECT} ${whereAll(c)}) x ORDER BY x."createdAt" DESC ${paginate(q.page, q.pageSize)}`,
  );
  res.json(
    toPaginated(
      rows.map((r) => ({ ...r, sizeBytes: Number(r.sizeBytes) })),
      q.page,
      q.pageSize,
    ),
  );
});

/** multipart/form-data: file + title, category, statusLabel, shipmentId, clientId. */
documentsRouter.post('/', requirePermission('documents:write'), upload, async (req, res) => {
  if (!req.file) throw badRequest('Attach the file in a form field named "file"');
  if (!contentMatchesExtension(req.file.originalname, req.file.buffer))
    throw badRequest(
      `The file's content doesn't match its .${req.file.originalname.split('.').pop()} extension`,
    );
  const meta = parse(documentMetaSchema, {
    ...req.body,
    title: req.body.title || req.file.originalname,
  });
  const stored = await putFile(req.file.buffer, req.file.originalname);
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(documents)
      .values({
        ...meta,
        originalName: req.file!.originalname.slice(0, 200),
        mimeType: req.file!.mimetype || 'application/octet-stream',
        sizeBytes: req.file!.size,
        storageKey: stored.key,
        sha256: stored.sha256,
        uploadedById: req.auth!.userId,
      })
      .returning();
    await audit(tx, { action: 'CREATE', entity: 'document', entityId: row!.id, after: row }, req);
    return row!.id;
  });
  const [row] = await queryRows<DocumentRow>(db, sql`${SELECT} WHERE d.id = ${id}`);
  res.status(201).json({ ...row, sizeBytes: Number(row!.sizeBytes) });
});

documentsRouter.get('/:id/download', requirePermission('documents:read'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const [d] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)));
  if (!d || !(await fileExists(d.storageKey))) throw notFound('File');
  const inline =
    req.query.inline === '1' && /^(application\/pdf|image\/(png|jpeg|webp))$/.test(d.mimeType);
  res.setHeader('Content-Type', inline ? d.mimeType : 'application/octet-stream');
  res.setHeader('Content-Length', String(d.sizeBytes));
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(d.originalName)}`,
  );
  res.setHeader('Cache-Control', 'private, no-store');
  readFile(d.storageKey)
    .on('error', () => res.destroy())
    .pipe(res);
});

documentsRouter.patch('/:id', requirePermission('documents:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const v = Object.fromEntries(
    Object.entries(parse(documentMetaSchema.partial(), req.body)).filter(
      ([, x]) => x !== undefined,
    ),
  );
  const [row] = await db
    .update(documents)
    .set(v)
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
    .returning();
  if (!row) throw notFound('Document');
  await audit(db, { action: 'UPDATE', entity: 'document', entityId: id, after: v }, req);
  res.json(row);
});

/** Soft delete: the file is kept on disk for the audit trail. */
documentsRouter.delete('/:id', requirePermission('documents:write'), async (req, res) => {
  const { id } = parse(idParam, req.params);
  const [row] = await db
    .update(documents)
    .set({ deletedAt: new Date() })
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
    .returning();
  if (!row) throw notFound('Document');
  await audit(db, { action: 'DELETE', entity: 'document', entityId: id, before: row }, req);
  res.status(204).end();
});
