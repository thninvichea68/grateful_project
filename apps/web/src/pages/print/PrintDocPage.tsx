import { useEffect, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { BILLING_DOC_TYPES, type BillingDoc, type BillingDocType } from '@gs/shared';
import { useCompany, useDoc, type CompanyInfo } from '../../features/accounting';
import { useLookups } from '../../features/hooks';
import { fmtDate } from '../../lib/format';
import s from './print.module.css';
import cn from './creditNote.module.css';

const money = (v: string | number | undefined | null) =>
  Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const riel = (v: string | number | undefined | null) => Number(v ?? 0).toLocaleString('en-US');
const qty = (v: string | number | undefined | null) =>
  Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const h = (d: BillingDoc, k: string) => d.header[k] ?? '';

/** Printable A4 view of a billing document. Use the browser's "Save as PDF" for a PDF. */
export function PrintDocPage() {
  const { type = '', id = '' } = useParams();
  const valid = (BILLING_DOC_TYPES as readonly string[]).includes(type);
  const doc = useDoc(type as BillingDocType, valid ? id : undefined);
  const company = useCompany();
  useEffect(() => {
    if (doc.data) document.title = `${doc.data.number ?? type} — Grateful Solutions`;
  }, [doc.data, type]);
  if (!valid) return <div className={s.page}>Unknown document type.</div>;
  if (doc.isLoading || company.isLoading) return <div className={s.page}>Loading…</div>;
  if (!doc.data) return <div className={s.page}>Document not found.</div>;
  const d = doc.data;
  const c = company.data ?? {};
  return (
    <div className={s.page}>
      <div className={s.toolbar}>
        <button type="button" className={s.btn} onClick={() => window.close()}>
          Close
        </button>
        <button type="button" className={s.btnPrimary} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      <div className={s.sheet}>
        {d.status !== 'ISSUED' && <div className={s.stamp}>{d.status}</div>}
        {type === 'tax-invoices' && <TaxOrDisbursement d={d} c={c} tax />}
        {type === 'disbursements' && <TaxOrDisbursement d={d} c={c} tax={false} />}
        {type === 'debit-notes' && <DebitNote d={d} c={c} />}
        {type === 'credit-notes' && <CreditNote d={d} />}
        {type === 'record-summaries' && <RecordSummary d={d} c={c} />}
      </div>
    </div>
  );
}

function CompanyHead({ c, khmer = true }: { c: CompanyInfo; khmer?: boolean }) {
  return (
    <div className={s.head}>
      <img src="/logo.png" alt="" className={s.logo} />
      <div className={s.company}>
        {khmer && <div className={s.companyKm}>{c.nameKm}</div>}
        <div className={s.companyEn}>{c.nameEn}</div>
        <div className={s.companyMeta}>
          <span className={s.km}>លេខអត្តសញ្ញាណកម្ម អតប</span> (VATTIN) : {c.vattin}
        </div>
        {khmer && <div className={`${s.companyMeta} ${s.km}`}>អាស័យដ្ឋាន : {c.addressKm}</div>}
        <div className={s.companyMeta}>{c.addressEn}</div>
        <div className={s.companyMeta}>
          <span className={s.km}>លេខទូរស័ព្ទ</span>: {c.phone}
        </div>
      </div>
    </div>
  );
}

const KV = ({ rows }: { rows: [ReactNode, ReactNode][] }) => (
  <dl className={s.kv}>
    {rows.map(([k, v], i) => (
      <div key={i} style={{ display: 'contents' }}>
        <dt>{k}</dt>
        <dd>{v || '-'}</dd>
      </div>
    ))}
  </dl>
);
const Bi = ({ km, en }: { km: string; en: string }) => (
  <>
    <span className={s.km}>{km}</span> / {en}
  </>
);

function TaxOrDisbursement({ d, c, tax }: { d: BillingDoc; c: CompanyInfo; tax: boolean }) {
  return (
    <>
      <CompanyHead c={c} />
      <div className={s.title}>
        {tax ? (
          <>
            <div className={s.titleKm}>វិក្កយបត្រអាករ</div>
            <div className={s.titleEn}>TAX INVOICE</div>
          </>
        ) : (
          <div className={s.titleEn}>DISBURSEMENT</div>
        )}
      </div>
      <div className={s.grid2}>
        <KV
          rows={[
            [
              <Bi km="ឈ្មោះអតិថិជន" en="Customer:" key="c" />,
              <>
                <div className={s.km}>{h(d, 'customerNameKm')}</div>
                <b>{h(d, 'customerNameEn')}</b>
              </>,
            ],
            [<Bi km="អាស័យដ្ឋាន" en="Address:" key="a" />, h(d, 'customerAddress')],
            [
              <>
                <span className={s.km}>លេខ អតប</span> (VATTIN):
              </>,
              h(d, 'customerVattin'),
            ],
            ['SHIPPER:', h(d, 'shipper')],
            ['CONSIGNEE:', h(d, 'consignee')],
            ['HBL:', h(d, 'hbl')],
            ['PKGS:', h(d, 'pkgs')],
          ]}
        />
        <KV
          rows={[
            [
              tax ? <Bi km="លេខវិក្កយបត្រ" en="Invoice No:" key="n" /> : 'DIS No:',
              <b>{d.number}</b>,
            ],
            [
              tax ? <Bi km="កាលបរិច្ឆេទវិក្កយបត្រ" en="Invoice Date:" key="d" /> : 'Date:',
              fmtDate(d.date),
            ],
            ['GROSS WEIGHT:', h(d, 'grossWeightKg') && `${qty(h(d, 'grossWeightKg'))} KGS`],
            ['VOLUME:', h(d, 'volumeCbm') && `${qty(h(d, 'volumeCbm'))} CBM`],
            ['Container No:', h(d, 'containerNo')],
            ['POL:', h(d, 'pol')],
            ['POD:', h(d, 'pod')],
            ['Exchange Rate:', `1USD = ${riel(h(d, 'exchangeRate'))} KHR`],
          ]}
        />
      </div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>
              <span className={s.km}>ល.រ</span>
              <br />
              No
            </th>
            <th>
              <span className={s.km}>បរិយាយមុខទំនិញ</span>
              <br />
              Description
            </th>
            <th>
              <span className={s.km}>បរិមាណ</span>
              <br />
              Quantity
            </th>
            <th>
              <span className={s.km}>ឯកតា</span>
              <br />
              Unit
            </th>
            <th>
              <span className={s.km}>ថ្លៃឯកតា</span>
              <br />
              Unit Price
            </th>
            <th>
              <span className={s.km}>សរុប</span>
              <br />
              Sub Total
            </th>
            {tax && (
              <>
                <th>
                  <span className={s.km}>អាករ 10%</span>
                  <br />
                  VAT (10%)
                </th>
                <th>
                  <span className={s.km}>ថ្លៃទំនិញ</span>
                  <br />
                  Amount
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l) => (
            <tr key={l.id}>
              <td className={s.center}>{l.lineNo}</td>
              <td className={s.km}>{l.description}</td>
              <td className={s.num}>{qty(l.qty)}</td>
              <td className={s.center}>{l.unit}</td>
              <td className={s.num}>{money(l.unitPrice)}</td>
              <td className={s.num}>{money(l.subtotal)}</td>
              {tax && (
                <>
                  <td className={s.num}>{money(l.vat)}</td>
                  <td className={s.num}>{money(l.amount)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <table className={s.totals}>
        <tbody>
          {tax && (
            <tr>
              <td>
                <span className={s.km}>សរុប</span> SUB TOTAL
              </td>
              <td>KHR</td>
              <td className={s.num}>{riel(d.totals.subtotalKhr)}</td>
              <td>USD</td>
              <td className={s.num}>{money(d.totals.subtotal)}</td>
            </tr>
          )}
          {tax && (
            <tr>
              <td>
                <span className={s.km}>អាករលើតម្លៃបន្ថែម</span> (VAT 10%)
              </td>
              <td>KHR</td>
              <td className={s.num}>{riel(d.totals.vatKhr)}</td>
              <td>USD</td>
              <td className={s.num}>{money(d.totals.vat)}</td>
            </tr>
          )}
          <tr className={s.grand}>
            <td>
              <span className={s.km}>សរុបរួម</span> GRAND TOTAL
            </td>
            <td>KHR</td>
            <td className={s.num}>{riel(d.totals.totalKhr)}</td>
            <td>USD</td>
            <td className={s.num}>{money(d.totals.total)}</td>
          </tr>
        </tbody>
      </table>
      <div className={s.note}>
        <b>Note:</b> You can make payment by cross cheque to: <b>{c.bankAccountName}</b> or deposit
        cash/cheque payment to bank as below:
        <br />
        <b>{c.bankName}</b> · AC/NAME: {c.bankAccountName} · AC/NO: {c.bankAccountNo}
      </div>
      <div className={s.signs}>
        <div>
          <span className={s.km}>ហត្ថលេខា និង ឈ្មោះអ្នកទិញ</span>
          <br />
          Customer&apos;s signature &amp; name
        </div>
        <div>
          <span className={s.km}>ហត្ថលេខា និង ឈ្មោះអ្នកលក់</span>
          <br />
          Seller&apos;s signature &amp; name
        </div>
      </div>
      {tax && (
        <div className={s.note} style={{ textAlign: 'center' }}>
          <span className={s.km}>សម្គាល់ ច្បាប់ដើមសម្រាប់អ្នកទិញ ច្បាប់ចម្លងសម្រាប់អ្នកលក់</span>
          <br />
          Note: Original invoice for customer, copies invoice for seller
        </div>
      )}
    </>
  );
}

function SimpleLines({
  d,
  showMark,
  unitHeader = 'U/M',
  totalLabel = 'GRAND TOTAL:',
}: {
  d: BillingDoc;
  showMark: boolean;
  unitHeader?: string;
  totalLabel?: string;
}) {
  return (
    <>
      <table className={s.table}>
        <thead>
          <tr>
            <th>NO</th>
            <th>DESCRIPTION</th>
            <th>Q&apos;TY</th>
            <th>{unitHeader}</th>
            <th>PRICE</th>
            <th>{showMark ? 'SHPT' : 'TOTAL'}</th>
            {showMark && <th>MARK</th>}
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l) => (
            <tr key={l.id}>
              <td className={s.center}>{l.lineNo}</td>
              <td>{l.description}</td>
              <td className={s.num}>{qty(l.qty)}</td>
              <td className={s.center}>{l.unit}</td>
              <td className={s.num}>{money(l.unitPrice)}</td>
              <td className={s.num}>{money(l.subtotal)}</td>
              {showMark && <td>{l.mark}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <table className={s.totals}>
        <tbody>
          <tr className={s.grand}>
            <td>{totalLabel}</td>
            <td>USD</td>
            <td className={s.num}>{money(d.totals.total)}</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function DebitNote({ d, c }: { d: BillingDoc; c: CompanyInfo }) {
  return (
    <>
      <CompanyHead c={c} khmer={false} />
      <div className={s.title}>
        <div className={s.titleEn}>DEBIT NOTE</div>
      </div>
      <div className={s.grid2}>
        <KV
          rows={[
            ['CUSTOMER:', <b key="b">{h(d, 'billTo')}</b>],
            ['ADDRESS:', h(d, 'address')],
            ['HBL NO:', h(d, 'hbl')],
            ['POL:', h(d, 'pol')],
            ['POD:', h(d, 'pod')],
            ['Shipper:', h(d, 'shipper')],
            ['Consignee:', h(d, 'consignee')],
          ]}
        />
        <KV
          rows={[
            ['DN NO:', <b key="n">{d.number}</b>],
            ['DATE:', fmtDate(d.date)],
            ['G.W:', h(d, 'grossWeightKg') && `${qty(h(d, 'grossWeightKg'))} KGS`],
            ['VOLUME:', h(d, 'volumeCbm') && `${qty(h(d, 'volumeCbm'))} CBM`],
            ['PKGS:', h(d, 'pkgs')],
            ['CTNR No:', h(d, 'containerNo')],
            ['REF:', h(d, 'reference')],
          ]}
        />
      </div>
      <SimpleLines d={d} showMark={false} />
      <div className={s.note} style={{ textAlign: 'center', marginTop: 18 }}>
        Thank you for your supporting
      </div>
      <div className={s.signs}>
        <div style={{ flex: '0 0 40%', marginLeft: 'auto' }}>AUTHORIZED SIGNATURE</div>
      </div>
    </>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-08-21 → 21-Aug-2026, as on the broker's voucher. */
const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}-${MONTHS[Number(m) - 1]}-${y}` : iso;
};
/** 2420 → 2,420 and 1.5 → 1.5: no padded decimals. */
const plain = (v: string | number | null | undefined) =>
  v === '' || v === null || v === undefined
    ? ''
    : Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 });

/** Credit Noted sheet (no letterhead, like the broker's voucher); also the editor's live preview. */
export function CreditNote({ d }: { d: BillingDoc }) {
  const lookups = useLookups();
  const port = lookups.data?.ports.find((p) => p.id === h(d, 'portId'));
  const refLabel =
    { HOUSE_BILL: 'HOUS BILL', BILL_NO: 'BILL NO', HAWB_NO: 'HAWB NO' }[
      h(d, 'refType') as 'HOUSE_BILL'
    ] ?? 'REF';
  const left: [string, string][] = [
    ['BILL TO:', h(d, 'billTo')],
    ['ADDRESS:', h(d, 'address')],
    ['SHIPPER:', h(d, 'shipper')],
    ['PORT:', port?.name.toUpperCase() ?? ''],
    ['CTNR:', h(d, 'containerNo')],
  ];
  const right: [string, string][] = [
    ['DECLARE NO:', h(d, 'declareNo')],
    [`${refLabel}:`, h(d, 'refNo')],
    ['DATE:', longDate(d.date)],
    ["Q'TY:", h(d, 'quantityText')],
    ['G.W:', h(d, 'grossWeightKg') && `${plain(h(d, 'grossWeightKg'))} KGS`],
    ['CBM:', plain(h(d, 'cbm'))],
  ];
  const kv = (rows: [string, string][], cls: string | undefined) => (
    <dl className={cls}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <div className={cn.cn}>
      <div className={cn.title}>CREDIT NOTED</div>
      <div className={cn.head}>
        {kv(left, cn.kv)}
        {kv(right, `${cn.kv} ${cn.right}`)}
      </div>
      <table className={cn.table}>
        <colgroup>
          <col style={{ width: '5%' }} />
          <col style={{ width: '45%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '16%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>NO</th>
            <th>DESCRIPTION</th>
            <th>Q&apos;TY</th>
            <th>SHIP</th>
            <th>PRICE</th>
            <th>SHPT</th>
            <th>MARK</th>
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l) => (
            <tr key={l.id}>
              <td className={cn.c}>{l.lineNo}</td>
              <td>{l.description}</td>
              <td className={cn.c}>{plain(l.qty)}</td>
              <td className={cn.c}>{l.unit}</td>
              <td className={cn.r}>{money(l.unitPrice)}</td>
              <td className={cn.r}>{money(l.subtotal)}</td>
              <td>{l.mark}</td>
            </tr>
          ))}
          <tr className={cn.total}>
            <td colSpan={4} />
            <td className={cn.r}>TOTAL:</td>
            <td className={cn.r}>{money(d.totals.total)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function RecordSummary({ d, c }: { d: BillingDoc; c: CompanyInfo }) {
  const lookups = useLookups();
  const port = lookups.data?.ports.find((p) => p.id === h(d, 'portId'));
  const fwd = lookups.data?.forwarders.find((f) => f.id === h(d, 'forwarderId'));
  const mode =
    h(d, 'transportMode') === 'AIR'
      ? 'AIR'
      : `${h(d, 'transportMode')} ${h(d, 'loadType') === 'FCL' ? 'CY/CY' : h(d, 'loadType') === 'LCL' ? 'LCL/LCL' : ''}`.trim();
  return (
    <>
      <CompanyHead c={c} />
      <div className={s.title}>
        <div className={s.titleEn}>RECORD SUMMARY</div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <b>SHIPMENT:</b> <span className={s.checkbox}>☑ {h(d, 'direction')}</span>
        <span className={s.checkbox}>☑ {mode}</span>
      </div>
      <div className={s.grid2}>
        <KV
          rows={[
            ['INVOICE NO:', h(d, 'invNo')],
            ['DISBURSEMENT NO:', h(d, 'disNo')],
            ['DEBIT NOTE NO:', h(d, 'dnNo')],
            [
              'CTNR NO:',
              `${h(d, 'containerNo')}${h(d, 'containerSize') ? ` (${h(d, 'containerSize')})` : ''}`,
            ],
            ['GROSS WEIGHT:', h(d, 'grossWeightKg') && `${qty(h(d, 'grossWeightKg'))} KGS`],
            ['CBM:', h(d, 'cbm') && qty(h(d, 'cbm'))],
            ['FORWARDER:', fwd?.name ?? ''],
          ]}
        />
        <KV
          rows={[
            ['FACTORY:', d.clientName],
            ['PORT:', port ? `${port.code} · ${port.name}` : ''],
            ['QUANTITY:', h(d, 'quantityText')],
            ['BL NO:', h(d, 'blNo')],
            ['DECLARE NO:', h(d, 'declareNo')],
            ['DATE:', fmtDate(d.date)],
          ]}
        />
      </div>
      <SimpleLines d={d} showMark unitHeader="SHIP" totalLabel="TOTAL:" />
    </>
  );
}
