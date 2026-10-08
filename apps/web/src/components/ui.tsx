import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../lib/api';
import s from './ui.module.css';

export { s as ui };

export function Modal({
  title,
  sub,
  onClose,
  children,
  width = 560,
}: {
  title: string;
  sub?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  // Portalled to <body>: an animated/transformed ancestor would otherwise turn the fixed
  // overlay into a box clipped to the content area instead of covering the screen.
  return createPortal(
    <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={s.dialog}
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        ref={ref}
      >
        <div className={s.dialogHead}>
          <div>
            <h2 className={s.dialogTitle} id="dlg-title">
              {title}
            </h2>
            {sub && <div className={s.dialogSub}>{sub}</div>}
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Pager({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className={s.pager} aria-label="Pagination">
      <span className={s.pagerInfo}>
        {from}–{to} of {total.toLocaleString()}
      </span>
      <div className={s.pagerBtns}>
        <button
          type="button"
          className="filter-btn"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <span className={s.pagerInfo}>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className="filter-btn"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}

/** Server error → readable banner, listing field details when present. */
export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  const details = Array.isArray(e?.details)
    ? (e!.details as { path?: string; message: string }[])
    : [];
  return (
    <div className={s.alert} role="alert">
      {e?.message ?? 'Something went wrong. Check your connection and try again.'}
      {details.length > 0 && (
        <ul>
          {details.slice(0, 8).map((d, i) => (
            <li key={i}>
              {d.path ? `${d.path}: ` : ''}
              {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TableState({
  cols,
  loading,
  error,
  empty,
  emptyText,
}: {
  cols: number;
  loading: boolean;
  error: unknown;
  empty: boolean;
  emptyText: string;
}) {
  if (loading)
    return (
      <>
        {Array.from({ length: 6 }, (_, i) => (
          <tr key={i} className={s.skeletonRow}>
            {Array.from({ length: cols }, (_, j) => (
              <td key={j}>
                <div className={s.skeleton} style={{ width: `${50 + ((i * 7 + j * 13) % 45)}%` }} />
              </td>
            ))}
          </tr>
        ))}
      </>
    );
  if (error)
    return (
      <tr>
        <td colSpan={cols} className={s.empty} style={{ color: 'var(--status-exception-fg)' }}>
          {error instanceof ApiError ? error.message : 'Could not load data.'} Reload the page to
          try again.
        </td>
      </tr>
    );
  if (empty)
    return (
      <tr>
        <td colSpan={cols} className={s.empty}>
          {emptyText}
        </td>
      </tr>
    );
  return null;
}

export function FieldError({ message }: { message?: string | undefined }) {
  return message ? (
    <span className={s.fieldError} role="alert">
      {message}
    </span>
  ) : null;
}
