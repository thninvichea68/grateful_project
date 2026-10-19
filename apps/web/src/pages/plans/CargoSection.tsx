import { useEffect, useRef, useState } from 'react';
import { useFieldArray, useFormContext, useWatch, type Control } from 'react-hook-form';
import {
  CUT_STOCK_CATEGORIES,
  CUT_STOCK_CATEGORY_LABEL,
  invoiceHtsCodes,
  type CargoExcelParseResult,
  type CutStockRow,
  type ImportCargoExcelParseResult,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useCutStock } from '../../features/hooks';
import { downloadFile, uploadFile } from '../../lib/files';
import { ApiError } from '../../lib/api';
import { fmtNum } from '../../lib/format';
import { FieldError } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { blankInvoice, blankLine, toNum, type FormValues, type InvoiceValues } from './formModel';

const CHEVRON = (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

/** The invoice's HTS codes (one invoice = one code; more than one is flagged). */
const htsCodesOf = (lines: InvoiceValues['lines'] | undefined) => invoiceHtsCodes(lines ?? []);

/** CDC numbers compare without case, spaces or dashes ("II-125" = "ii 125"), as on the server. */
const cdcKey = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[\s\-–—_]+/g, '');

const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Cargo, Pricing & FOB" — one row per invoice; open a row for its line items (prototype layout). */
export function CargoSection({ shipmentId }: { shipmentId?: string | undefined }) {
  const {
    control,
    register,
    setValue,
    getValues,
    formState: { errors, defaultValues },
  } = useFormContext<FormValues>();
  const invoices = useFieldArray({ control, name: 'invoices' });
  const watched = useWatch({ control, name: 'invoices' });
  // Imports follow the import schedule: CDC items instead of PO / style / HTS.
  const isImport = useWatch({ control, name: 'direction' }) === 'IMPORT';
  const clientId = useWatch({ control, name: 'clientId' });
  const cut = useCutStock({ clientId, pageSize: 500, sort: 'lineNo' }, isImport && !!clientId);
  const cdcItems = cut.data?.data ?? [];
  // Each import item's PCS come off its master-list balance. The balance already excludes this
  // shipment's saved items (saving replaces them), so those are added back before the form's.
  const remainingAfter = new Map<string, number>();
  if (isImport) {
    const byKey = new Map(cdcItems.map((it) => [cdcKey(it.declareRef), it]));
    const add = (cdcNo: string | null | undefined, qty: number) => {
      const it = cdcNo ? byKey.get(cdcKey(cdcNo)) : undefined;
      if (it) remainingAfter.set(it.id, (remainingAfter.get(it.id) ?? Number(it.balance)) + qty);
    };
    defaultValues?.invoices?.forEach((inv) =>
      inv?.lines?.forEach((l) => add(l?.cdcNo, toNum(l?.pcs))),
    );
    watched?.forEach((inv) => inv.lines?.forEach((l) => add(l.cdcNo, -toNum(l.pcs))));
  }
  const [openIdx, setOpenIdx] = useState<Set<number>>(() => new Set([0]));
  const [status, setStatus] = useState<{
    text: string;
    warnings: CargoExcelParseResult['warnings'];
    /** The upload was refused: the list shows why. */
    error?: boolean;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggle = (i: number) =>
    setOpenIdx((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const allOpen = invoices.fields.length > 0 && invoices.fields.every((_, i) => openIdx.has(i));

  // All invoices of a shipment share one invoice date (prototype rule).
  const setSharedDate = (date: string) =>
    (getValues('invoices') ?? []).forEach((_, i) =>
      setValue(`invoices.${i}.invoiceDate`, date, { shouldDirty: true }),
    );

  const onExcel = async (file: File) => {
    setUploading(true);
    setStatus(null);
    try {
      // Imports use the import schedule layout; each ITEM is matched to the client's master list.
      const res = isImport
        ? await uploadFile<ImportCargoExcelParseResult>(
            '/shipments/parse-import-cargo-excel',
            file,
            { clientId, shipmentId },
          )
        : await uploadFile<CargoExcelParseResult>('/shipments/parse-cargo-excel', file, {
            shipmentId,
          });
      const errs = 'errors' in res ? res.errors : [];
      if (errs.length) {
        // Nothing is filled in until every row matches the CDC master list.
        setStatus({
          text: `Nothing imported from ${file.name}: fix ${errs.length === 1 ? 'this row' : `these ${errs.length} rows`} and upload it again.`,
          warnings: errs,
          error: true,
        });
        return;
      }
      const current = getValues('invoices') ?? [];
      const blank = current.every(
        (i) => !i.invoiceNo && i.lines.every((l) => !l.pcs && !l.poNo && !l.styleNo && !l.cdcNo),
      );
      const imported: InvoiceValues[] = isImport
        ? (res as ImportCargoExcelParseResult).invoices.map((i) => ({
            ...blankInvoice(i.invoiceDate ?? ''),
            invoiceNo: i.invoiceNo,
            lines: i.lines.map((l) => ({
              ...blankLine(),
              cdcNo: l.cdcNo ?? '',
              description: l.description ?? '',
              material: l.material ?? '',
              unit: l.unit ?? '',
              pcs: l.pcs,
              netWeightKg: l.netWeightKg,
              grossWeightKg: l.grossWeightKg,
              fobUnitPrice: l.fobUnitPrice,
            })),
          }))
        : (res as CargoExcelParseResult).invoices.map((i) => ({
            invoiceNo: i.invoiceNo,
            invoiceDate: i.invoiceDate ?? '',
            description: i.description ?? '',
            lines: i.lines.map((l) => ({
              ...l,
              poNo: l.poNo ?? '',
              styleNo: l.styleNo ?? '',
              htsCode: l.htsCode ?? '',
              description: l.description ?? '',
            })),
          }));
      if (blank) invoices.replace(imported);
      else invoices.append(imported);
      setOpenIdx(new Set());
      const lines = res.invoices.reduce((n, i) => n + i.lines.length, 0);
      const noun = isImport ? 'item' : 'line';
      setStatus({
        text: `Imported ${res.invoices.length} invoice${res.invoices.length === 1 ? '' : 's'}, ${lines} ${noun}${lines === 1 ? '' : 's'} from ${file.name}`,
        warnings: res.warnings,
      });
    } catch (e) {
      setStatus({
        text: e instanceof ApiError ? e.message : 'The file could not be read.',
        warnings: [],
        error: true,
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const totals = (watched ?? []).reduce(
    (t, inv) => {
      inv.lines.forEach((l) => {
        t.ctns += toNum(l.ctns);
        t.pcs += toNum(l.pcs);
        t.nw += toNum(l.netWeightKg);
        t.gw += toNum(l.grossWeightKg);
        t.cbm += toNum(l.cbm);
        t.fob += toNum(l.pcs) * toNum(l.fobUnitPrice);
      });
      return t;
    },
    { ctns: 0, pcs: 0, nw: 0, gw: 0, cbm: 0, fob: 0 },
  );
  const invErr = errors.invoices;

  return (
    <>
      <div className="cx-card">
        <div className="cx-card-head">
          <div className="cx-title">
            <div>
              <h3>{isImport ? 'Cargo Invoices & CDC Items' : 'Cargo, Pricing & FOB'}</h3>
              <p>
                {isImport
                  ? 'Add invoices, then open each one to enter its items as on the import schedule'
                  : 'Add invoices, then open each one to enter its line items'}
              </p>
            </div>
          </div>
          <div className="cargo-actions">
            {status && (
              <span
                className="cargo-status"
                style={status.error ? { color: 'var(--status-exception-fg)' } : undefined}
              >
                {status.text}
              </span>
            )}
            {/* Imports have their own template, listing the client's CDC master list. */}
            <button
              type="button"
              className="cargo-btn"
              disabled={isImport && !clientId}
              title={isImport && !clientId ? 'Choose the client first' : undefined}
              onClick={() =>
                void (
                  isImport
                    ? downloadFile('/shipments/import-cargo-template.xlsx', { clientId })
                    : downloadFile('/shipments/cargo-template.xlsx')
                ).catch(() =>
                  setStatus({ text: 'The template could not be downloaded.', warnings: [] }),
                )
              }
            >
              ⇣ Download Template
            </button>
            <button
              type="button"
              className="cargo-btn"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || (isImport && !clientId)}
              title={isImport && !clientId ? 'Choose the client first' : undefined}
            >
              {uploading ? 'Reading…' : '⇪ Upload Excel Template'}
            </button>
            <button
              type="button"
              className="cargo-btn"
              onClick={() =>
                setOpenIdx(allOpen ? new Set() : new Set(invoices.fields.map((_, i) => i)))
              }
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
            <button
              type="button"
              className="cargo-btn cargo-btn-primary"
              onClick={() => {
                invoices.append(blankInvoice(getValues('invoices.0.invoiceDate') ?? ''));
                setOpenIdx((s) => new Set(s).add(invoices.fields.length));
              }}
            >
              + Add Invoice
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv"
              hidden
              onChange={(e) => e.target.files?.[0] && void onExcel(e.target.files[0])}
            />
          </div>
        </div>
        {status?.warnings.length ? (
          <ul
            style={{
              margin: '0 0 12px 18px',
              fontSize: 12,
              color: status.error ? 'var(--status-exception-fg)' : 'var(--status-pending-fg)',
              fontWeight: 600,
            }}
          >
            {status.warnings.slice(0, status.error ? 50 : 8).map((w, i) => (
              <li key={i}>
                {w.row ? `Row ${w.row}: ` : ''}
                {w.message}
              </li>
            ))}
          </ul>
        ) : null}
        {typeof invErr?.message === 'string' && <FieldError message={invErr.message} />}
        <div className="cargo-list">
          <div className="cargo-list-inner">
            <div className="cargo-head">
              <div className="cargo-head-cell">Invoice No</div>
              <div className="cargo-head-cell">Inv Date</div>
              <div className="cargo-head-cell cargo-r">PCS</div>
              <div className="cargo-head-cell cargo-r">CTNS</div>
              <div className="cargo-head-cell cargo-r">Total FOB</div>
              <div className="cargo-head-cell">Description</div>
              <div className="cargo-head-cell" />
            </div>
            <div className="cargo-invoices">
              {invoices.fields.map((f, gi) =>
                isImport ? (
                  <ImportInvoiceCard
                    key={f.id}
                    gi={gi}
                    control={control}
                    open={openIdx.has(gi)}
                    onToggle={() => toggle(gi)}
                    onRemove={invoices.fields.length > 1 ? () => invoices.remove(gi) : undefined}
                    register={register}
                    onDate={setSharedDate}
                    cdcItems={cdcItems}
                    remainingAfter={remainingAfter}
                    errors={Array.isArray(invErr) ? invErr[gi] : undefined}
                  />
                ) : (
                  <InvoiceCard
                    key={f.id}
                    gi={gi}
                    control={control}
                    open={openIdx.has(gi)}
                    onToggle={() => toggle(gi)}
                    onRemove={invoices.fields.length > 1 ? () => invoices.remove(gi) : undefined}
                    register={register}
                    onDate={setSharedDate}
                    errors={Array.isArray(invErr) ? invErr[gi] : undefined}
                  />
                ),
              )}
            </div>
          </div>
        </div>
      </div>
      {isImport ? (
        <div className="cargo-totals">
          <div className="cargo-totals-label">Shipment Total</div>
          <div className="cargo-total-item">
            <span>Quantity</span>
            <span>{fmtNum(totals.pcs, 2)}</span>
          </div>
          <div className="cargo-total-item">
            <span>Net Wt (kg)</span>
            <span>{fmtNum(totals.nw, 2)}</span>
          </div>
          <div className="cargo-total-item">
            <span>Gross Wt (kg)</span>
            <span>{fmtNum(totals.gw, 2)}</span>
          </div>
          <div className="cargo-total-item">
            <span>Items</span>
            <span>{fmtNum((watched ?? []).reduce((n, i) => n + i.lines.length, 0))}</span>
          </div>
          <div className="cargo-total-item cargo-total-fob">
            <span>Amount</span>
            <span>{money(totals.fob)} USD</span>
          </div>
        </div>
      ) : (
        <div className="cargo-totals">
          <div className="cargo-totals-label">Shipment Total</div>
          <div className="cargo-total-item">
            <span>CTNS</span>
            <span>{fmtNum(totals.ctns)}</span>
          </div>
          <div className="cargo-total-item">
            <span>PCS</span>
            <span>{fmtNum(totals.pcs)}</span>
          </div>
          <div className="cargo-total-item">
            <span>Net Wt (kg)</span>
            <span>{fmtNum(totals.nw, 2)}</span>
          </div>
          <div className="cargo-total-item">
            <span>Gross Wt (kg)</span>
            <span>{fmtNum(totals.gw, 2)}</span>
          </div>
          <div className="cargo-total-item">
            <span>CBM</span>
            <span>{fmtNum(totals.cbm)}</span>
          </div>
          <div className="cargo-total-item cargo-total-fob">
            <span>Total FOB</span>
            <span>{money(totals.fob)} USD</span>
          </div>
        </div>
      )}
    </>
  );
}

type InvErrors =
  | {
      invoiceNo?: { message?: string };
      htsCode?: { message?: string };
      lines?: { message?: string } | Record<number, Record<string, { message?: string }>>;
    }
  | undefined;

function InvoiceCard({
  gi,
  control,
  open,
  onToggle,
  onRemove,
  register,
  onDate,
  errors,
}: {
  gi: number;
  control: Control<FormValues>;
  open: boolean;
  onToggle: () => void;
  onRemove: (() => void) | undefined;
  register: ReturnType<typeof useFormContext<FormValues>>['register'];
  onDate: (d: string) => void;
  errors: unknown;
}) {
  const { setValue, getValues } = useFormContext<FormValues>();
  const lines = useFieldArray({ control, name: `invoices.${gi}.lines` });
  const watchedLines = useWatch({ control, name: `invoices.${gi}.lines` });
  const invDesc = useWatch({ control, name: `invoices.${gi}.description` }) ?? '';

  // Lines are grouped under descriptions. A group starts at a line whose (stable) field id
  // is in `starts`, seeded from where the saved descriptions change.
  const [starts, setStarts] = useState<Set<string>>(() => {
    const saved = getValues(`invoices.${gi}.lines`) ?? [];
    return new Set(
      lines.fields
        .filter(
          (_, i) => i === 0 || (saved[i]?.description ?? '') !== (saved[i - 1]?.description ?? ''),
        )
        .map((f) => f.id),
    );
  });
  const newGroup = useRef(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  // "+ Add Description" appends a line; once it has an id, make it start a new group.
  useEffect(() => {
    if (!newGroup.current) return;
    newGroup.current = false;
    const last = lines.fields.at(-1);
    if (!last) return;
    setStarts((s) => new Set(s).add(last.id));
    setFocusId(last.id);
  }, [lines.fields]);
  const groups: { start: number; idx: number[] }[] = [];
  lines.fields.forEach((f, i) => {
    if (i === 0 || starts.has(f.id)) groups.push({ start: i, idx: [i] });
    else groups.at(-1)!.idx.push(i);
  });
  // Older invoices kept one description on the invoice only; show it on the first group.
  const descOf = (g: { start: number }) =>
    watchedLines?.[g.start]?.description || (g.start === 0 ? invDesc : '');
  const setDesc = (g: { start: number; idx: number[] }, v: string) => {
    g.idx.forEach((i) =>
      setValue(`invoices.${gi}.lines.${i}.description`, v, { shouldDirty: true }),
    );
    // The invoice's own description mirrors the first group (used on printed documents).
    if (g.start === 0) setValue(`invoices.${gi}.description`, v, { shouldDirty: true });
  };
  const blank = (description: string) => ({
    ...blankLine(),
    htsCode: htsCodesOf(getValues(`invoices.${gi}.lines`))[0] ?? '',
    description,
  });
  const addLine = () => lines.append(blank(descOf(groups.at(-1)!)));
  const addDescription = () => {
    newGroup.current = true;
    lines.append(blank(''));
  };
  const removeLine = (li: number) => {
    // Removing a group's first line: the next line of that group takes over as its start.
    const id = lines.fields[li]!.id;
    const next = lines.fields[li + 1];
    if (starts.has(id) && next && !starts.has(next.id)) setStarts((s) => new Set(s).add(next.id));
    lines.remove(li);
  };
  const removeGroup = (g: { start: number; idx: number[] }) => {
    if (g.start === 0) {
      const second = groups[1];
      setValue(`invoices.${gi}.description`, second ? descOf(second) : '', {
        shouldDirty: true,
      });
    }
    lines.remove(g.idx);
  };
  const e = errors as InvErrors;
  const htsCodes = htsCodesOf(watchedLines);
  const setHts = (code: string) =>
    lines.fields.forEach((_, li) =>
      setValue(`invoices.${gi}.lines.${li}.htsCode`, code, { shouldDirty: true }),
    );
  // Invoice totals under the line items.
  type Sum = { pcs: number; ctns: number; nw: number; gw: number; cbm: number; fob: number };
  const lineSum = (watchedLines ?? []).reduce<Sum>(
    (t, l) => ({
      pcs: t.pcs + toNum(l.pcs),
      ctns: t.ctns + toNum(l.ctns),
      nw: t.nw + toNum(l.netWeightKg),
      gw: t.gw + toNum(l.grossWeightKg),
      cbm: t.cbm + toNum(l.cbm),
      fob: t.fob + toNum(l.pcs) * toNum(l.fobUnitPrice),
    }),
    { pcs: 0, ctns: 0, nw: 0, gw: 0, cbm: 0, fob: 0 },
  );
  const lineErr = (li: number, f: string) =>
    e?.lines && !('message' in e.lines)
      ? (e.lines as Record<number, Record<string, { message?: string }>>)[li]?.[f]?.message
      : undefined;
  const emp = (v: number) => (v ? '' : ' is-empty');
  const F = (
    li: number,
    field:
      | 'poNo'
      | 'styleNo'
      | 'htsCode'
      | 'pcs'
      | 'ctns'
      | 'netWeightKg'
      | 'grossWeightKg'
      | 'cbm'
      | 'fobUnitPrice',
    label: string,
    ph: string,
    num = false,
  ) => (
    <label className="cx-f">
      <span className="cx-lbl">{label}</span>
      {num ? (
        <NumberInput
          decimals={field === 'fobUnitPrice' ? 4 : 3}
          className="cargo-cell cargo-cell-num"
          placeholder={ph}
          {...register(`invoices.${gi}.lines.${li}.${field}`)}
          aria-invalid={!!lineErr(li, field)}
          title={lineErr(li, field)}
        />
      ) : (
        <input
          type="text"
          className="cargo-cell"
          placeholder={ph}
          {...register(`invoices.${gi}.lines.${li}.${field}`)}
          aria-invalid={!!lineErr(li, field)}
          title={lineErr(li, field)}
        />
      )}
    </label>
  );

  const renderLine = (li: number) => {
    const l = watchedLines?.[li];
    const total = l && l.pcs && l.fobUnitPrice ? toNum(l.pcs) * toNum(l.fobUnitPrice) : null;
    return (
      <div className="cx-line" key={lines.fields[li]!.id}>
        <div className="cx-line-group">
          <div className="cx-line-group-title">Product</div>
          <div className="cx-line-fields cx-g2">
            {F(li, 'poNo', 'PO No.', 'PO No.')}
            {F(li, 'styleNo', 'Style', 'Style No.')}
          </div>
        </div>
        <div className="cx-line-group">
          <div className="cx-line-group-title">Quantity</div>
          <div className="cx-line-fields cx-g2">
            {F(li, 'pcs', 'PCS', '0', true)}
            {F(li, 'ctns', 'CTNS', '0', true)}
          </div>
        </div>
        <div className="cx-line-group">
          <div className="cx-line-group-title">Weight &amp; Volume</div>
          <div className="cx-line-fields cx-g3">
            {F(li, 'netWeightKg', 'Net Wt (kg)', '0.00', true)}
            {F(li, 'grossWeightKg', 'Gross Wt (kg)', '0.00', true)}
            {F(li, 'cbm', 'CBM', '0.00', true)}
          </div>
        </div>
        <div className="cx-line-group">
          <div className="cx-line-group-title">Price</div>
          <div className="cx-line-fields cx-g2">
            {F(li, 'fobUnitPrice', 'Unit (USD)', '0.00', true)}
            <div className="cx-line-total-box">
              <span className="cx-lbl">Line Total</span>
              <div className="cargo-line-total">{total !== null ? `${money(total)} USD` : ''}</div>
            </div>
          </div>
        </div>
        {lines.fields.length > 1 && (
          <button
            type="button"
            className="cargo-row-del"
            title="Remove line"
            aria-label="Remove line"
            onClick={() => removeLine(li)}
          >
            ×
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={`cargo-inv${open ? ' open' : ''}`}>
      <div className="cargo-inv-row">
        <label className="cx-f">
          <span className="cx-lbl">Invoice No.</span>
          <input
            type="text"
            className="cargo-cell cargo-cell-strong"
            placeholder="Invoice No."
            {...register(`invoices.${gi}.invoiceNo`)}
            aria-invalid={!!e?.invoiceNo}
            title={e?.invoiceNo?.message}
          />
        </label>
        <label className="cx-f">
          <span className="cx-lbl">Invoice Date</span>
          <input
            type="date"
            className="cargo-cell"
            {...register(`invoices.${gi}.invoiceDate`, {
              onChange: (ev: React.ChangeEvent<HTMLInputElement>) => onDate(ev.target.value),
            })}
          />
        </label>
        <label className="cx-f">
          <span className="cx-lbl">HTS Code</span>
          {/* One invoice = one HTS code: shown once here and written to every line. */}
          <input
            type="text"
            className="cargo-cell"
            placeholder={htsCodes.length > 1 ? 'Choose one' : 'HTS Code'}
            value={htsCodes.length === 1 ? htsCodes[0] : ''}
            onChange={(ev) => setHts(ev.target.value)}
            aria-invalid={htsCodes.length > 1 || !!e?.htsCode}
            title={e?.htsCode?.message}
          />
        </label>
        <div className="cx-chips">
          <div className="cx-chip">
            <span className="cx-lbl">Net Wt (kg)</span>
            <div className={`cargo-sum${emp(lineSum.nw)}`}>
              {lineSum.nw ? fmtNum(lineSum.nw, 2) : '—'}
            </div>
          </div>
          <div className="cx-chip">
            <span className="cx-lbl">Gross Wt (kg)</span>
            <div className={`cargo-sum${emp(lineSum.gw)}`}>
              {lineSum.gw ? fmtNum(lineSum.gw, 2) : '—'}
            </div>
          </div>
          <div className="cx-chip">
            <span className="cx-lbl">PCS</span>
            <div className={`cargo-sum${emp(lineSum.pcs)}`}>
              {lineSum.pcs ? fmtNum(lineSum.pcs) : '—'}
            </div>
          </div>
          <div className="cx-chip">
            <span className="cx-lbl">CTNS</span>
            <div className={`cargo-sum${emp(lineSum.ctns)}`}>
              {lineSum.ctns ? fmtNum(lineSum.ctns) : '—'}
            </div>
          </div>
          <div className="cx-chip cx-chip-fob">
            <span className="cx-lbl">Total FOB</span>
            <div className={`cargo-sum cargo-sum-fob${emp(lineSum.fob)}`}>
              {lineSum.fob ? `${money(lineSum.fob)} USD` : '—'}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="cargo-toggle"
          aria-expanded={open}
          aria-label="Show invoice details"
          title="Show / hide line items"
          onClick={onToggle}
        >
          {CHEVRON}
        </button>
      </div>
      {e?.invoiceNo?.message && (
        <div style={{ padding: '0 14px 8px' }}>
          <FieldError message={e.invoiceNo.message} />
        </div>
      )}
      {htsCodes.length > 1 && (
        <div style={{ padding: '0 14px 8px' }}>
          <FieldError
            message={`The lines have different HTS codes (${htsCodes.join(', ')}). One invoice uses one HTS code — enter it above.`}
          />
        </div>
      )}
      <div className="cargo-inv-details">
        <div className="cargo-inv-details-inner">
          <div className="cargo-inv-panel">
            <div className="cargo-panel-title">
              Line items{' '}
              <small>
                {lines.fields.length} {lines.fields.length === 1 ? 'line' : 'lines'}
              </small>
            </div>
            <div className="cargo-line-cards">
              {groups.map((g) => {
                const id = lines.fields[g.start]!.id;
                return (
                  <div className="cx-desc-group" key={id}>
                    <div className="cx-desc-row">
                      <label className="cx-f">
                        <span className="cx-lbl">Description</span>
                        <input
                          type="text"
                          className="cargo-cell"
                          placeholder="e.g. Mens woven shorts 100 nylon"
                          value={descOf(g)}
                          onChange={(ev) => setDesc(g, ev.target.value)}
                          autoFocus={focusId === id}
                        />
                      </label>
                      {groups.length > 1 && (
                        <button
                          type="button"
                          className="cargo-row-del"
                          title="Remove this description and its lines"
                          aria-label="Remove description"
                          onClick={() => removeGroup(g)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    {g.idx.map(renderLine)}
                  </div>
                );
              })}
              {/* Invoice total, column-aligned with the line fields above. */}
              <div className="cx-line cx-line-sum" aria-label="Invoice total">
                <div className="cx-line-group">
                  <div className="cx-sum-label">Invoice total</div>
                </div>
                <div className="cx-line-group">
                  <div className="cx-line-fields cx-g2">
                    <div className="cx-sum-cell">{fmtNum(lineSum.pcs)}</div>
                    <div className="cx-sum-cell">{fmtNum(lineSum.ctns)}</div>
                  </div>
                </div>
                <div className="cx-line-group">
                  <div className="cx-line-fields cx-g3">
                    <div className="cx-sum-cell">{fmtNum(lineSum.nw, 2)}</div>
                    <div className="cx-sum-cell">{fmtNum(lineSum.gw, 2)}</div>
                    <div className="cx-sum-cell">{fmtNum(lineSum.cbm, 3)}</div>
                  </div>
                </div>
                <div className="cx-line-group">
                  <div className="cx-line-fields cx-g2">
                    <div />
                    <div className="cx-sum-cell cx-sum-fob">{money(lineSum.fob)} USD</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="cargo-panel-foot">
              <div className="cargo-foot-adds">
                {/* New line under the latest description. */}
                <button type="button" className="cargo-link-btn cargo-add-line" onClick={addLine}>
                  + Add line
                </button>
                {/* New description box with its first line. */}
                <button
                  type="button"
                  className="cargo-link-btn cargo-add-line"
                  onClick={addDescription}
                >
                  + Add Description
                </button>
              </div>
              {onRemove && (
                <button
                  type="button"
                  className="cargo-link-btn cargo-inv-remove"
                  onClick={onRemove}
                >
                  Remove invoice
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "II. Raw Material" → "II. RAW MATERIAL", as the import schedule writes it. */
const materialOf = (it: CutStockRow) => CUT_STOCK_CATEGORY_LABEL[it.category].toUpperCase();

/**
 * An import invoice, laid out like the import schedule: INV · DATE, then one line
 * per item (CDC NO · ITEM · MATERIAL · QUANTITY · CDC UNIT · NW · GW · UNIT PRICE · AMOUNT).
 * Choosing a CDC NO from the client's master list fills in its item, material, unit and price.
 */
function ImportInvoiceCard({
  gi,
  control,
  open,
  onToggle,
  onRemove,
  register,
  onDate,
  cdcItems,
  remainingAfter,
  errors,
}: {
  gi: number;
  control: Control<FormValues>;
  open: boolean;
  onToggle: () => void;
  onRemove: (() => void) | undefined;
  register: ReturnType<typeof useFormContext<FormValues>>['register'];
  onDate: (d: string) => void;
  cdcItems: CutStockRow[];
  remainingAfter: Map<string, number>;
  errors: unknown;
}) {
  const { setValue, getValues } = useFormContext<FormValues>();
  const { can } = useAuth();
  const lines = useFieldArray({ control, name: `invoices.${gi}.lines` });
  const watchedLines = useWatch({ control, name: `invoices.${gi}.lines` });
  const e = errors as InvErrors;
  const sum = (watchedLines ?? []).reduce(
    (t, l) => ({
      qty: t.qty + toNum(l.pcs),
      nw: t.nw + toNum(l.netWeightKg),
      gw: t.gw + toNum(l.grossWeightKg),
      amount: t.amount + toNum(l.pcs) * toNum(l.fobUnitPrice),
    }),
    { qty: 0, nw: 0, gw: 0, amount: 0 },
  );
  const lineErr = (li: number, f: string) =>
    e?.lines && !('message' in e.lines)
      ? (e.lines as Record<number, Record<string, { message?: string }>>)[li]?.[f]?.message
      : undefined;
  const emp = (v: number) => (v ? '' : ' is-empty');

  // The item is chosen from the client's CDC master list; its CDC no., material and unit follow.
  const itemOf = (cdcNo: string | null | undefined) =>
    cdcNo ? cdcItems.find((x) => cdcKey(x.declareRef) === cdcKey(cdcNo)) : undefined;
  const pickItem = (li: number, cdcNo: string) => {
    const it = itemOf(cdcNo);
    const path = `invoices.${gi}.lines.${li}` as const;
    const opts = { shouldDirty: true };
    setValue(`${path}.cdcNo`, it?.declareRef ?? '', opts);
    setValue(`${path}.description`, it?.name ?? '', opts);
    setValue(`${path}.material`, it ? materialOf(it) : '', opts);
    setValue(`${path}.unit`, it?.unit ?? '', opts);
    if (it && !toNum(getValues(`${path}.fobUnitPrice`)))
      setValue(`${path}.fobUnitPrice`, String(Number(it.unitPrice)), opts);
  };
  /** CDC no., material and unit come from the chosen item: shown, not typed. */
  const Auto = (li: number, field: 'cdcNo' | 'material' | 'unit', label: string) => (
    <label className="cx-f">
      <span className="cx-lbl">{label}</span>
      <input
        type="text"
        className="cargo-cell cargo-cell-auto"
        placeholder="—"
        readOnly
        tabIndex={-1}
        {...register(`invoices.${gi}.lines.${li}.${field}`)}
      />
    </label>
  );

  const F = (
    li: number,
    field:
      | 'material'
      | 'description'
      | 'unit'
      | 'pcs'
      | 'netWeightKg'
      | 'grossWeightKg'
      | 'fobUnitPrice',
    label: string,
    ph: string,
    num = false,
  ) => (
    <label className="cx-f">
      <span className="cx-lbl">{label}</span>
      {num ? (
        <NumberInput
          decimals={field === 'fobUnitPrice' ? 4 : 3}
          className="cargo-cell cargo-cell-num"
          placeholder={ph}
          {...register(`invoices.${gi}.lines.${li}.${field}`)}
          aria-invalid={!!lineErr(li, field)}
          title={lineErr(li, field)}
        />
      ) : (
        <input
          type="text"
          className="cargo-cell"
          placeholder={ph}
          {...register(`invoices.${gi}.lines.${li}.${field}`)}
          aria-invalid={!!lineErr(li, field)}
          title={lineErr(li, field)}
        />
      )}
    </label>
  );

  return (
    <div className={`cargo-inv${open ? ' open' : ''}`}>
      <div className="cargo-inv-row cargo-inv-row-import">
        <label className="cx-f">
          <span className="cx-lbl">Invoice No.</span>
          <input
            type="text"
            className="cargo-cell cargo-cell-strong"
            placeholder="e.g. CNQ26044"
            {...register(`invoices.${gi}.invoiceNo`)}
            aria-invalid={!!e?.invoiceNo}
            title={e?.invoiceNo?.message}
          />
        </label>
        <label className="cx-f">
          <span className="cx-lbl">Invoice Date</span>
          <input
            type="date"
            className="cargo-cell"
            {...register(`invoices.${gi}.invoiceDate`, {
              onChange: (ev: React.ChangeEvent<HTMLInputElement>) => onDate(ev.target.value),
            })}
          />
        </label>
        <div className="cx-chips">
          <div className="cx-chip">
            <span className="cx-lbl">Quantity</span>
            <div className={`cargo-sum${emp(sum.qty)}`}>{sum.qty ? fmtNum(sum.qty, 2) : '—'}</div>
          </div>
          <div className="cx-chip">
            <span className="cx-lbl">NW (kg)</span>
            <div className={`cargo-sum${emp(sum.nw)}`}>{sum.nw ? fmtNum(sum.nw, 2) : '—'}</div>
          </div>
          <div className="cx-chip">
            <span className="cx-lbl">GW (kg)</span>
            <div className={`cargo-sum${emp(sum.gw)}`}>{sum.gw ? fmtNum(sum.gw, 2) : '—'}</div>
          </div>
          <div className="cx-chip cx-chip-fob">
            <span className="cx-lbl">Amount</span>
            <div className={`cargo-sum cargo-sum-fob${emp(sum.amount)}`}>
              {sum.amount ? `${money(sum.amount)} USD` : '—'}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="cargo-toggle"
          aria-expanded={open}
          aria-label="Show invoice items"
          title="Show / hide items"
          onClick={onToggle}
        >
          {CHEVRON}
        </button>
      </div>
      {e?.invoiceNo?.message && (
        <div style={{ padding: '0 14px 8px' }}>
          <FieldError message={e.invoiceNo.message} />
        </div>
      )}
      <div className="cargo-inv-details">
        <div className="cargo-inv-details-inner">
          <div className="cargo-inv-panel">
            <div className="cargo-panel-title">
              Items{' '}
              <small>
                {lines.fields.length} {lines.fields.length === 1 ? 'item' : 'items'}
              </small>
            </div>
            <div className="cargo-line-cards">
              {lines.fields.map((f, li) => {
                const l = watchedLines?.[li];
                const amount =
                  l && l.pcs && l.fobUnitPrice ? toNum(l.pcs) * toNum(l.fobUnitPrice) : null;
                const it = itemOf(l?.cdcNo);
                const after = it ? remainingAfter.get(it.id) : undefined;
                const over = after !== undefined && after < -1e-9;
                return (
                  <div className="cx-line cx-line-imp" key={f.id}>
                    <div className="cx-line-group">
                      <div className="cx-line-fields cx-g-item">
                        <label className="cx-f">
                          <span className="cx-lbl">Item</span>
                          <select
                            className="cargo-cell"
                            value={itemOf(l?.cdcNo)?.declareRef ?? l?.cdcNo ?? ''}
                            onChange={(ev) => pickItem(li, ev.target.value)}
                            aria-invalid={!!lineErr(li, 'cdcNo')}
                          >
                            <option value="">
                              {cdcItems.length ? 'Choose item…' : 'No CDC master list items'}
                            </option>
                            {/* A saved item no longer on the list stays shown as it was. */}
                            {l?.cdcNo && !itemOf(l.cdcNo) && (
                              <option value={l.cdcNo}>{l.description || l.cdcNo}</option>
                            )}
                            {CUT_STOCK_CATEGORIES.map((cat) => {
                              const items = cdcItems.filter((it) => it.category === cat);
                              return items.length ? (
                                <optgroup key={cat} label={CUT_STOCK_CATEGORY_LABEL[cat]}>
                                  {items.map((it) => (
                                    <option key={it.id} value={it.declareRef}>
                                      {it.name}
                                    </option>
                                  ))}
                                </optgroup>
                              ) : null;
                            })}
                          </select>
                          {after !== undefined && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: over ? 'var(--status-exception-fg)' : 'var(--text-tertiary)',
                              }}
                            >
                              Balance after saving: {fmtNum(after)} {it?.unit}
                            </span>
                          )}
                        </label>
                        {Auto(li, 'cdcNo', 'CDC No.')}
                        {Auto(li, 'material', 'Material')}
                      </div>
                    </div>
                    <div className="cx-line-group">
                      <div className="cx-line-fields cx-g2">
                        {F(li, 'pcs', 'Quantity', '0', true)}
                        {Auto(li, 'unit', 'CDC Unit')}
                      </div>
                    </div>
                    <div className="cx-line-group">
                      <div className="cx-line-fields cx-g2">
                        {F(li, 'netWeightKg', 'NW (kg)', '0.00', true)}
                        {F(li, 'grossWeightKg', 'GW (kg)', '0.00', true)}
                      </div>
                    </div>
                    <div className="cx-line-group">
                      <div className="cx-line-fields cx-g2">
                        {F(li, 'fobUnitPrice', 'Unit Price (USD)', '0.00', true)}
                        <div className="cx-line-total-box">
                          <span className="cx-lbl">Amount</span>
                          <div className="cargo-line-total">
                            {amount !== null ? `${money(amount)} USD` : ''}
                          </div>
                        </div>
                      </div>
                    </div>
                    {over && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        {can('cutstock:override') ? (
                          <input
                            type="text"
                            className="cargo-cell"
                            style={{ width: '100%' }}
                            placeholder="Reason for importing over the balance (required)"
                            {...register(`invoices.${gi}.lines.${li}.overrideReason`)}
                          />
                        ) : (
                          <FieldError message="More than the remaining balance. A Manager must approve this item." />
                        )}
                      </div>
                    )}
                    {lines.fields.length > 1 && (
                      <button
                        type="button"
                        className="cargo-row-del"
                        title="Remove item"
                        aria-label="Remove item"
                        onClick={() => lines.remove(li)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
              <div className="cx-line cx-line-imp cx-line-sum" aria-label="Invoice total">
                <div className="cx-line-group">
                  <div className="cx-sum-label">Invoice total</div>
                </div>
                <div className="cx-line-group">
                  <div className="cx-line-fields cx-g2">
                    <div className="cx-sum-cell">{fmtNum(sum.qty, 2)}</div>
                    <div />
                  </div>
                </div>
                <div className="cx-line-group">
                  <div className="cx-line-fields cx-g2">
                    <div className="cx-sum-cell">{fmtNum(sum.nw, 2)}</div>
                    <div className="cx-sum-cell">{fmtNum(sum.gw, 2)}</div>
                  </div>
                </div>
                <div className="cx-line-group">
                  <div className="cx-line-fields cx-g2">
                    <div />
                    <div className="cx-sum-cell cx-sum-fob">{money(sum.amount)} USD</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="cargo-panel-foot">
              <div className="cargo-foot-adds">
                <button
                  type="button"
                  className="cargo-link-btn cargo-add-line"
                  onClick={() => lines.append(blankLine())}
                >
                  + Add item
                </button>
              </div>
              {onRemove && (
                <button
                  type="button"
                  className="cargo-link-btn cargo-inv-remove"
                  onClick={onRemove}
                >
                  Remove invoice
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
