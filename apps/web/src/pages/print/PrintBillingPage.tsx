import { useEffect, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  amountInWords,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  type BillingClient,
  type BillingPack,
  type BillingStatement,
  type OfficialReceipt,
  type StatementKind,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useCompany, type CompanyInfo } from '../../features/accounting';
import { useBillingPack, useReceipt } from '../../features/billing';
import {
  PACK_PARTS as PARTS,
  periodCode,
  periodRange,
  STATEMENT_TITLE,
  type PackPart as Part,
} from '../accounting/billingUi';
import { CompanyHead } from './PrintDocPage';
import { DebitNote, sheetClass, TaxOrDisbursement } from './InvoicePrint';
import s from './print.module.css';
import p from './billingPrint.module.css';
import { useAutoPrint } from './useAutoPrint';

const money = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 2026-09-03 → 03-09-2026, the date style of the Excel statements and receipts. */
const dmy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh' }).format(new Date());

function Toolbar({ children }: { children?: ReactNode }) {
  return (
    <div className={p.toolbar}>
      {children}
      <div className={p.buttons}>
        <button type="button" className={s.btn} onClick={() => window.close()}>
          Close
        </button>
        <button type="button" className={s.btnPrimary} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
    </div>
  );
}

/**
 * A client's month as one printable pack, replacing the Excel workbook: each shipment's tax
 * invoice, disbursement and debit note, the two account statements, the official receipts
 * and the handover checklist. Only issued documents are included.
 */
