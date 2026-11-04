import type { ReactNode } from 'react';
import type { CreditNoteReviewCounts, CreditNoteReviewStatus } from '@gs/shared';
import { icons } from '../../layout/icons';
import s from './CreditNotesReview.module.css';

const svg = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);
const alert = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5h.01" />
  </>,
);
const check = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5" />
  </>,
);

const TABS: {
  review: '' | CreditNoteReviewStatus;
  label: string;
  count: keyof CreditNoteReviewCounts;
  /** Undefined for All records: the page's own icon. */
  icon?: ReactNode;
}[] = [
  { review: '', label: 'All records', count: 'total' },
  { review: 'UNCHECKED', label: 'Unchecked', count: 'unchecked', icon: alert },
  { review: 'REVIEWED', label: 'Reviewed', count: 'reviewed', icon: icons.eye({}) },
  { review: 'CHECKED', label: 'Approved', count: 'checked', icon: check },
  { review: 'REVISED', label: 'Revised', count: 'revised', icon: icons.edit({}) },
  // Revised by its maker after submitting, waiting for approval.
  {
    review: 'REVISION_REQUESTED',
    label: 'Request Revise',
    count: 'revisionRequested',
    icon: icons.send({}),
  },
];

/**
 * Chea Payments and Expense to Clients: the review statuses as one tab bar (icon, label and
 * count, the picked one underlined), like the shipment form's section tabs. The icons take the
 * label's colour, so only the picked tab is cyan.
 */
export function ReviewTabs({
  counts,
  value,
  onChange,
  allIcon,
}: {
  counts: CreditNoteReviewCounts | undefined;
  value: string;
  onChange: (review: string) => void;
  /** All records' icon: the page's own (credit note, record summary). */
  allIcon: ReactNode;
}) {
  return (
    <div className={s.tabs} role="tablist" aria-label="Filter by status">
      {TABS.map((t) => (
        <button
          key={t.label}
          type="button"
          role="tab"
          className={s.tab}
          aria-selected={value === t.review}
          onClick={() => onChange(t.review)}
        >
          <span className={s.tabIcon}>{t.icon ?? allIcon}</span>
          {t.label}
          <span className={s.tabCount}>{counts?.[t.count] ?? '–'}</span>
        </button>
      ))}
    </div>
  );
}
