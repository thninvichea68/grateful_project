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
import c from './CargoSection.module.css';

const Icon = ({ d }: { d: string }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d={d} />
  </svg>
);
const ICON_DOWN = 'M12 4v12m0 0-5-5m5 5 5-5M5 20h14';
const ICON_UP = 'M12 20V8m0 0-5 5m5-5 5 5M5 4h14';
const ICON_PLUS = 'M12 5v14M5 12h14';
const ICON_ARROW = 'M5 12h14m-6-6 6 6-6 6';

/** Card heading with its step number. */
function Head({
  n,
  title,
  tag,
  children,
}: {
  n: number;
  title: string;
  /** A small label beside the title. */
  tag?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={c.head}>
      <h3 className={c.title}>
        <span className={c.step}>{n}</span>
        {title}
        {tag && <span className={c.chip}>{tag}</span>}
      </h3>
      {children && <div className={c.actions}>{children}</div>}
    </div>
  );
}

/** The invoice's HTS codes (one invoice = one code; more than one is flagged). */
const htsCodesOf = (lines: InvoiceValues['lines'] | undefined) => invoiceHtsCodes(lines ?? []);

/** CDC numbers compare without case, spaces or dashes ("II-125" = "ii 125"), as on the server. */
const cdcKey = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[\s\-–—_]+/g, '');

const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A line counts as entered once it has a quantity or something that names the goods. */
const lineEntered = (l: InvoiceValues['lines'][number]) =>
  !!(toNum(l.pcs) || l.cdcNo || l.poNo || l.styleNo);

const hasLineErrors = (errors: unknown, gi: number) =>
  Array.isArray(errors) && !!(errors[gi] as { lines?: unknown } | undefined)?.lines;

/**
 * Step "Invoices": one row per cargo invoice (number, date, and for an export its HTS code),
 * with its totals worked out from the items. The items are entered below it, in ItemsSection.
 */
