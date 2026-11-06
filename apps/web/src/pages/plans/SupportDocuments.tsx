import { useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { DocumentUploadModal } from '../../components/DocumentUpload';
import { Modal, ui } from '../../components/ui';
import { useDocuments } from '../../features/admin';
import { icons } from '../../layout/icons';
import { DocumentTable } from '../DocumentsPage';
import s from './SupportDocuments.module.css';

/**
 * What the documents belong to: a shipment, a credit note or a record summary (support
 * documents), or the client itself / Grateful (attachments).
 */
export type SupportLink =
  | { shipmentId: string }
  | { creditNoteId: string }
  | { recordSummaryId: string }
  | { attachedTo: 'client' }
  | { attachedTo: 'company' };

/**
 * Support documents (Shipping Plans → ⋯ → Support Documents; a credit note's or record
 * summary's ⋯ → Upload support documents): the files, each up to 10 MB, to preview, download,
 * edit or delete, and + Upload for another. They are ordinary Document Library entries linked
 * to what they support.
 */
export function SupportDocumentsModal({
  title,
  link,
  clientId,
  onClose,
}: {
  /** e.g. "SHP-26-0155" or "Credit Note No. 28". */
  title: string;
  link: SupportLink;
  /** The client the files are filed under (none for Grateful's own). */
  clientId?: string;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const attachment = 'attachedTo' in link ? link.attachedTo : null;
  const list = useDocuments({
    ...link,
    ...(attachment === 'client' ? { clientId } : {}),
    pageSize: 200,
  });
  const [uploading, setUploading] = useState(false);
  // A shipment's, credit note's or record summary's files stay 10 MB; attachments 20 MB.
  const maxMb = attachment ? 20 : 10;
  const what = attachment
    ? attachment
    : 'shipmentId' in link
      ? 'shipment'
      : 'creditNoteId' in link
        ? 'credit note'
        : 'record summary';
  return (
    <Modal
      title={`${attachment ? 'Attachments' : 'Support documents'} · ${title}`}
      sub={`Files kept with this ${what}: PDF, images, Excel, CSV, Word or text, up to ${maxMb} MB each.`}
      onClose={onClose}
      // Near the full page width, so the file list reads like the Document Library.
      width={1400}
    >
      {can('documents:write') && (
        <div className={ui.toolbar} style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
          <button type="button" className="new-shipment-btn" onClick={() => setUploading(true)}>
            + Upload
          </button>
        </div>
      )}
      {/* Tall even when empty; scrolls with the dialog once the list outgrows the screen. */}
      <div style={{ minHeight: 'min(460px, 60vh)' }}>
        <DocumentTable rows={list.data?.data} loading={list.isLoading} error={list.error} />
      </div>
      {uploading && (
        <DocumentUploadModal
          {...('attachedTo' in link ? {} : link)}
          clientId={clientId}
          company={attachment === 'company'}
          maxMb={maxMb}
          onClose={() => setUploading(false)}
        />
      )}
    </Modal>
  );
}

/**
 * The paperclip button at the top right of Settings → Workspace & company (attachedTo company;
 * a client's files have their own sidebar card, clients/AttachmentsCard): the count of files,
 * opening the list to view, download or + Upload.
 */
export function AttachmentsButton({
  attachedTo,
  clientId,
  title,
}: {
  attachedTo: 'client' | 'company';
  clientId?: string;
  /** The dialog's title after "Attachments ·", e.g. the client's name. */
  title: string;
}) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const allowed = can('documents:read');
  // The same query as the dialog's list, so the count and the list share one fetch.
  const list = useDocuments(
    { attachedTo, ...(attachedTo === 'client' ? { clientId } : {}), pageSize: 200 },
    allowed,
  );
  if (!allowed) return null;
  const count = list.data?.meta.total ?? 0;
  return (
    <>
      <button
        type="button"
        className={s.attachBtn}
        onClick={() => setOpen(true)}
        title="Files kept with these details"
      >
        {icons.paperclip({})}
        Attachments
        {count > 0 && <span className={s.count}>{count}</span>}
      </button>
      {open && (
        <SupportDocumentsModal
          title={title}
          link={{ attachedTo }}
          clientId={clientId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
