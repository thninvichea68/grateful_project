import { useState } from 'react';
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL, type DocumentCategory } from '@gs/shared';
import { useApiMutation } from '../features/admin';
import { useLookups } from '../features/hooks';
import { api } from '../lib/api';
import { ErrorBanner, Modal, ui } from './ui';
import { useToast } from './Toast';

/** Upload one file with its metadata. Pass shipmentId/clientId to link it. */
export function DocumentUploadModal({
  shipmentId,
  clientId,
  defaultCategory = 'OTHER',
  onClose,
}: {
  shipmentId?: string;
  clientId?: string;
  defaultCategory?: DocumentCategory;
  onClose: () => void;
}) {
  const lookups = useLookups();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategory>(defaultCategory);
  const [statusLabel, setStatusLabel] = useState('');
  const [client, setClient] = useState(clientId ?? '');
  const upload = useApiMutation(() => {
    const fd = new FormData();
    fd.append('file', file!);
    fd.append('title', title || file!.name);
    fd.append('category', category);
    if (statusLabel) fd.append('statusLabel', statusLabel);
    if (shipmentId) fd.append('shipmentId', shipmentId);
    if (client) fd.append('clientId', client);
    return api('/documents', { method: 'POST', body: fd });
  }, [['documents'], ['operations']]);
  const tooBig = !!file && file.size > 20 * 1024 * 1024;
  return (
    <Modal
      title="Upload document"
      sub="PDF, images, Excel, CSV, Word or text · up to 20 MB"
      onClose={onClose}
      width={560}
    >
      <ErrorBanner error={upload.error} />
      <div className="form-fields-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
          <label htmlFor="up-file">File</label>
          <input
            id="up-file"
            type="file"
            className="form-field-box"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.docx,.doc,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
          {tooBig && <span className={ui.fieldError}>This file is larger than 20 MB.</span>}
        </div>
        <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
          <label htmlFor="up-title">Title</label>
          <input
            id="up-title"
            className="form-field-box"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Original BL — SHP-26-0012"
          />
        </div>
        <div className="form-field-group">
          <label htmlFor="up-cat">Category</label>
          <select
            id="up-cat"
            className="form-select-box"
            value={category}
            onChange={(e) => setCategory(e.target.value as DocumentCategory)}
          >
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {DOCUMENT_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field-group">
          <label htmlFor="up-status">Status</label>
          <input
            id="up-status"
            className="form-field-box"
            value={statusLabel}
            onChange={(e) => setStatusLabel(e.target.value)}
            placeholder="e.g. Signed, Verified"
          />
        </div>
        {!clientId && (
          <div className="form-field-group" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="up-client">Client</label>
            <select
              id="up-client"
              className="form-select-box"
              value={client}
              onChange={(e) => setClient(e.target.value)}
            >
              <option value="">— none —</option>
              {lookups.data?.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className={ui.actions}>
        <button type="button" className="btn-cancel-shipment" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-create-submit"
          disabled={!file || tooBig || upload.isPending}
          onClick={() =>
            void upload.mutateAsync(undefined).then(() => {
              toast('Document uploaded.');
              onClose();
            })
          }
        >
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </button>
      </div>
    </Modal>
  );
}