export function InvoicesSection({
  shipmentId,
  active,
  onOpenItems,
}: {
  shipmentId?: string | undefined;
  /** The invoice whose items are open below. */
  active?: number;
  /** Go to the Items step with this invoice open. */
  onOpenItems: (gi: number) => void;
}) {
  const {
    control,
    getValues,
    setValue,
    formState: { errors },
  } = useFormContext<FormValues>();
  const invoices = useFieldArray({ control, name: 'invoices' });
  const watched = useWatch({ control, name: 'invoices' });
  // Imports follow the import schedule: CDC items instead of PO / style / HTS.
  const isImport = useWatch({ control, name: 'direction' }) === 'IMPORT';
  const clientId = useWatch({ control, name: 'clientId' });
  const [status, setStatus] = useState<{
    text: string;
    warnings: CargoExcelParseResult['warnings'];
    /** The upload was refused: the list shows why. */
    error?: boolean;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
      const blank = current.every((i) => !i.invoiceNo && !i.lines.some(lineEntered));
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
      const lines = res.invoices.reduce((n, i) => n + i.lines.length, 0);
      const noun = isImport ? 'item' : 'line';
      setStatus({
        text: `Imported ${res.invoices.length} invoice${res.invoices.length === 1 ? '' : 's'}, ${lines} ${noun}${lines === 1 ? '' : 's'} from ${file.name}. Check them under Items below.`,
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
  const cols = isImport ? 7 : 9;
  const itemCount = (watched ?? []).reduce((n, i) => n + i.lines.filter(lineEntered).length, 0);
  const stats: [string, string][] = isImport
    ? [
        ['Quantity', fmtNum(totals.pcs, 2)],
        ['Net Wt (kg)', fmtNum(totals.nw, 2)],
        ['Gross Wt (kg)', fmtNum(totals.gw, 2)],
        ['Items', fmtNum(itemCount)],
      ]
    : [
        ['CTNS', fmtNum(totals.ctns)],
        ['PCS', fmtNum(totals.pcs)],
        ['Net Wt (kg)', fmtNum(totals.nw, 2)],
        ['Gross Wt (kg)', fmtNum(totals.gw, 2)],
        ['CBM', fmtNum(totals.cbm)],
      ];
  const noClient = isImport && !clientId;

  return (
    <section className={c.card}>
      <Head n={1} title="Invoices">
        {/* Imports have their own template, listing the client's CDC master list. */}
        <button
          type="button"
          className={c.btn}
          disabled={noClient}
          title={noClient ? 'Choose the client first' : 'Download the Excel template'}
          onClick={() =>
            void (
              isImport
                ? downloadFile('/shipments/import-cargo-template.xlsx', { clientId })
                : downloadFile('/shipments/cargo-template.xlsx')
            ).catch(() =>
              setStatus({
                text: 'The template could not be downloaded.',
                warnings: [],
                error: true,
              }),
            )
          }
        >
          <Icon d={ICON_DOWN} /> Template
        </button>
        <button
          type="button"
          className={`${c.btn} ${c.btnOutline}`}
          onClick={() => fileRef.current?.click()}
          disabled={uploading || noClient}
          title={noClient ? 'Choose the client first' : undefined}
        >
          <Icon d={ICON_UP} /> {uploading ? 'Reading…' : 'Upload Excel'}
        </button>
        <span className={c.divider} aria-hidden />
        <button
          type="button"
          className={`${c.btn} ${c.btnPrimary}`}
          onClick={() => invoices.append(blankInvoice(getValues('invoices.0.invoiceDate') ?? ''))}
        >
          <Icon d={ICON_PLUS} /> Add invoice
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.csv"
          hidden
          onChange={(e) => e.target.files?.[0] && void onExcel(e.target.files[0])}
        />
      </Head>
      {status && (
        <div className={c.notice} data-tone={status.error ? 'error' : 'ok'} role="status">
          {status.text}
          {status.warnings.length ? (
            <ul>
              {status.warnings.slice(0, status.error ? 50 : 8).map((w, i) => (
                <li key={i}>
                  {w.row ? `Row ${w.row}: ` : ''}
                  {w.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {typeof invErr?.message === 'string' && (
        <div className={c.errorBox}>
          <FieldError message={invErr.message} />
        </div>
      )}
      <div className={c.tableWrap}>
        <table className={c.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Invoice No.</th>
              <th>Invoice Date</th>
              {!isImport && <th>HTS Code</th>}
              <th className={c.num}>{isImport ? 'Items' : 'Lines'}</th>
              <th className={c.num}>{isImport ? 'Quantity' : 'PCS'}</th>
              {!isImport && <th className={c.num}>CTNS</th>}
              <th className={c.num}>Amount (USD)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invoices.fields.map((f, gi) => (
              <InvoiceRow
                key={f.id}
                gi={gi}
                active={gi === active}
                isImport={isImport}
                cols={cols}
                onDate={setSharedDate}
                onItems={() => onOpenItems(gi)}
                onRemove={invoices.fields.length > 1 ? () => invoices.remove(gi) : undefined}
                errors={Array.isArray(invErr) ? invErr[gi] : undefined}
                itemErrors={hasLineErrors(invErr, gi)}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className={c.summary} aria-label="Shipment total">
        <span className={c.summaryLabel}>Shipment total</span>
        <dl className={c.stats}>
          {stats.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <div className={c.grand}>
          <span>{isImport ? 'Amount' : 'Total FOB'}</span>
          <strong>
            {money(totals.fob)}
            <small>USD</small>
          </strong>
        </div>
      </div>
    </section>
  );
}

function InvoiceRow({
  gi,
  active,
  isImport,
  cols,
  onDate,
  onItems,
  onRemove,
  errors,
  itemErrors,
}: {
  gi: number;
  active: boolean;
  isImport: boolean;
  cols: number;
  onDate: (d: string) => void;
  onItems: () => void;
  onRemove: (() => void) | undefined;
  errors: unknown;
  itemErrors: boolean;
}) {
  const { control, register, setValue } = useFormContext<FormValues>();
  const lines = useWatch({ control, name: `invoices.${gi}.lines` }) ?? [];
  const e = errors as InvErrors;
  // Only exports carry an HTS code per invoice; import items are matched by CDC no. instead.
  const htsCodes = isImport ? [] : htsCodesOf(lines);
  // One invoice = one HTS code: entered once here and written to every line.
  const setHts = (code: string) =>
    lines.forEach((_, li) =>
      setValue(`invoices.${gi}.lines.${li}.htsCode`, code, { shouldDirty: true }),
    );
  const sum = lines.reduce<{ pcs: number; ctns: number; amount: number }>(
    (t, l) => ({
      pcs: t.pcs + toNum(l.pcs),
      ctns: t.ctns + toNum(l.ctns),
      amount: t.amount + toNum(l.pcs) * toNum(l.fobUnitPrice),
    }),
    { pcs: 0, ctns: 0, amount: 0 },
  );
  const entered = lines.filter(lineEntered).length;
  const message =
    e?.invoiceNo?.message ??
    (htsCodes.length > 1
      ? `The lines have different HTS codes (${htsCodes.join(', ')}). One invoice uses one HTS code — enter it here.`
      : e?.htsCode?.message);
  return (
    <>
      <tr data-active={active}>
        <td>{gi + 1}</td>
        <td style={{ minWidth: 180 }}>
          <input
            type="text"
            className={c.in}
            placeholder={isImport ? 'e.g. CNQ26044' : 'Invoice No.'}
            {...register(`invoices.${gi}.invoiceNo`)}
            aria-invalid={!!e?.invoiceNo}
          />
        </td>
        <td style={{ width: 180 }}>
          <input
            type="date"
            className={c.in}
            {...register(`invoices.${gi}.invoiceDate`, {
              onChange: (ev: React.ChangeEvent<HTMLInputElement>) => onDate(ev.target.value),
            })}
          />
        </td>
        {!isImport && (
          <td style={{ width: 160 }}>
            <input
              type="text"
              className={c.in}
              placeholder={htsCodes.length > 1 ? 'Choose one' : 'HTS Code'}
              value={htsCodes.length === 1 ? htsCodes[0] : ''}
              onChange={(ev) => setHts(ev.target.value)}
              aria-invalid={htsCodes.length > 1 || !!e?.htsCode}
            />
          </td>
        )}
        <td className={`${c.num} ${entered ? '' : c.muted}`}>{entered || '—'}</td>
        <td className={`${c.num} ${sum.pcs ? '' : c.muted}`}>
          {sum.pcs ? fmtNum(sum.pcs, isImport ? 2 : 0) : '—'}
        </td>
        {!isImport && (
          <td className={`${c.num} ${sum.ctns ? '' : c.muted}`}>
            {sum.ctns ? fmtNum(sum.ctns) : '—'}
          </td>
        )}
        <td className={`${c.num} ${sum.amount ? '' : c.muted}`} style={{ fontWeight: 600 }}>
          {sum.amount ? money(sum.amount) : '—'}
        </td>
        <td style={{ width: 1 }}>
          <div className={c.rowActions}>
            <button
              type="button"
              className={`${c.btn} ${itemErrors ? c.btnDanger : entered ? c.btnOutline : c.btnAdd}`}
              onClick={onItems}
              title={itemErrors ? 'Some items need fixing' : undefined}
            >
              {itemErrors ? '! Fix items' : entered ? 'Edit items' : 'Enter items'}
              <Icon d={ICON_ARROW} />
            </button>
            {onRemove ? (
              <button
                type="button"
                className={c.del}
                title="Remove invoice"
                aria-label="Remove invoice"
                onClick={onRemove}
              >
                ×
              </button>
            ) : (
              <span style={{ width: 28 }} aria-hidden />
            )}
          </div>
        </td>
      </tr>
      {message && (
        <tr className={c.msgRow}>
          <td colSpan={cols}>
            <FieldError message={message} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Where "Enter items →" scrolls to. */
export const ITEMS_ANCHOR = 'cargo-items';

/**
 * "② Items", under the invoices: choose one invoice, then enter its items. One invoice at a
 * time, always open, so the items of different invoices never mix on screen.
 */
export function ItemsSection({
  active,
  onActive,
}: {
  active: number;
  onActive: (gi: number) => void;
}) {
  const {
    control,
    register,
    formState: { errors, defaultValues },
  } = useFormContext<FormValues>();
  const watched = useWatch({ control, name: 'invoices' }) ?? [];
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
    watched.forEach((inv) => inv.lines?.forEach((l) => add(l.cdcNo, -toNum(l.pcs))));
  }
  const invErr = errors.invoices;
  const gi = Math.min(Math.max(active, 0), watched.length - 1);
  const inv = watched[gi];

  if (!inv)
    return (
      <section className={c.card} id={ITEMS_ANCHOR}>
        <p className={c.empty}>No invoices yet: add one above first.</p>
      </section>
    );

  const noun = isImport ? 'item' : 'line';
  return (
    <section className={c.card} id={ITEMS_ANCHOR}>
      <Head
        n={2}
        title={isImport ? 'CDC Items' : 'Line Items'}
        tag={watched.length > 1 ? undefined : inv.invoiceNo || 'Invoice 1'}
      />
      {watched.length > 1 && (
        <div className={c.switcher} role="group" aria-label="Invoice">
          {watched.map((x, i) => {
            const n = x.lines.filter(lineEntered).length;
            return (
              <button
                key={i}
                type="button"
                className={c.switch}
                aria-pressed={i === gi}
                data-error={hasLineErrors(invErr, i)}
                onClick={() => onActive(i)}
              >
                {x.invoiceNo || `Invoice ${i + 1}`}
                <small>
                  {n} {noun}
                  {n === 1 ? '' : 's'}
                </small>
              </button>
            );
          })}
        </div>
      )}
      {isImport ? (
        <ImportInvoiceCard
          key={gi}
          gi={gi}
          control={control}
          register={register}
          cdcItems={cdcItems}
          remainingAfter={remainingAfter}
          errors={Array.isArray(invErr) ? invErr[gi] : undefined}
        />
      ) : (
        <InvoiceCard
          key={gi}
          gi={gi}
          control={control}
          register={register}
          errors={Array.isArray(invErr) ? invErr[gi] : undefined}
        />
      )}
    </section>
  );
}

type InvErrors =
  | {
      invoiceNo?: { message?: string };
      htsCode?: { message?: string };
      lines?: { message?: string } | Record<number, Record<string, { message?: string }>>;
    }
  | undefined;

/** An export invoice's line items, grouped under descriptions. */
function InvoiceCard({
  gi,
  control,
  register,
  errors,
}: {
  gi: number;
  control: Control<FormValues>;
  register: ReturnType<typeof useFormContext<FormValues>>['register'];
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
  /** One cell of a line; the column header names it. */
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
  ) =>
    num ? (
      <NumberInput
        decimals={field === 'fobUnitPrice' ? 4 : 3}
        className={`${c.in} ${c.inNum}`}
        placeholder={ph}
        aria-label={label}
        {...register(`invoices.${gi}.lines.${li}.${field}`)}
        aria-invalid={!!lineErr(li, field)}
        title={lineErr(li, field)}
      />
    ) : (
      <input
        type="text"
        className={c.in}
        placeholder={ph}
        aria-label={label}
        {...register(`invoices.${gi}.lines.${li}.${field}`)}
        aria-invalid={!!lineErr(li, field)}
        title={lineErr(li, field)}
      />
    );

  const renderLine = (li: number) => {
    const l = watchedLines?.[li];
    const total = l && l.pcs && l.fobUnitPrice ? toNum(l.pcs) * toNum(l.fobUnitPrice) : null;
    return (
      <div className={c.gRow} key={lines.fields[li]!.id}>
        {F(li, 'poNo', 'PO No.', 'PO No.')}
        {F(li, 'styleNo', 'Style', 'Style No.')}
        {F(li, 'pcs', 'PCS', '0', true)}
        {F(li, 'ctns', 'CTNS', '0', true)}
        {F(li, 'netWeightKg', 'Net Wt (kg)', '0.00', true)}
        {F(li, 'grossWeightKg', 'Gross Wt (kg)', '0.00', true)}
        {F(li, 'cbm', 'CBM', '0.00', true)}
        {F(li, 'fobUnitPrice', 'Unit price (USD)', '0.00', true)}
        <div className={c.amount}>{total !== null ? money(total) : ''}</div>
        {lines.fields.length > 1 ? (
          <button
            type="button"
            className={c.del}
            title="Remove line"
            aria-label="Remove line"
            onClick={() => removeLine(li)}
          >
            ×
          </button>
        ) : (
          <span />
        )}
      </div>
    );
  };

  return (
    <>
      <div className={c.gridWrap}>
        <div className={`${c.grid} ${c.gridExport}`}>
          <div className={c.gHead}>
            <div>PO No.</div>
            <div>Style</div>
            <div className={c.r}>PCS</div>
            <div className={c.r}>CTNS</div>
            <div className={c.r}>Net Wt (kg)</div>
            <div className={c.r}>Gross Wt (kg)</div>
            <div className={c.r}>CBM</div>
            <div className={c.r}>Unit (USD)</div>
            <div className={c.r}>Total (USD)</div>
            <div />
          </div>
          {groups.map((g) => {
            const id = lines.fields[g.start]!.id;
            return (
              <div className={c.descGroup} key={id}>
                <div className={c.desc}>
                  <span className={c.descLabel}>Description</span>
                  <input
                    type="text"
                    className={c.in}
                    aria-label="Description"
                    placeholder="e.g. Mens woven shorts 100 nylon"
                    value={descOf(g)}
                    onChange={(ev) => setDesc(g, ev.target.value)}
                    autoFocus={focusId === id}
                  />
                  {groups.length > 1 ? (
                    <button
                      type="button"
                      className={c.del}
                      title="Remove this description and its lines"
                      aria-label="Remove description"
                      onClick={() => removeGroup(g)}
                    >
                      ×
                    </button>
                  ) : (
                    <span style={{ width: 28, flexShrink: 0 }} />
                  )}
                </div>
                {g.idx.map(renderLine)}
              </div>
            );
          })}
          {/* Invoice total, column-aligned with the line fields above. */}
          <div className={c.gTotal} aria-label="Invoice total">
            <div className={c.gTotalLabel} style={{ gridColumn: 'span 2' }}>
              Invoice total
            </div>
            <div className={c.r}>{fmtNum(lineSum.pcs)}</div>
            <div className={c.r}>{fmtNum(lineSum.ctns)}</div>
            <div className={c.r}>{fmtNum(lineSum.nw, 2)}</div>
            <div className={c.r}>{fmtNum(lineSum.gw, 2)}</div>
            <div className={c.r}>{fmtNum(lineSum.cbm, 3)}</div>
            <div />
            <div className={`${c.r} ${c.accent}`}>{money(lineSum.fob)}</div>
            <div />
          </div>
        </div>
      </div>
      <div className={c.foot}>
        {/* New line under the latest description. */}
        <button type="button" className={`${c.btn} ${c.btnAdd}`} onClick={addLine}>
          <Icon d={ICON_PLUS} /> Add line
        </button>
        {/* New description with its first line. */}
        <button type="button" className={`${c.btn} ${c.btnAdd}`} onClick={addDescription}>
          <Icon d={ICON_PLUS} /> Add description
        </button>
      </div>
    </>
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
  register,
  cdcItems,
  remainingAfter,
  errors,
}: {
  gi: number;
  control: Control<FormValues>;
  register: ReturnType<typeof useFormContext<FormValues>>['register'];
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
    <input
      type="text"
      className={`${c.in} ${c.auto}`}
      placeholder="—"
      aria-label={label}
      readOnly
      tabIndex={-1}
      {...register(`invoices.${gi}.lines.${li}.${field}`)}
    />
  );

  /** One cell of an item; the column header names it. */
  const F = (
    li: number,
    field: 'pcs' | 'netWeightKg' | 'grossWeightKg' | 'fobUnitPrice',
    label: string,
    ph: string,
  ) => (
    <NumberInput
      decimals={field === 'fobUnitPrice' ? 4 : 3}
      className={`${c.in} ${c.inNum}`}
      placeholder={ph}
      aria-label={label}
      {...register(`invoices.${gi}.lines.${li}.${field}`)}
      aria-invalid={!!lineErr(li, field)}
      title={lineErr(li, field)}
    />
  );

  return (
    <>
      <div className={c.gridWrap}>
        <div className={`${c.grid} ${c.gridImport}`}>
          <div className={c.gHead}>
            <div>Item</div>
            <div>CDC No.</div>
            <div>Material</div>
            <div className={c.r}>Quantity</div>
            <div>Unit</div>
            <div className={c.r}>NW (kg)</div>
            <div className={c.r}>GW (kg)</div>
            <div className={c.r}>Unit price</div>
            <div className={c.r}>Amount (USD)</div>
            <div />
          </div>
          {lines.fields.map((f, li) => {
            const l = watchedLines?.[li];
            const amount =
              l && l.pcs && l.fobUnitPrice ? toNum(l.pcs) * toNum(l.fobUnitPrice) : null;
            const it = itemOf(l?.cdcNo);
            const after = it ? remainingAfter.get(it.id) : undefined;
            const over = after !== undefined && after < -1e-9;
            return (
              <div className={c.gRow} key={f.id}>
                <div>
                  <select
                    className={c.in}
                    aria-label="Item"
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
                    <span className={c.hint} data-over={over}>
                      Balance after saving: {fmtNum(after)} {it?.unit}
                    </span>
                  )}
                </div>
                {Auto(li, 'cdcNo', 'CDC No.')}
                {Auto(li, 'material', 'Material')}
                {F(li, 'pcs', 'Quantity', '0')}
                {Auto(li, 'unit', 'CDC Unit')}
                {F(li, 'netWeightKg', 'NW (kg)', '0.00')}
                {F(li, 'grossWeightKg', 'GW (kg)', '0.00')}
                {F(li, 'fobUnitPrice', 'Unit price (USD)', '0.00')}
                <div className={c.amount}>{amount !== null ? money(amount) : ''}</div>
                {lines.fields.length > 1 ? (
                  <button
                    type="button"
                    className={c.del}
                    title="Remove item"
                    aria-label="Remove item"
                    onClick={() => lines.remove(li)}
                  >
                    ×
                  </button>
                ) : (
                  <span />
                )}
                {over && (
                  <div className={c.full}>
                    {can('cutstock:override') ? (
                      <input
                        type="text"
                        className={c.in}
                        placeholder="Reason for importing over the balance (required)"
                        {...register(`invoices.${gi}.lines.${li}.overrideReason`)}
                      />
                    ) : (
                      <FieldError message="More than the remaining balance. A Manager must approve this item." />
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div className={c.gTotal} aria-label="Invoice total">
            <div className={c.gTotalLabel} style={{ gridColumn: 'span 3' }}>
              Invoice total
            </div>
            <div className={c.r}>{fmtNum(sum.qty, 2)}</div>
            <div />
            <div className={c.r}>{fmtNum(sum.nw, 2)}</div>
            <div className={c.r}>{fmtNum(sum.gw, 2)}</div>
            <div />
            <div className={`${c.r} ${c.accent}`}>{money(sum.amount)}</div>
            <div />
          </div>
        </div>
      </div>
      <div className={c.foot}>
        <button
          type="button"
          className={`${c.btn} ${c.btnAdd}`}
          onClick={() => lines.append(blankLine())}
        >
          <Icon d={ICON_PLUS} /> Add item
        </button>
      </div>
    </>
  );
}
