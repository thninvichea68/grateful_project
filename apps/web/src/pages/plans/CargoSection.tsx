import { useEffect, useRef, useState } from 'react';
import { useFieldArray, useFormContext, useWatch, type Control } from 'react-hook-form';
import { invoiceHtsCodes, type CargoExcelParseResult } from '@gs/shared';
import { uploadFile } from '../../lib/files';
import { ApiError } from '../../lib/api';
import { fmtNum } from '../../lib/format';
import { FieldError } from '../../components/ui';
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

const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Cargo, Pricing & FOB" — one row per invoice; open a row for its line items (prototype layout). */
export function CargoSection({ shipmentId }: { shipmentId?: string | undefined }) {
  const {
    control,
    register,
    setValue,
    getValues,
    formState: { errors },
  } = useFormContext<FormValues>();
  const invoices = useFieldArray({ control, name: 'invoices' });
  const watched = useWatch({ control, name: 'invoices' });
  const [openIdx, setOpenIdx] = useState<Set<number>>(() => new Set([0]));
  const [status, setStatus] = useState<{
    text: string;
    warnings: CargoExcelParseResult['warnings'];
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
      const res = await uploadFile<CargoExcelParseResult>('/shipments/parse-cargo-excel', file, {
        shipmentId,
      });
      const current = getValues('invoices') ?? [];
      const blank = current.every(
        (i) => !i.invoiceNo && i.lines.every((l) => !l.pcs && !l.poNo && !l.styleNo),
      );
      const imported: InvoiceValues[] = res.invoices.map((i) => ({
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
      setStatus({
        text: `Imported ${res.invoices.length} invoice${res.invoices.length === 1 ? '' : 's'}, ${lines} line${lines === 1 ? '' : 's'} from ${file.name}`,
        warnings: res.warnings,
      });
    } catch (e) {
      setStatus({
        text: e instanceof ApiError ? e.message : 'The file could not be read.',
        warnings: [],
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
              <h3>Cargo, Pricing &amp; FOB</h3>
              <p>Add invoices, then open each one to enter its line items</p>
            </div>
          </div>
          <div className="cargo-actions">
            {status && <span className="cargo-status">{status.text}</span>}
            <button
              type="button"
              className="cargo-btn"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
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
              color: 'var(--status-pending-fg)',
              fontWeight: 600,
            }}
          >
            {status.warnings.slice(0, 8).map((w, i) => (
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
              {invoices.fields.map((f, gi) => (
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
              ))}
            </div>
          </div>
        </div>
      </div>
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
      <input
        type="text"
        inputMode={num ? 'decimal' : undefined}
        className={`cargo-cell${num ? ' cargo-cell-num' : ''}`}
        placeholder={ph}
        {...register(`invoices.${gi}.lines.${li}.${field}`)}
        aria-invalid={!!lineErr(li, field)}
        title={lineErr(li, field)}
      />
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