export function PrintPackPage() {
  const { clientId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : '';
  const pack = useBillingPack(clientId, month);
  const company = useCompany();
  const { user } = useAuth();
  const asked = params.get('parts')?.split(',') ?? PARTS.map(([k]) => k);
  const on = (k: Part) => asked.includes(k);
  const toggle = (k: Part) => {
    const next = on(k) ? asked.filter((x) => x !== k) : [...asked, k];
    setParams({ month, parts: next.join(',') }, { replace: true });
  };
  useEffect(() => {
    if (pack.data)
      document.title = `${pack.data.client.code} ${periodCode(month)} — Grateful Solutions`;
  }, [pack.data, month]);
  useAutoPrint(!!pack.data && !company.isLoading);

  if (!month) return <div className={s.page}>Choose a month.</div>;
  if (pack.isLoading || company.isLoading) return <div className={s.page}>Loading…</div>;
  if (!pack.data) return <div className={s.page}>Not found.</div>;
  const d = pack.data;
  const c = company.data ?? {};
  // "receipts": every statement's receipts; "rc-INVOICE" / "rc-DEBIT_NOTE": one statement's.
  const receipts = (['INVOICE', 'DEBIT_NOTE'] as const)
    .filter((kind) => on('receipts') || asked.includes(`rc-${kind}`))
    .flatMap((kind) => statementReceipts(d, month, kind));
  const drafts = d.summary.drafts;

  const sheets: ReactNode[] = [];
  if (on('docs'))
    for (const doc of d.docs)
      sheets.push(
        <div className={sheetClass(doc.type)} key={doc.id}>
          {doc.type === 'debit-notes' ? (
            <DebitNote d={doc} c={c} />
          ) : (
            <TaxOrDisbursement d={doc} c={c} tax={doc.type === 'tax-invoices'} />
          )}
        </div>,
      );
  for (const kind of ['INVOICE', 'DEBIT_NOTE'] as const)
    if (on(`st-${kind}`) && d.statements[kind].lines.length)
      sheets.push(
        <div className={s.sheet} key={`st-${kind}`}>
          <StatementSheet client={d.client} month={month} st={d.statements[kind]} c={c} />
        </div>,
      );
  for (let i = 0; i < receipts.length; i += 2)
    sheets.push(
      <div className={`${s.sheet} ${p.receiptSheet}`} key={`or-${i}`}>
        {receipts.slice(i, i + 2).map((r) => (
          <ReceiptBlock key={r.id} r={r} c={c} />
        ))}
      </div>,
    );
  if (on('checklist'))
    sheets.push(
      <div className={s.sheet} key="checklist">
        <ChecklistSheet pack={d} month={month} c={c} preparedBy={user?.fullName ?? ''} />
      </div>,
    );

  return (
    <div className={s.page}>
      <Toolbar>
        <div className={p.toggles}>
          {PARTS.map(([k, label]) => (
            <label key={k}>
              <input type="checkbox" checked={on(k)} onChange={() => toggle(k)} />
              {label}
            </label>
          ))}
        </div>
      </Toolbar>
      {drafts > 0 && (
        <div className={p.hint}>
          {drafts} draft{drafts === 1 ? ' is' : 's are'} not in this pack. Issue{' '}
          {drafts === 1 ? 'it' : 'them'} in Client Billing first.
        </div>
      )}
      {sheets.length ? (
        <div className={p.pack}>{sheets}</div>
      ) : (
        <div className={p.hint}>Nothing to print for these choices yet.</div>
      )}
    </div>
  );
}

/** One official receipt (on the top half of an A4 sheet). */
export function PrintReceiptPage() {
  const { id = '' } = useParams();
  const receipt = useReceipt(id);
  const company = useCompany();
  useEffect(() => {
    if (receipt.data) document.title = `${receipt.data.receiptNo} — Grateful Solutions`;
  }, [receipt.data]);
  useAutoPrint(!!receipt.data && !company.isLoading);
  if (receipt.isLoading || company.isLoading) return <div className={s.page}>Loading…</div>;
  if (!receipt.data) return <div className={s.page}>Receipt not found.</div>;
  return (
    <div className={s.page}>
      <Toolbar />
      <div className={`${s.sheet} ${p.receiptSheet}`}>
        <ReceiptBlock r={receipt.data} c={company.data ?? {}} />
      </div>
    </div>
  );
}

/** Account statement, laid out like the Excel ST-INV / STA-DN sheets. */
export function StatementSheet({
  client,
  month,
  st,
  c,
}: {
  client: BillingClient;
  month: string;
  st: BillingStatement;
  c: CompanyInfo;
}) {
  const inv = st.kind === 'INVOICE';
  const paid = st.receipts.filter((r) => r.status === 'ISSUED');
  const span = inv ? 5 : 4;
  return (
    <>
      <CompanyHead c={c} khmer={inv} />
      <div className={p.stTitle}>Account Statement</div>
      <div className={p.stPeriod}>
        Date: {periodRange(month)}
        {!inv && ' · Debit notes'}
      </div>
      <div className={p.billTo}>
        <b>{(client.legalName ?? client.name).toUpperCase()}</b>
        {client.address}
      </div>
      <table className={p.stTable}>
        <thead>
          <tr>
            <th>No</th>
            <th>Date</th>
            {inv ? (
              <>
                <th>INV Number</th>
                <th>Disbursement</th>
              </>
            ) : (
              <th>DN Number</th>
            )}
            <th>{inv ? 'REF #' : 'REF NO'}</th>
            <th>Currency</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {st.lines.map((l, i) => (
            <tr key={i}>
              <td className={p.c}>{i + 1}</td>
              <td className={p.c}>{dmy(l.date)}</td>
              {inv ? (
                <>
                  <td className={p.c}>{l.invNo ?? '-'}</td>
                  <td className={p.c}>{l.disNo ?? '-'}</td>
                </>
              ) : (
                <td className={p.c}>{l.dnNo}</td>
              )}
              <td className={p.c}>{l.ref ?? '-'}</td>
              <td className={p.c}>USD</td>
              <td className={p.r}>{money(l.amount)}</td>
            </tr>
          ))}
          <tr className={p.balanceRow}>
            <td colSpan={span} className={p.r}>
              BALANCE AS {periodCode(month)}
            </td>
            <td className={p.c}>USD</td>
            <td className={p.r}>{money(st.total)}</td>
          </tr>
          {paid.map((r) => (
            <tr key={r.id} className={p.lessRow}>
              <td colSpan={span} className={p.r}>
                Less: received {dmy(r.receiptDate)} · {r.receiptNo}
              </td>
              <td className={p.c}>USD</td>
              <td className={p.r}>-{money(r.amount)}</td>
            </tr>
          ))}
          {paid.length > 0 && (
            <tr className={p.balanceRow}>
              <td colSpan={span} className={p.r}>
                BALANCE DUE
              </td>
              <td className={p.c}>USD</td>
              <td className={p.r}>{money(st.balance)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className={s.note} style={{ marginTop: 18 }}>
        <b>Note:</b> You can make payment by cross cheque to: <b>{c.bankAccountName}</b> or deposit
        cash/cheque payment to bank as below:
        <br />
        <b>{c.bankName}</b> · A/NAME: {c.bankAccountName} · AC/NO: {c.bankAccountNo}
      </div>
    </>
  );
}

/** A receipt not recorded yet: printed in advance for a statement's balance, filled in by hand. */
type ReceiptView = Omit<OfficialReceipt, 'paymentMethod'> & {
  paymentMethod: OfficialReceipt['paymentMethod'] | null;
  /** True for the advance copy: no number, method or signer yet. */
  pending?: boolean;
};

/** The month's last day (2026-09 → 2026-09-30), the date on the Excel's OR-INV sheet. */
const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, '0')}`;
};

/**
 * A statement's receipts: those recorded (not void), then — while something is still due —
 * one for the balance, so it can be printed and handed over before the client pays.
 */
function statementReceipts(d: BillingPack, month: string, kind: StatementKind): ReceiptView[] {
  const st = d.statements[kind];
  const list: ReceiptView[] = st.receipts
    .filter((r) => r.status === 'ISSUED')
    .sort((a, b) => a.receiptNo.localeCompare(b.receiptNo));
  if (Number(st.balance) > 0)
    list.push({
      id: `pending-${kind}`,
      receiptNo: '',
      clientId: d.client.id,
      clientCode: d.client.code,
      clientName: d.client.name,
      receivedFrom: (d.client.legalName ?? d.client.name).toUpperCase(),
      month,
      kind,
      receiptDate: monthEnd(month),
      amount: st.balance,
      paymentMethod: null,
      paymentRef: null,
      note: null,
      status: 'DRAFT',
      createdByName: null,
      createdAt: '',
      pending: true,
    });
  return list;
}

/**
 * Official receipt (A5 landscape), like the Excel OR-INV sheet, amount in words generated.
 * As on that sheet, the debit-note receipt has no letterhead (logo and company details).
 */
export function ReceiptBlock({ r, c }: { r: ReceiptView; c: CompanyInfo }) {
  const letterhead = r.kind !== 'DEBIT_NOTE';
  return (
    <div className={p.receipt}>
      {r.status === 'VOID' && <div className={p.void}>VOID</div>}
      <div className={p.rcHead}>
        {letterhead && <img src="/logo.png" alt="" />}
        <div className={p.rcCompany}>
          {letterhead && (
            <>
              <b>{c.nameEn}</b>
              <span>( VATTIN ): {c.vattin}</span>
              <br />
              <span>
                {c.addressEn}
                {c.phone ? ` · Tel: ${c.phone}` : ''}
              </span>
            </>
          )}
        </div>
        <div className={p.rcNo}>
          No. {r.pending ? <span className={p.blank} /> : <b>{r.receiptNo}</b>}
          <br />
          Date: <b>{dmy(r.receiptDate)}</b>
        </div>
      </div>
      <div className={p.rcTitle}>OFFICIAL RECEIPT</div>
      <dl className={p.rcRows}>
        <dt>Received from</dt>
        <dd>
          <b>{r.receivedFrom}</b>
        </dd>
        <dt>Amount</dt>
        <dd className={p.rcAmount}>USD {money(r.amount)}</dd>
        <dt>Amount in word</dt>
        <dd>{amountInWords(r.amount)}</dd>
        <dt>Received for</dt>
        <dd>
          {periodCode(r.month)} — Account statement ({STATEMENT_TITLE[r.kind].toLowerCase()})
          {r.note ? ` · ${r.note}` : ''}
        </dd>
        <dt>Payment Method</dt>
        <dd>
          <span className={p.rcMethods}>
            {PAYMENT_METHODS.map((m) => (
              <span key={m}>
                <span className={p.box}>{r.paymentMethod === m ? '✓' : ''}</span>
                {PAYMENT_METHOD_LABEL[m]}
              </span>
            ))}
            {r.paymentRef && <span>Ref: {r.paymentRef}</span>}
          </span>
        </dd>
      </dl>
      <div className={p.rcSign}>
        <div>
          Received by:
          <div className={p.line} />
          {r.pending ? '' : (r.createdByName ?? '')}
          <br />
          Authorized Signature
        </div>
      </div>
    </div>
  );
}

/** "IMP & EXP SHIPMENT-CHECKING LIST": the originals handed to the client, to sign for. */
export function ChecklistSheet({
  pack,
  month,
  c,
  preparedBy,
}: {
  pack: BillingPack;
  month: string;
  c: CompanyInfo;
  preparedBy: string;
}) {
  const issued = (list: { number: string | null; status: string }[]) =>
    list.filter((x) => x.status === 'ISSUED').map((x) => x.number ?? '');
  const rows: { doc: string; declare: string; date: string }[] = [];
  for (const r of pack.rows) {
    const docs = [
      ...issued(r.docs['tax-invoices']),
      ...issued(r.docs.disbursements),
      ...issued(r.docs['debit-notes']),
    ];
    if (docs.length) rows.push({ doc: docs.join(' · '), declare: r.declareNo, date: r.invDate });
  }
  for (const o of pack.others.filter((x) => x.status === 'ISSUED'))
    rows.push({
      doc: `${o.number ?? ''}${o.reference ? ` (${o.reference})` : ''}`,
      declare: '',
      date: o.date,
    });
  for (const kind of ['INVOICE', 'DEBIT_NOTE'] as const)
    if (pack.statements[kind].lines.length)
      rows.push({
        doc: `${periodCode(month)} ACCOUNT STATEMENT (${STATEMENT_TITLE[kind].toUpperCase()})`,
        declare: '',
        date: '',
      });
  for (const r of [...pack.statements.INVOICE.receipts, ...pack.statements.DEBIT_NOTE.receipts])
    if (r.status === 'ISSUED')
      rows.push({ doc: `${r.receiptNo} (OFFICIAL RECEIPT)`, declare: '', date: r.receiptDate });
  const clientName = (pack.client.legalName ?? pack.client.name).toUpperCase();
  return (
    <>
      <div className={p.clMeta}>
        <div>
          <b>From:</b> {c.nameEn}
        </div>
        <div>
          <b>Date:</b> {dmy(today())}
        </div>
        <div>
          <b>To:</b> {clientName}
        </div>
        <div />
        <div className={p.clSubject}>
          Subject: IMP &amp; EXP SHIPMENT-CHECKING LIST · {periodCode(month)}
        </div>
      </div>
      <table className={p.clTable}>
        <thead>
          <tr>
            <th style={{ width: 40 }}>No</th>
            <th>DOC NO</th>
            <th>DECLARE NO</th>
            <th>DATE</th>
            <th>REMARK</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className={p.c}>{i + 1}</td>
              <td>{r.doc}</td>
              <td className={p.c}>{r.declare}</td>
              <td className={p.c}>{r.date ? dmy(r.date) : ''}</td>
              <td className={p.c}>ORIGINAL</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={p.clTotal}>TOTAL: {rows.length}</div>
      <div className={p.clSigns}>
        <div>
          <b>PREPARED BY:</b>
          NAME: {preparedBy}
          <br />
          DATE: {dmy(today())}
          <br />
          SIGNATURE: <span className={p.blank} />
        </div>
        <div>
          <b>RECEIVED BY: {clientName}</b>
          NAME: <span className={p.blank} />
          <br />
          DATE: <span className={p.blank} />
          <br />
          SIGNATURE: <span className={p.blank} />
        </div>
      </div>
    </>
  );
}
