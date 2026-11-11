import { useEffect, useRef, useState } from 'react';
import { icons } from '../../layout/icons';
import m from '../creditnoted/PackMenu.module.css';

/**
 * A toolbar's ⋯: Download Excel (the list's filters), Upload Excel and its blank template
 * (Shipping Plans, Cut Stock) and Status rules (Shipping Plans).
 */
export function PlansMoreMenu({
  exporting,
  onExport,
  onImport,
  onTemplate,
  onStatusRules,
  exportHint = 'Shipments matching the current filters · .xlsx',
  importHint = 'Shipping plan workbook · .xlsx',
  templateHint = 'The blank workbook Upload Excel accepts · .xlsx',
}: {
  exporting: boolean;
  onExport: () => void;
  /** Omitted when the user can't import. */
  onImport?: (() => void) | undefined;
  /** The blank upload template; omitted when the user can't import or there is none. */
  onTemplate?: (() => void) | undefined;
  templateHint?: string;
  /** Each client's "Completed when…" rule; omitted where it doesn't apply. */
  onStatusRules?: (() => void) | undefined;
  exportHint?: string;
  importHint?: string;
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

  const label = onStatusRules
    ? 'Download / Upload Excel, Status rules'
    : 'Download or Upload Excel';
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className={m.wrap} ref={box}>
      <button
        type="button"
        className={m.dots}
        aria-label={`More: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        disabled={exporting}
        onClick={() => setOpen((o) => !o)}
      >
        {exporting ? <span className={m.spinner} aria-hidden /> : icons.dots({})}
      </button>
      {open && (
        <div className={m.menu} role="menu">
          <button type="button" role="menuitem" className={m.item} onClick={pick(onExport)}>
            {icons.download({ width: 16, height: 16 })}
            <span>
              <b>Download Excel</b>
              <small>{exportHint}</small>
            </span>
          </button>
          {onImport && (
            <button type="button" role="menuitem" className={m.item} onClick={pick(onImport)}>
              {icons.upload({ width: 16, height: 16 })}
              <span>
                <b>Upload Excel</b>
                <small>{importHint}</small>
              </span>
            </button>
          )}
          {onTemplate && (
            <button type="button" role="menuitem" className={m.item} onClick={pick(onTemplate)}>
              {icons.documents({ width: 16, height: 16 })}
              <span>
                <b>Download template</b>
                <small>{templateHint}</small>
              </span>
            </button>
          )}
          {onStatusRules && (
            <button type="button" role="menuitem" className={m.item} onClick={pick(onStatusRules)}>
              {icons.settings({ width: 16, height: 16 })}
              <span>
                <b>Status rules</b>
                <small>When each client's shipments are Completed</small>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
