import { useRef, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { clearanceStatusOf, type DocumentRow } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useApiMutation, useDocuments } from '../../features/admin';
import { DocumentPreview } from '../../components/DocumentPreview';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { downloadFile } from '../../lib/files';
import { fmtDate, fmtFileSize } from '../../lib/format';
import type { FormValues } from './formModel';
import d from './DocumentsTab.module.css';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Documents tab: once customs is cleared, the shipment's documents are merged into one file
 * and uploaded here. One file per shipment; uploading again replaces it.
 */
export function DocumentsTab({
  shipmentId,
  reference,
}: {
  shipmentId: string | undefined;
  reference: string | undefined;
}) {
  const { control } = useFormContext<FormValues>();
  const [clientId, declarations] = useWatch({ control, name: ['clientId', 'declarations'] });
  const { can } = useAuth();
  const toast = useToast();
  const docs = useDocuments({ shipmentId, pageSize: 50 }, !!shipmentId);
  const [previewing, setPreviewing] = useState<DocumentRow | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const writable = can('documents:write');

  const upload = useApiMutation(
    (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', `Clearance documents ${reference ?? ''}`.trim());
      fd.append('category', 'CLEARANCE_DOCUMENTS');
      fd.append('shipmentId', shipmentId!);
      if (clientId) fd.append('clientId', clientId);
      return api('/documents', { method: 'POST', body: fd });
    },
    [['documents']],
  );
  const remove = useApiMutation(
    (id: string) => api(`/documents/${id}`, { method: 'DELETE' }),
    [['documents']],
  );

  if (!shipmentId)
    return (
      <section className={d.card}>
        <div className={d.head}>
          <h3 className={d.title}>Documents</h3>
        </div>
        <p className={d.empty}>Save the shipment first, then upload its documents here.</p>
      </section>
    );

  const all = docs.data?.data ?? [];
  const file = all.find((x) => x.category === 'CLEARANCE_DOCUMENTS');
  // Anything attached elsewhere (e.g. the Documents page) is listed under it.
  const others = all.filter((x) => x !== file);
  const cleared = clearanceStatusOf({ declarations: declarations ?? [] }) === 'CLEARED';
  const state = file ? 'done' : cleared ? 'due' : 'wait';

  const send = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) return toast(`${f.name} is over 20 MB.`);
    try {
      await upload.mutateAsync(f);
      // One file per shipment: the new upload replaces the old one.
      if (file) await remove.mutateAsync(file.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Upload failed. Try again.');
    }
  };
  const pick = () => input.current?.click();
  const busy = upload.isPending || remove.isPending;

  const row = (x: DocumentRow, main: boolean) => (
    <div key={x.id} className={main ? d.fileMain : d.file}>
      <button type="button" className={d.fileBody} onClick={() => setPreviewing(x)} title="Preview">
        <span className={d.fileIcon} aria-hidden>
          {x.originalName.split('.').pop()?.toUpperCase().slice(0, 4)}
        </span>
        <span className={d.fileText}>
          <b>{x.originalName}</b>
          <small>
            {fmtFileSize(x.sizeBytes)} · {fmtDate(x.createdAt)}
            {x.uploadedBy ? ` · ${x.uploadedBy}` : ''}
          </small>
        </span>
      </button>
      <div className={d.fileActions}>
        <button type="button" className={d.btn} onClick={() => setPreviewing(x)}>
          Preview
        </button>
        <button
          type="button"
          className={d.btn}
          onClick={() =>
            void downloadFile(`/documents/${x.id}/download`).catch(() =>
              toast('Download failed. Try again.'),
            )
          }
        >
          Download
        </button>
        {main && writable && (
          <button type="button" className={d.btn} disabled={busy} onClick={pick}>
            {busy ? 'Uploading…' : 'Replace'}
          </button>
        )}
        {writable && (
          <button
            type="button"
            className={`${d.btn} ${d.danger}`}
            aria-label={`Remove ${x.originalName}`}
            title="Remove"
            onClick={() => {
              if (window.confirm(`Remove ${x.originalName}?`)) remove.mutate(x.id);
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );

  return (
    <section className={d.card}>
      <div className={d.head}>
        <h3 className={d.title}>Clearance Documents</h3>
        <span className={d.badge} data-state={state}>
          {state === 'done' ? 'Uploaded' : state === 'due' ? 'Ready to upload' : 'After clearance'}
        </span>
      </div>
      <div className={d.body}>
        {file ? (
          row(file, true)
        ) : (
          <div
            className={d.drop}
            data-over={dragging}
            data-disabled={!writable}
            onDragOver={(e) => {
              if (!writable) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (writable) void send(e.dataTransfer.files[0]);
            }}
          >
            <span className={d.dropIcon} aria-hidden>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 16V4m0 0-5 5m5-5 5 5M4 20h16" />
              </svg>
            </span>
            <b>{busy ? 'Uploading…' : 'Drop the merged PDF here'}</b>
            {writable && (
              <button type="button" className={d.primary} disabled={busy} onClick={pick}>
                Choose file
              </button>
            )}
          </div>
        )}
        {others.length > 0 && (
          <div className={d.others}>
            <div className={d.othersHead}>Other files</div>
            {others.map((x) => row(x, false))}
          </div>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          void send(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {previewing && <DocumentPreview doc={previewing} onClose={() => setPreviewing(null)} />}
    </section>
  );
}
