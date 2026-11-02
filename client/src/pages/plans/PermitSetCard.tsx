import { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { usePermitSet } from '../../features/hooks';
import { useToast } from '../../components/Toast';
import { downloadFile } from '../../lib/files';
import { printInPlace } from '../../lib/printInPlace';
import type { FormValues } from './formModel';
import c from './CargoSection.module.css';
import k from './PermitSetCard.module.css';

/**
 * Invoice / PL → the import permit application set: cover letter to Customs, invoices +
 * packing lists and the transfer of rights, with what each still needs. Preview, print or
 * save as PDF in one go (unsaved changes are saved first), or take the Excel workbook.
 */
export function PermitSetCard({
  shipmentId,
  saveNow,
}: {
  shipmentId: string | undefined;
  saveNow: () => Promise<boolean>;
}) {
  const {
    formState: { isDirty },
  } = useFormContext<FormValues>();
  const toast = useToast();
  const set = usePermitSet(shipmentId);
  const [busy, setBusy] = useState<'view' | 'print' | 'excel' | null>(null);

  const d = set.data;
  const invoices = d?.invoices.data ?? [];
  const docs = [
    {
      key: 'cover',
      name: 'Cover letter',
      detail: 'To the Director General of Customs',
      missing: d?.cover.missing ?? [],
    },
    {
      key: 'invoice',
      name: 'Invoice',
      detail: invoices.map((i) => i.invoiceNo).join(', ') || '—',
      missing: d?.invoices.missing ?? [],
    },
    {
      key: 'pl',
      name: 'Packing List',
      detail: invoices.length
        ? `${invoices.reduce((s, i) => s + i.totals.packages, 0).toLocaleString('en-US')} ${invoices[0]!.unit}`
        : '—',
      missing: d?.invoices.missing ?? [],
    },
    {
      key: 'authorize',
      name: 'Authorize letter',
      detail: 'Transfer of rights to Grateful',
      missing: d?.authorize.missing ?? [],
    },
  ];
  const ready = docs.filter((x) => !x.missing.length).length;

  /** Saves unsaved changes, then opens the set (new tab) or the print dialog. */
  const open = async (how: 'view' | 'print') => {
    if (!shipmentId) return;
    // Opened inside the click, before anything is awaited, so the browser allows the tab.
    const tab = how === 'view' ? window.open('about:blank', '_blank') : null;
    setBusy(how);
    try {
      if (isDirty && !(await saveNow())) {
        tab?.close();
        return;
      }
      await set.refetch();
      const url = `/print/permit-set/${shipmentId}`;
      if (tab) tab.location.href = url;
      else printInPlace(url);
    } finally {
      setBusy(null);
    }
  };
  const excel = async () => {
    if (!shipmentId) return;
    setBusy('excel');
    try {
      if (isDirty && !(await saveNow())) return;
      await downloadFile(`/shipments/${shipmentId}/invoice-packing-list.xlsx`);
    } catch {
      toast('Export failed. Check the cargo invoices and try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={c.card}>
      <div className={c.head}>
        <h3 className={c.title}>
          Permit Application Set
          {d && (
            <span className={k.progress} data-done={ready === docs.length}>
              {ready} of {docs.length} ready
            </span>
          )}
        </h3>
        <div className={c.actions}>
          <button
            type="button"
            className={c.btn}
            disabled={!shipmentId || !!busy}
            title="Invoice + packing list, cover and transfer of rights in Excel"
            onClick={() => void excel()}
          >
            {busy === 'excel' ? 'Exporting…' : 'Excel'}
          </button>
          <button
            type="button"
            className={`${c.btn} ${c.btnOutline}`}
            disabled={!shipmentId || !!busy || !ready}
            onClick={() => void open('view')}
          >
            {busy === 'view' ? 'Opening…' : 'Preview'}
          </button>
          <button
            type="button"
            className={`${c.btn} ${c.btnPrimary}`}
            disabled={!shipmentId || !!busy || !ready}
            title="Opens the print dialog: choose Save as PDF"
            onClick={() => void open('print')}
          >
            {busy === 'print' ? 'Preparing…' : isDirty ? 'Save & Print / PDF' : 'Print / PDF'}
          </button>
        </div>
      </div>
      {!shipmentId ? (
        <p className={k.empty}>Save the shipment first.</p>
      ) : (
        <ol className={k.docs}>
          {docs.map((x, i) => {
            const ok = !!d && !x.missing.length;
            return (
              <li key={x.key} className={k.doc} data-ok={ok}>
                <span className={k.no}>{ok ? '✓' : i + 1}</span>
                <div className={k.text}>
                  <b>{x.name}</b>
                  {ok ? (
                    <span className={k.detail}>{x.detail}</span>
                  ) : (
                    <span className={k.need} title={x.missing.join('\n')}>
                      {set.isLoading ? 'Checking…' : `Needs: ${x.missing.join(', ')}`}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
