import { useState } from 'react';
import type { DocumentRow } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { DocumentPreview } from '../../components/DocumentPreview';
import { DocumentUploadModal } from '../../components/DocumentUpload';
import { useToast } from '../../components/Toast';
import { ErrorBanner } from '../../components/ui';
import { useDocuments } from '../../features/admin';
import { icons } from '../../layout/icons';
import { downloadFile } from '../../lib/files';
import { fmtDate, fmtFileSize } from '../../lib/format';
import { SupportDocumentsModal } from '../plans/SupportDocuments';
import s from './AttachmentsCard.module.css';

/** Files listed in the card; the rest behind "Manage all". */
const PREVIEW = 5;

/**
 * Client Details sidebar, under Remarks: the client's attachments (attachedTo client). Click a
 * file to preview it; "Manage all" opens the full list (edit, delete) in the same dialog the
 * Settings → Workspace & company attachments use.
 */
export function AttachmentsCard({ clientId, title }: { clientId: string; title: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const allowed = can('documents:read');
  const list = useDocuments({ attachedTo: 'client', clientId, pageSize: 200 }, allowed);
  const [previewing, setPreviewing] = useState<DocumentRow | null>(null);
  const [uploading, setUploading] = useState(false);
  const [managing, setManaging] = useState(false);
  if (!allowed) return null;

  const rows = list.data?.data ?? [];
  const total = list.data?.meta.total ?? rows.length;
  return (
    <div className="card">
      <div className="card-header-row">
        <h3>Attachments {total > 0 && <span className={s.count}>{total}</span>}</h3>
        {can('documents:write') && (
          <button type="button" className="filter-btn" onClick={() => setUploading(true)}>
            + Upload
          </button>
        )}
      </div>
      <ErrorBanner error={list.error} />
      {list.isLoading ? (
        <span className={s.muted}>Loading…</span>
      ) : rows.length === 0 ? (
        <span className={s.muted}>
          No files yet. Keep contracts, licences or registration papers here.
        </span>
      ) : (
        <ul className={s.list}>
          {rows.slice(0, PREVIEW).map((d) => (
            <li key={d.id} className={s.row}>
              <button
                type="button"
                className={s.item}
                onClick={() => setPreviewing(d)}
                title="Preview"
              >
                <span className={s.icon}>{icons.paperclip({ width: 15, height: 15 })}</span>
                <span className={s.text}>
                  <b>{d.title}</b>
                  <small>
                    {fmtFileSize(d.sizeBytes)} · {fmtDate(d.createdAt)}
                  </small>
                </span>
              </button>
              <button
                type="button"
                className={s.download}
                onClick={() =>
                  downloadFile(`/documents/${d.id}/download`).catch(() => toast('Download failed.'))
                }
                title="Download"
                aria-label={`Download ${d.title}`}
              >
                {icons.download({ width: 14, height: 14 })}
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <button type="button" className={s.more} onClick={() => setManaging(true)}>
          {total > PREVIEW ? `Manage all ${total}` : 'Manage files'}
        </button>
      )}
      {previewing && <DocumentPreview doc={previewing} onClose={() => setPreviewing(null)} />}
      {uploading && (
        <DocumentUploadModal clientId={clientId} maxMb={20} onClose={() => setUploading(false)} />
      )}
      {managing && (
        <SupportDocumentsModal
          title={title}
          link={{ attachedTo: 'client' }}
          clientId={clientId}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  );
}
