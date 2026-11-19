import { useEffect, useRef, useState } from 'react';
import type { PlanColumn } from './columns';

export interface PlansFilterValue {
  expandAll: boolean;
  frozen: string[];
}

/** Options for showing more shipment columns and pinning them while scrolling. */
export function PlansFilter({
  value,
  onApply,
  columnsFor,
}: {
  value: PlansFilterValue;
  onApply: (v: PlansFilterValue) => void;
  columnsFor: (expandAll: boolean) => PlanColumn[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(value), [value, open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const count = (value.expandAll ? 1 : 0) + (value.frozen.length ? 1 : 0);
  const hint = value.frozen.length
    ? `${value.frozen.length} column${value.frozen.length === 1 ? '' : 's'} pinned`
    : 'Shipment columns';

  return (
    <div className={`card-dropdown filter-dropdown${open ? ' open' : ''}`} ref={ref}>
      <button
        className={`filter-btn${count ? ' active' : ''}`}
        type="button"
        aria-label="Customize shipment columns"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18M15 3v18" />
        </svg>
        Columns
        <span className="filter-count" style={count ? { display: 'inline-flex' } : undefined}>
          {count}
        </span>
      </button>
      <div className="filter-dropdown-menu" role="dialog" aria-label="Customize shipment columns">
        <div className="filter-menu-header">
          <div className="filter-menu-title">Customize shipment list</div>
          <button
            type="button"
            className="filter-menu-close"
            aria-label="Close column options"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>
        <div className="filter-menu-body">
<<<<<<< Updated upstream
          <div className="filter-section">
            <div className="filter-col">
              <div className="filter-col-title">
                <span>Status</span>
              </div>
              <div className="filter-seg-group">
                {(
                  [
                    ['', 'All Shipment'],
                    ['COMPLETED', 'Completed'],
                    ['IN_PROGRESS', 'In Progress'],
                    ['PENDING', 'Pending'],
                    ['EXCEPTION', 'Exception'],
                  ] as const
                ).map(([v, l]) => (
                  <label className="filter-seg-item" key={v}>
                    <input
                      type="radio"
                      name="plansStatus"
                      checked={draft.status === v}
                      onChange={() => setDraft({ ...draft, status: v })}
                    />
                    <span className="seg-dot" />
                    <span>{l}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
=======
>>>>>>> Stashed changes
          <div className="filter-section filter-expand-row">
            <label className="filter-check-item">
              <input
                type="checkbox"
                checked={draft.expandAll}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    expandAll: e.target.checked,
                    frozen: draft.frozen.filter((k) =>
                      columnsFor(e.target.checked).some((c) => c.key === k),
                    ),
                  })
                }
              />
              <span>
                Expand All<em>Show full shipment details as extra columns</em>
              </span>
            </label>
          </div>
          <div className="filter-section">
            <div className="filter-col">
              <div className="filter-col-title">
                <span>Freeze Columns</span>
                <span className="filter-col-hint">Pin while scrolling</span>
              </div>
              <div className="filter-freeze-list">
                {columnsFor(draft.expandAll).map((c) => (
                  <label className="filter-check-item" key={c.key}>
                    <input
                      type="checkbox"
                      checked={draft.frozen.includes(c.key)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          frozen: e.target.checked
                            ? [...draft.frozen, c.key]
                            : draft.frozen.filter((k) => k !== c.key),
                        })
                      }
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="filter-actions">
          <span className="filter-actions-hint">{hint}</span>
          <div className="filter-actions-buttons">
            <button
              type="button"
              className="filter-reset-btn"
              onClick={() =>
                setDraft({
                  expandAll: false,
                  frozen: [],
                })
              }
            >
              Reset
            </button>
            <button
              type="button"
              className="filter-apply-btn"
              onClick={() => {
                onApply(draft);
                setOpen(false);
              }}
            >
              Apply view
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
