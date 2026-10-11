import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreditNoteDeclarations } from '../../features/accounting';
import { ErrorBanner, Modal, ui } from '../../components/ui';
import { SearchBox } from '../../components/SearchBox';
import { fmtDate } from '../../lib/format';
import s from './NewCreditNoteModal.module.css';

/** Pick the customs declaration a new Credit Noted is for; the form fills from its shipment. */
export function NewCreditNoteModal({ base, onClose }: { base: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const list = useCreditNoteDeclarations(q, true);
  return (
    <Modal
      title="New Credit Noted"
      sub="Choose the declaration. Shipper, port, container, house bill and weights fill in from the shipment."
      onClose={onClose}
      width={620}
    >
      <SearchBox
        placeholder="Declare no, shipment ref, client…"
        onChange={(e) => setQ(e.target.value.trim())}
        aria-label="Search declarations"
      />
      <ErrorBanner error={list.error} />
      <ul className={s.list}>
        {list.isLoading && <li className={s.empty}>Loading…</li>}
        {list.data?.length === 0 && <li className={s.empty}>No declarations match.</li>}
        {list.data?.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              className={s.row}
              onClick={() => navigate(`${base}/new?declarationId=${d.id}`)}
            >
              <span className={s.main}>
                <b>{d.declareNo}</b>
                <span>
                  {d.clientCode} · {d.shipmentReference} · {fmtDate(d.declareDate)}
                </span>
              </span>
              <span className={d.direction === 'IMPORT' ? s.imp : s.exp}>
                {d.direction === 'IMPORT' ? 'Import' : 'Export'}
              </span>
              {d.creditNoteNo && (
                <span className={s.has} title="This declaration already has a credit note">
                  Has {d.creditNoteNo}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className={ui.actions}>
        <button
          type="button"
          className="btn-cancel-shipment"
          onClick={() => navigate(`${base}/new`)}
        >
          Start blank
        </button>
      </div>
    </Modal>
  );
}
