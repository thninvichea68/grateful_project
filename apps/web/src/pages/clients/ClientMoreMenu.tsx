import { useEffect, useRef, useState } from 'react';
import { icons } from '../../layout/icons';
import m from '../creditnoted/PackMenu.module.css';
import s from './ClientDetailPage.module.css';

/** Client Details header ⋯: Deactivate / Reactivate, and Delete for a client with no history. */
export function ClientMoreMenu({
  inactive,
  busy,
  onToggleActive,
  onDelete,
}: {
  inactive: boolean;
  busy: boolean;
  onToggleActive: () => void;
  /** Omitted when the client has shipments or cut-stock items (it can't be deleted). */
  onDelete?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const label = onDelete ? 'Deactivate or delete' : inactive ? 'Reactivate' : 'Deactivate';
  return (
    <div className={m.wrap} ref={box}>
      <button
        type="button"
        className={m.dots}
        aria-label={`More: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? <span className={m.spinner} aria-hidden /> : icons.dots({})}
      </button>
      {open && (
        <div className={m.menu} role="menu">
          <button type="button" role="menuitem" className={m.item} onClick={pick(onToggleActive)}>
            {inactive
              ? icons.plus({ width: 16, height: 16 })
              : icons.close({ width: 16, height: 16 })}
            <span>
              <b>{inactive ? 'Reactivate client' : 'Deactivate client'}</b>
              <small>
                {inactive
                  ? 'New shipments can be created again'
                  : 'Shipments stay; no new ones can be created'}
              </small>
            </span>
          </button>
          {onDelete && (
            <button
              type="button"
              role="menuitem"
              className={`${m.item} ${s.menuDanger}`}
              onClick={pick(onDelete)}
            >
              {icons.trash({ width: 16, height: 16 })}
              <span>
                <b>Delete client</b>
                <small>Only while it has no shipments or cut stock</small>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
