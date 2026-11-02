import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { ShipmentListItem } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useDeleteShipment } from '../../features/hooks';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import { downloadFile } from '../../lib/files';
import m from '../creditnoted/PackMenu.module.css';
import t from './PlansTable.module.css';

/**
 * The ⋯ at the end of a Shipping Plans row: open it, go to its documents, download its
 * invoice + packing list, or delete it. The menu is drawn on the page (not in the table) so
 * the scrolling table doesn't clip it.
 */
export function RowActions({ r }: { r: ShipmentListItem }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const del = useDeleteShipment();
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !menu.current?.contains(e.target as Node)
      )
        setAt(null);
    };
    const shut = () => setAt(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', shut, true);
    window.addEventListener('resize', shut);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', shut, true);
      window.removeEventListener('resize', shut);
    };
  }, [at]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (at) return setAt(null);
    const b = btn.current!.getBoundingClientRect();
    // Open upwards near the bottom of the window.
    const up = b.bottom + 260 > window.innerHeight;
    setAt({ top: up ? b.top - 6 : b.bottom + 6, right: window.innerWidth - b.right });
  };
  const pick = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setAt(null);
    fn();
  };
  const up = !!at && at.top < (btn.current?.getBoundingClientRect().top ?? 0);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={t.rowDots}
        aria-label={`Actions for ${r.hblNo ?? r.reference}`}
        aria-haspopup="menu"
        aria-expanded={!!at}
        onClick={toggle}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {icons.dots({ width: 16, height: 16 })}
      </button>
      {at &&
        createPortal(
          <div
            ref={menu}
            className={m.menu}
            role="menu"
            style={{
              position: 'fixed',
              right: at.right,
              width: 230,
              ...(up ? { bottom: window.innerHeight - at.top, top: 'auto' } : { top: at.top }),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              className={m.item}
              onClick={pick(() => navigate(`/plans/${r.id}`))}
            >
              {icons.edit({ width: 16, height: 16 })}
              <span>
                <b>Open shipment</b>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={m.item}
              onClick={pick(() => navigate(`/plans/${r.id}?tab=documents`))}
            >
              {icons.documents({ width: 16, height: 16 })}
              <span>
                <b>Documents</b>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={m.item}
              disabled={!r.invoiceNos.length}
              onClick={pick(
                () =>
                  void downloadFile(`/shipments/${r.id}/invoice-packing-list.xlsx`).catch(() =>
                    toast('Export failed. Check the cargo invoices and try again.'),
                  ),
              )}
            >
              {icons.download({ width: 16, height: 16 })}
              <span>
                <b>Invoice + Packing List</b>
              </span>
            </button>
            {can('shipments:delete') && (
              <button
                type="button"
                role="menuitem"
                className={`${m.item} ${t.danger}`}
                onClick={pick(() => {
                  if (
                    window.confirm(
                      `Delete ${r.reference}? Its CDC lines will be released back to the cut-stock balance.`,
                    )
                  )
                    del.mutate(r.id, {
                      onSuccess: () => toast(`${r.reference} deleted.`),
                      onError: (e) => toast(e instanceof Error ? e.message : 'Delete failed.'),
                    });
                })}
              >
                {icons.trash({ width: 16, height: 16 })}
                <span>
                  <b>Delete</b>
                </span>
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
