import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { PermitCover, PermitInvoice } from '@gs/shared';
import { usePermitSet } from '../../features/hooks';
import './printFonts';
import s from './print.module.css';
import a from './authorizeLetter.module.css';
import p from './permitSet.module.css';
import { AuthorizeLetterSheet } from './PrintAuthorizePage';
import { useAutoPrint } from './useAutoPrint';

type Doc = 'cover' | 'invoice' | 'pl' | 'authorize';
const DOCS: { key: Doc; label: string }[] = [
  { key: 'cover', label: 'Cover' },
  { key: 'invoice', label: 'Invoice' },
  { key: 'pl', label: 'Packing List' },
  { key: 'authorize', label: 'Authorize' },
];

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-08-31" → "31-Aug-2026", as the invoice sheet writes dates. */
const longDate = (iso: string | null) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}-${MON[Number(m) - 1]}-${y}`;
};
const money = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 3 });

/**
 * The import permit application set, in the order it is handed in: the cover letter to
 * Customs, each commercial invoice and its packing list, then the transfer of rights.
 * Documents can be left out with the toggles; one that isn't ready says what it needs (on
 * screen only) instead of printing half-filled.
 */
export function PrintPermitSetPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const q = usePermitSet(id);
  const set = q.data;
  const [on, setOn] = useState<Record<Doc, boolean>>(() => {
    const only = params.get('docs')?.split(',');
    return Object.fromEntries(DOCS.map((d) => [d.key, !only || only.includes(d.key)])) as Record<
      Doc,
      boolean
    >;
  });
  const first = set?.invoices.data[0];
  useEffect(() => {
    if (set) document.title = `PERMIT SET ${set.cover.data?.invoiceNos ?? first?.invoiceNo ?? ''}`;
  }, [set, first]);
  useAutoPrint(!!set);

  if (q.isLoading) return <div className={s.page}>Loading…</div>;
  if (!set)
    return (
      <div className={s.page}>
        <div className={s.sheet}>The shipment could not be loaded.</div>
      </div>
    );

  const missing = (title: string, list: string[]) => (
    <div className={`${s.sheet} ${p.missing}`}>
      <h2>{title}</h2>
      <p>Not ready yet. It still needs:</p>
      <ul>
        {list.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className={s.page}>
      <div className={`${s.toolbar} ${p.toolbar}`}>
        <div className={p.toggles} role="group" aria-label="Documents in the set">
          {DOCS.map((d) => (
            <label key={d.key} className={p.toggle} data-on={on[d.key]}>
              <input
                type="checkbox"
                checked={on[d.key]}
                onChange={(e) => setOn({ ...on, [d.key]: e.target.checked })}
              />
              {d.label}
            </label>
          ))}
        </div>
        <button type="button" className={s.btn} onClick={() => window.close()}>
          Close
        </button>
        <button type="button" className={s.btnPrimary} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className={p.stack}>
        {on.cover &&
          (set.cover.data ? (
            <CoverSheet c={set.cover.data} />
          ) : (
            missing('Cover letter', set.cover.missing)
          ))}
        {(on.invoice || on.pl) && !set.invoices.data.length
          ? missing('Invoice & Packing List', set.invoices.missing)
          : set.invoices.data.map((inv) => (
              <InvoicePair key={inv.invoiceNo} inv={inv} invoice={on.invoice} pl={on.pl} />
            ))}
        {on.authorize &&
          (set.authorize.letter ? (
            <AuthorizeLetterSheet letter={set.authorize.letter} />
          ) : (
            missing('Authorize letter', set.authorize.missing)
          ))}
      </div>
    </div>
  );
}

/** Letter to the Director General of Customs asking to import the goods. */
function CoverSheet({ c }: { c: PermitCover }) {
  return (
    <div className={`${s.sheet} ${a.letter} ${p.cover}`}>
      <div className={p.coverTop}>
        <div className={p.from}>
          <div>
            <span className={a.moul}>ក្រុមហ៊ុន</span>
            <b className={p.en}>{c.company}</b>
          </div>
          <div>
            <span className={a.moul}>អាស័យដ្ឋាន</span>
            <span className={p.en}>
              {c.address[0]}
              {c.address[1] && <br />}
              {c.address[1]}
              {c.vattin && <br />}
              {c.vattin && `VAT: ${c.vattin}`}
            </span>
          </div>
        </div>
        <div className={`${a.kingdom} ${a.moul}`}>
          <div>ព្រះរាជាណាចក្រកម្ពុជា</div>
          <div>ជាតិ សាសនា ព្រះមហាក្សត្រ</div>
          <div className={a.rule} />
        </div>
      </div>
      <div className={p.dates}>
        <div>{c.lunarDate}</div>
        <div>{c.solarDate}</div>
      </div>
      <div className={`${p.to} ${a.moul}`}>
        <div>សូមគោរពជូន</div>
        <div>ឯកឧត្តមរដ្ឋមន្រ្តីប្រតិភូអមនាយករដ្ឋមន្រ្តី</div>
        <div>អគ្គនាយកនៃអគ្គនាយកដ្ឋានគយ និងរដ្ឋាករកម្ពុជា</div>
      </div>
      <dl className={p.terms}>
        <dt className={a.moul}>កម្មវត្ថុ</dt>
        <dd>
          សំណើសុំលិខិតអនុញ្ញាតតិនាំចូលនូវវត្ថុធាតុដើម <b>{c.items} មុខ</b> ចំនួន{' '}
          <b className={p.en}>{c.packages}</b> = <b className={p.en}>{qty(c.gw)} Kgs</b> តំលៃ USD{' '}
          <b className={p.en}>{money(c.amount)}</b> ដោយពន្ឋនិងអាករជាបន្ទុករបស់រដ្ឋតាមមាត់ច្រក{' '}
          {c.port}
        </dd>
        <dt className={a.moul}>យោង</dt>
        <dd>
          <ul className={p.refs}>
            {c.extensionLetterNo && (
              <li>
                លិខិតលេខ {c.extensionLetterNo} គ.វ.ក ចុះថ្ងៃទី {c.cdcIssueDate}{' '}
                ពន្យារសុពលភាពលើលិខិតលេខ <span className={p.en}>{c.cdcNo}</span> គ.វ.ក។
              </li>
            )}
            {c.customsNoteDate && (
              <li>ចំណារលោកប្រធាននាយកដ្ឋានរបបគយ ចុះថ្ងៃទី {c.customsNoteDate}</li>
            )}
            <li>
              <span className={p.en}>Invoice/Packing List No. {c.invoiceNos}</span> ចុះថ្ងៃទី{' '}
              <span className={p.en}>{longDate(c.invoiceDate)}</span>
            </li>
            <li>
              <span className={p.en}>Bill of Loading No. {c.hblNo}</span> ចុះថ្ងៃទី{' '}
              <span className={p.en}>{longDate(c.hblDate)}</span>
            </li>
          </ul>
        </dd>
      </dl>
      <p className={p.body}>
        តបតាមន័យកម្មវត្ថុ និង យោងខាងលើ សូមឯកឧត្តមរដ្ឋមន្រ្តីប្រតិភូ មេត្តាពិនិត្យ និង
        ដោះស្រាយនូវសំណើខាងលើដោយក្តីអនុគ្រោះ ។
      </p>
      <div className={p.sign}>
        {c.signatory.titleKm && <div className={a.moul}>{c.signatory.titleKm}</div>}
        <div className={p.small}>(ហត្ថលេខា និង ឈ្មោះ)</div>
        {c.signatory.title && <div className={p.en}>{c.signatory.title}</div>}
        <div className={p.signSpace} />
        <b className={p.en}>{c.signatory.name}</b>
      </div>
    </div>
  );
}

/** The supplier letterhead and the consignee block, shared by the invoice and packing list. */
function DocHead({ inv, title }: { inv: PermitInvoice; title: string }) {
  return (
    <>
      <header className={p.letterhead}>
        <h1>{inv.supplier}</h1>
        {inv.supplierAddress.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </header>
      <h2 className={p.docTitle}>{title}</h2>
      <div className={p.meta}>
        <div>
          <span>NO:</span> <b>{inv.invoiceNo}</b>
        </div>
        <div>
          <span>Date:</span> <b>{longDate(inv.invoiceDate)}</b>
        </div>
      </div>
      <div className={p.consignee}>
        <span>Consignee:</span>
        <div>
          <b>{inv.consignee.company}</b>
          {inv.consignee.address.filter(Boolean).map((l) => (
            <div key={l}>{l}</div>
          ))}
          {inv.consignee.attn && <div>{inv.consignee.attn}</div>}
          {inv.consignee.vat && <div>{inv.consignee.vat}</div>}
        </div>
        {inv.origin && (
          <div className={p.origin}>
            COUNTRY OF ORIGIN: <b>{inv.origin}</b>
          </div>
        )}
      </div>
    </>
  );
}

function DocFoot({ inv }: { inv: PermitInvoice }) {
  return (
    <div className={p.foot}>
      {inv.containers.length > 0 && (
        <div className={p.ctnr}>
          <span>CTNR:</span>
          <div>
            {inv.containers.map((c) => (
              <div key={c}>{c}</div>
            ))}
          </div>
        </div>
      )}
      <div className={p.supplierSign}>
        <b>{inv.supplier}</b>
        <div className={p.signLine} />
      </div>
    </div>
  );
}

function InvoicePair({ inv, invoice, pl }: { inv: PermitInvoice; invoice: boolean; pl: boolean }) {
  return (
    <>
      {invoice && (
        <div className={`${s.sheet} ${p.doc}`}>
          <DocHead inv={inv} title="INVOICE" />
          <table className={p.table}>
            <thead>
              <tr>
                <th>No</th>
                <th>Description of Goods</th>
                <th />
                <th className={p.r}>Quantity</th>
                <th />
                <th className={p.r}>
                  Unit Price (USD)
                  <small>{inv.terms}</small>
                </th>
                <th className={p.r}>Amount (USD)</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.no}>
                  <td className={p.c}>{l.no}</td>
                  <td>{l.description}</td>
                  <td>{l.cdcRef}</td>
                  <td className={p.r}>{money(l.qty)}</td>
                  <td>{l.cdcUnit}</td>
                  <td className={p.r}>{money(l.unitPrice)}</td>
                  <td className={p.r}>{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} className={p.r}>
                  TOTAL
                </td>
                <td className={p.r}>{money(inv.totals.amount)}</td>
              </tr>
            </tfoot>
          </table>
          <DocFoot inv={inv} />
        </div>
      )}
      {pl && (
        <div className={`${s.sheet} ${p.doc}`}>
          <DocHead inv={inv} title="PACKING LIST" />
          <table className={p.table}>
            <thead>
              <tr>
                <th>No</th>
                <th className={p.c}>No. of {inv.unit}</th>
                <th>Description of Goods</th>
                <th className={p.r}>Net Weight (KGS)</th>
                <th className={p.r}>Gross Weight (KGS)</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.no}>
                  <td className={p.c}>{l.no}</td>
                  <td className={p.c}>{qty(l.packages)}</td>
                  <td>{l.description}</td>
                  <td className={p.r}>{money(l.nw)}</td>
                  <td className={p.r}>{money(l.gw)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td className={p.c}>
                  {qty(inv.totals.packages)} {inv.unit}
                </td>
                <td />
                <td className={p.r}>{money(inv.totals.nw)}</td>
                <td className={p.r}>{money(inv.totals.gw)}</td>
              </tr>
            </tfoot>
          </table>
          <DocFoot inv={inv} />
        </div>
      )}
    </>
  );
}
