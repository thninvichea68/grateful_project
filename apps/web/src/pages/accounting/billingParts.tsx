import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { BillingStage } from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { printInPlace } from '../../lib/printInPlace';
import { monthName, PACK_PARTS, shiftMonth, STAGE, type PackPart } from './billingUi';
import b from './Billing.module.css';

/** Client Billing's sections: the month overview and the document and receipt registers. */
const SECTIONS = [
  { to: '/accounting/billing', label: 'Clients', end: true },
  { to: '/accounting/tax-invoices', label: 'Tax Invoices' },
  { to: '/accounting/disbursements', label: 'Disbursements' },
  { to: '/accounting/debit-notes', label: 'Debit Notes' },
  { to: '/accounting/receipts', label: 'Receipts' },
];
export const BILLING_SECTION_PATHS = SECTIONS.map((s) => s.to);

export function BillingSections({ className }: { className?: string }) {
  return (
    <nav aria-label="Client Billing sections" className={`${b.sections} ${className ?? ''}`}>
      {SECTIONS.map((s) => (
        <NavLink
          key={s.to}
          to={s.to}
          end={s.end}
          className={({ isActive }) => `${b.section}${isActive ? ` ${b.sectionOn}` : ''}`}
        >
          {s.label}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * "Print month pack": pick the parts, then the print dialog opens on this page (no new tab).
 */
export function PackPrintMenu({
  clientId,
  month,
  className,
  children,
}: {
  clientId: string;
  month: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<PackPart[]>(PACK_PARTS.map(([k]) => k));
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
  const toggle = (k: PackPart) =>
    setParts((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const print = () => {
    setOpen(false);
    printInPlace(`/print/billing/${clientId}?month=${month}&parts=${parts.join(',')}`);
  };
  const [exporting, setExporting] = useState(false);
  const { user } = useAuth();
  const toast = useToast();
  const excel = async () => {
    setExporting(true);
    try {
      const { exportPackExcel } = await import('./packExport');
      await exportPackExcel({ clientId, month, parts, preparedBy: user?.fullName ?? '' });
      setOpen(false);
    } catch (e) {
      toast(e instanceof Error && e.message.startsWith('Nothing') ? e.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className={b.packMenu} ref={box}>
      <button
        type="button"
        className={className}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        {children}
      </button>
      {open && (
        <div className={b.packPanel} role="dialog" aria-label="Print month pack">
          <div className={b.packTitle}>Include</div>
          {PACK_PARTS.map(([k, label]) => (
            <label key={k} className={b.packOption}>
              <input type="checkbox" checked={parts.includes(k)} onChange={() => toggle(k)} />
              {label}
            </label>
          ))}
          <button
            type="button"
            className={`new-shipment-btn ${b.packGo}`}
            disabled={!parts.length}
            onClick={print}
          >
            Print / Save as PDF
          </button>
          {/* The same parts as one workbook, sheet for sheet like the monthly Excel. */}
          <button
            type="button"
            className={`filter-btn ${b.packGo}`}
            disabled={!parts.length || exporting}
            onClick={() => void excel()}
          >
            {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
        </div>
      )}
    </div>
  );
}

/** ‹ [month] › — one click to the month before or after. */
export function MonthStepper({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  return (
    <div className={b.stepper}>
      <button
        type="button"
        className={b.stepBtn}
        onClick={() => onChange(shiftMonth(month, -1))}
        aria-label={`Previous month (${monthName(shiftMonth(month, -1))})`}
        title={monthName(shiftMonth(month, -1))}
      >
        ‹
      </button>
      <input
        type="month"
        className={`${ui.input} ${b.monthInput}`}
        value={month}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        aria-label="Month"
      />
      <button
        type="button"
        className={b.stepBtn}
        onClick={() => onChange(shiftMonth(month, 1))}
        aria-label={`Next month (${monthName(shiftMonth(month, 1))})`}
        title={monthName(shiftMonth(month, 1))}
      >
        ›
      </button>
    </div>
  );
}

export function StagePill({ stage }: { stage: BillingStage }) {
  const s = STAGE[stage];
  return (
    <span
      className={`status-tag ${s.tone === 'neutral' ? b.neutral : s.tone}`}
      title={s.hint}
      style={{ whiteSpace: 'nowrap' }}
    >
      <span className="dot" />
      {s.label}
    </span>
  );
}
