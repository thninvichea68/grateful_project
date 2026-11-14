import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { FieldError, Modal } from '../../components/ui';
import { NumberInput } from '../../components/NumberInput';
import { icons } from '../../layout/icons';
import c from './CargoSection.module.css';
import { fi } from './formIcons';
import {
  blankInvoice,
  blankLine,
  toNum,
  type FormValues,
  type InvoiceValues,
  type LineValues,
} from './formModel';

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

export type MenuAction = {
  label: string;
  icon: React.ReactNode;
  onClick?: (() => void) | undefined;
  disabled?: boolean;
  title?: string | undefined;
  danger?: boolean;
  /** Starts a new group: a thin line above it (not before the first item). */
  separated?: boolean;
};

/**
 * A ⋯ button and its menu of actions. The menu is fixed to the viewport so a scroll box (the
 * line table's) can't clip it.
 */
export function DotsMenu({
  label,
  actions,
  className = c.dotsBtn,
  alwaysEnabled = false,
}: {
  label: string;
  actions: MenuAction[];
  className?: string;
  /**
   * Opens even inside a disabled fieldset (a shipment being viewed), e.g. for View Details:
   * the trigger is then not a <button>. The menu is outside the fieldset anyway.
   */
  alwaysEnabled?: boolean;
}) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pos) return;
    const inside = (t: EventTarget | null) =>
      box.current?.contains(t as Node) || menu.current?.contains(t as Node);
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !inside(e.target)) setPos(null);
    };
    const shut = () => setPos(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', shut, true);
    window.addEventListener('resize', shut);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', shut, true);
      window.removeEventListener('resize', shut);
    };
  }, [pos]);
  const toggle = (ev: React.SyntheticEvent<HTMLElement>) => {
    if (pos) return setPos(null);
    const r = ev.currentTarget.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
  };
  const pick = (fn: () => void) => () => {
    setPos(null);
    fn();
  };
  return (
    <div className={c.menuWrap} ref={box}>
      {alwaysEnabled ? (
        <span
          role="button"
          tabIndex={0}
          className={className}
          aria-label={label}
          title={label}
          aria-haspopup="menu"
          aria-expanded={!!pos}
          onClick={toggle}
          onKeyDown={(ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            ev.preventDefault();
            toggle(ev);
          }}
        >
          {icons.dots({ width: 16, height: 16 })}
        </span>
      ) : (
        <button
          type="button"
          className={className}
          aria-label={label}
          title={label}
          aria-haspopup="menu"
          aria-expanded={!!pos}
          onClick={toggle}
        >
          {icons.dots({ width: 16, height: 16 })}
        </button>
      )}
      {pos &&
        createPortal(
          <div ref={menu} className={c.menu} role="menu" style={{ top: pos.top, right: pos.right }}>
            {actions.map((a, i) => (
              <Fragment key={a.label}>
                {a.separated && i > 0 && <div className={c.menuSep} role="separator" />}
                <button
                  type="button"
                  role="menuitem"
                  className={a.danger ? `${c.menuItem} ${c.menuDanger}` : c.menuItem}
                  disabled={a.disabled || !a.onClick}
                  title={a.title}
                  onClick={a.onClick && pick(a.onClick)}
                >
                  {a.icon}
                  {a.label}
                </button>
              </Fragment>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** A description row's ⋯ menu: add a line to that description, or remove it with its lines. */
function DescMenu({ onAddLine, onRemove }: { onAddLine: () => void; onRemove?: () => void }) {
  return (
    <DotsMenu
      label="Description actions"
      actions={[
        { label: 'Add Line', icon: fi.plus({}), onClick: onAddLine },
        {
          label: 'Remove Description',
          icon: fi.trash({}),
          onClick: onRemove,
          danger: true,
          title: onRemove ? undefined : 'An invoice needs at least one description',
        },
      ]}
    />
  );
}

/** CDC numbers compare without case, spaces or dashes ("II-125" = "ii 125"), as on the server. */
const cdcKey = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[\s\-–—_]+/g, '');

/** A unit price: at least 2 decimals, up to the 4 it may be typed with. */
const price = (v: string | number) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const money = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Cargo, Pricing & FOB" — one row per invoice; open a row for its line items (prototype layout). */
export function CargoSection({
  shipmentId,
  readOnly = false,
}: {
  shipmentId?: string | undefined;
  /** The shipment is being viewed: item details open read-only. */
  readOnly?: boolean;
}) {
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
  const pkgUnit = useWatch({ control, name: 'quantityUnit' }) || 'PKGS';
  const cargoQuantity = useWatch({ control, name: 'quantity' });
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
  // An import's invoices start open; an export's start folded (it has many more invoices). Kept
  // as the invoices switched from that default, so ones that load after the first render follow
  // it too. A new invoice opens.
  const openByDefault = isImport;
  const [flipped, setFlipped] = useState<Set<number>>(() => new Set());
  const isOpen = (i: number) => openByDefault !== flipped.has(i);
  const [status, setStatus] = useState<{
    text: string;
    warnings: CargoExcelParseResult['warnings'];
    /** The upload was refused: the list shows why. */
    error?: boolean;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggle = (i: number) =>
    setFlipped((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const allOpen = invoices.fields.length > 0 && invoices.fields.every((_, i) => isOpen(i));
  const all = () => new Set(invoices.fields.map((_, i) => i));
  // Opening all: none folded; folding all: every one folded (in terms of the default).
  const expandAll = () => setFlipped(allOpen === openByDefault ? all() : new Set());

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
            clientId,
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
              ctns: l.ctns,
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
      setFlipped(new Set());
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
  const lineCount = (watched ?? []).reduce((n, i) => n + i.lines.length, 0);

  return (
    <>
      <div className="cx-card">
        <div className="cx-card-head">
          <div className="cx-title">
            <span className="cx-title-icon">{fi.dollar({ width: 18, height: 18 })}</span>
            <h3>{isImport ? 'Cargo Invoices & CDC Items' : 'Cargo, Pricing & FOB'}</h3>
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
            {uploading && <span className="cargo-status">Reading…</span>}
            <button
              type="button"
              className="cargo-btn cargo-btn-primary"
              onClick={() => {
                invoices.append(blankInvoice(getValues('invoices.0.invoiceDate') ?? ''));
                setFlipped((s) => {
                  const n = new Set(s);
                  if (openByDefault) n.delete(invoices.fields.length);
                  else n.add(invoices.fields.length);
                  return n;
                });
              }}
            >
              + Add Invoice
            </button>
            {/* The Excel template: download it, fill it in, upload it. Imports have their own
                template, listing the client's CDC master list. */}
            <DotsMenu
              label="Excel template"
              className={`cargo-btn ${c.dotsToolbar}`}
              // Expand All works while the shipment is viewed.
              alwaysEnabled
              actions={[
                // Only + Add Invoice and this menu (the wireframe's toolbar).
                {
                  label: allOpen ? 'Collapse All' : 'Expand All',
                  icon: CHEVRON,
                  onClick: expandAll,
                },
                {
                  label: 'Download Template',
                  separated: true,
                  icon: icons.download({}),
                  disabled: isImport && !clientId,
                  title: isImport && !clientId ? 'Choose the client first' : undefined,
                  onClick: () =>
                    void (
                      isImport
                        ? downloadFile('/shipments/import-cargo-template.xlsx', { clientId })
                        : downloadFile('/shipments/cargo-template.xlsx')
                    ).catch(() =>
                      setStatus({ text: 'The template could not be downloaded.', warnings: [] }),
                    ),
                },
                {
                  label: 'Upload Excel Template',
                  icon: icons.upload({}),
                  disabled: uploading || readOnly || (isImport && !clientId),
                  title: readOnly
                    ? 'Choose Edit in the ⋯ menu first'
                    : isImport && !clientId
                      ? 'Choose the client first'
                      : undefined,
                  onClick: () => fileRef.current?.click(),
                },
              ]}
            />
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
        {/* An older import (e.g. VFL, SAK) has its Cargo Quantity typed on the shipment but no
            Pkgs on its items yet: show that quantity here until the items have their own. */}
        {isImport && toNum(cargoQuantity) > 0 && totals.ctns === 0 && (
          <p className={c.qtyNote}>
            Quantity Pkgs on this shipment:{' '}
            <b>
              {fmtNum(cargoQuantity)} {pkgUnit}
            </b>
            . It was typed before the items had Pkgs; once you enter Pkgs on the items, it follows
            their total.
          </p>
        )}
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
                    open={isOpen(gi)}
                    onToggle={() => toggle(gi)}
                    onRemove={invoices.fields.length > 1 ? () => invoices.remove(gi) : undefined}
                    register={register}
                    onDate={setSharedDate}
                    cdcItems={cdcItems}
                    remainingAfter={remainingAfter}
                    errors={Array.isArray(invErr) ? invErr[gi] : undefined}
                    readOnly={readOnly}
                    pkgUnit={pkgUnit}
                  />
                ) : (
                  <InvoiceCard
                    key={f.id}
                    gi={gi}
                    control={control}
                    open={isOpen(gi)}
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
      {/* Each invoice has its own totals; the shipment's only add up several. Each total sits
          under its own column, like Invoice Total. */}
      {invoices.fields.length > 1 && (
        <div className={`${c.tableWrap} ${c.shipTotal}`}>
          <table className={`${c.table} ${c.impTable}${isImport ? '' : ` ${c.expTable}`}`}>
            {isImport ? <ImpCols /> : <ExpCols />}
            <tfoot>
              {isImport ? (
                <tr>
                  <td>
                    <span className={c.sigma} aria-hidden="true">
                      Σ
                    </span>
                  </td>
                  <td>
                    Shipment Total
                    <span className={c.shipCount}>
                      {invoices.fields.length} invoices · {fmtNum(lineCount)} items
                    </span>
                  </td>
                  <td>
                    <span className={c.shipLbl}>Pkgs</span>
                    {fmtNum(totals.ctns)}
                  </td>
                  <td>
                    <span className={c.shipLbl}>Quantity</span>
                    {fmtNum(totals.pcs, 2)}
                  </td>
                  <td />
                  <td>
                    <span className={c.shipLbl}>Net Weight (KGS)</span>
                    {fmtNum(totals.nw, 2)}
                  </td>
                  <td>
                    <span className={c.shipLbl}>Gross Weight (KGS)</span>
                    {fmtNum(totals.gw, 2)}
                  </td>
                  <td />
                  <td className={c.footAmount}>
                    <span className={c.shipLbl}>Amount (USD)</span>
                    {money(totals.fob)}
                  </td>
                  <td />
                </tr>
              ) : (
                <tr>
                  <td>
                    <span className={c.shipHead}>
                      <span className={c.sigma} aria-hidden="true">
                        Σ
                      </span>
                      <span>
                        Shipment Total
                        <span className={c.shipCount}>
                          {invoices.fields.length} invoices · {fmtNum(lineCount)} lines
                        </span>
                      </span>
                    </span>
                  </td>
                  <td />
                  <td>
                    <span className={c.shipLbl}>PCS</span>
                    {fmtNum(totals.pcs)}
                  </td>
                  <td>
                    <span className={c.shipLbl}>CTNS</span>
                    {fmtNum(totals.ctns)}
                  </td>
                  <td>
                    <span className={c.shipLbl}>Net Wt (KGS)</span>
                    {fmtNum(totals.nw, 2)}
                  </td>
                  <td>
                    <span className={c.shipLbl}>Gross Wt (KGS)</span>
                    {fmtNum(totals.gw, 2)}
                  </td>
                  <td>
                    <span className={c.shipLbl}>CBM</span>
                    {fmtNum(totals.cbm, 3)}
                  </td>
                  <td />
                  <td className={c.footAmount}>
                    <span className={c.shipLbl}>Total FOB (USD)</span>
                    {money(totals.fob)}
                  </td>
                  <td />
                </tr>
              )}
            </tfoot>
          </table>
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

/** An import invoice table's column widths; the Shipment Total row shares them. */
function ImpCols() {
  return (
    <colgroup>
      {[4, 17, 7, 9, 8, 12, 15, 11, 11, 6].map((w, i) => (
        <col key={i} style={{ width: `${w}%` }} />
      ))}
    </colgroup>
  );
}

/** An export invoice table's column widths; the Shipment Total row shares them. */
function ExpCols() {
  return (
    <colgroup>
      {[13, 15, 9, 8, 11, 12, 8, 10, 9, 5].map((w, i) => (
        <col key={i} style={{ width: `${w}%` }} />
      ))}
    </colgroup>
  );
}

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
  // A new line at the end of one description's group (the ⋯ menu on its row).
  const addLineTo = (g: { start: number; idx: number[] }) =>
    lines.insert(g.idx.at(-1)! + 1, blank(descOf(g)));
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
  // A line cell: a borderless box inside the table that shows its border on hover / focus.
  const cell = (
    li: number,
    field:
      | 'poNo'
      | 'styleNo'
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
    <td>
      {num ? (
        <NumberInput
          decimals={field === 'fobUnitPrice' ? 4 : 3}
          className={`${c.cell} ${c.num}`}
          placeholder={ph}
          aria-label={label}
          {...register(`invoices.${gi}.lines.${li}.${field}`)}
          aria-invalid={!!lineErr(li, field)}
          title={lineErr(li, field)}
        />
      ) : (
        <input
          type="text"
          className={c.cell}
          placeholder={ph}
          aria-label={label}
          {...register(`invoices.${gi}.lines.${li}.${field}`)}
          aria-invalid={!!lineErr(li, field)}
          title={lineErr(li, field)}
        />
      )}
    </td>
  );

  const renderLine = (li: number) => {
    const l = watchedLines?.[li];
    const total = l && l.pcs && l.fobUnitPrice ? toNum(l.pcs) * toNum(l.fobUnitPrice) : null;
    return (
      <tr key={lines.fields[li]!.id}>
        {cell(li, 'poNo', 'PO No.', 'PO No.')}
        {cell(li, 'styleNo', 'Style', 'Style No.')}
        {cell(li, 'pcs', 'PCS', '0', true)}
        {cell(li, 'ctns', 'CTNS', '0', true)}
        {cell(li, 'netWeightKg', 'Net Wt (kg)', '0.00', true)}
        {cell(li, 'grossWeightKg', 'Gross Wt (kg)', '0.00', true)}
        {cell(li, 'cbm', 'CBM', '0.00', true)}
        {cell(li, 'fobUnitPrice', 'Unit price (USD)', '0.00', true)}
        <td className={c.lineTotal}>{total !== null ? money(total) : '—'}</td>
        <td className={c.ctr}>
          {lines.fields.length > 1 && (
            <button
              type="button"
              className={c.iconBtn}
              title="Remove line"
              aria-label="Remove line"
              onClick={() => removeLine(li)}
            >
              {fi.trash({})}
            </button>
          )}
        </td>
      </tr>
    );
  };

  const count = lines.fields.length;
  return (
    // Laid out like an import invoice: a head bar with the typed-once fields and the CTNS / PCS
    // pills, then the line table with its Invoice Total row (no box, only lines between invoices).
    <div className={`cargo-inv ${c.inv} ${c.impInv}${open ? ' open' : ''}`}>
      <div
        className={c.impHead}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        title={open ? 'Hide line items' : 'Show line items'}
        onClick={(ev) => !(ev.target as HTMLElement).closest('button, label, input') && onToggle()}
        onKeyDown={(ev) => {
          if (ev.target !== ev.currentTarget || (ev.key !== 'Enter' && ev.key !== ' ')) return;
          ev.preventDefault();
          onToggle();
        }}
      >
        <label className={c.impHeadField}>
          <span>Invoice No.</span>
          <span className={c.impHeadBox}>
            <span className={c.impHeadAdorn}>{fi.file({})}</span>
            <input
              type="text"
              className={`${c.impHeadInput} ${c.strong}`}
              placeholder="e.g. JRA26060"
              {...register(`invoices.${gi}.invoiceNo`)}
              aria-invalid={!!e?.invoiceNo}
              title={e?.invoiceNo?.message}
            />
          </span>
        </label>
        <label className={c.impHeadField}>
          <span>Invoice Date</span>
          <input
            type="date"
            className={c.impHeadInput}
            {...register(`invoices.${gi}.invoiceDate`, {
              onChange: (ev: React.ChangeEvent<HTMLInputElement>) => onDate(ev.target.value),
            })}
          />
        </label>
        <label className={c.impHeadField}>
          <span>HTS Code</span>
          {/* One invoice = one HTS code: shown once here and written to every line. */}
          <input
            type="text"
            className={c.impHeadInput}
            placeholder={htsCodes.length > 1 ? 'Choose one' : 'e.g. 6104.69'}
            value={htsCodes.length === 1 ? htsCodes[0] : ''}
            onChange={(ev) => setHts(ev.target.value)}
            aria-invalid={htsCodes.length > 1 || !!e?.htsCode}
            title={e?.htsCode?.message}
          />
        </label>
        <span className={c.tags}>
          {/* The CTNS and PCS stay in sight while the invoice is folded; a zero is left out. */}
          {lineSum.ctns > 0 && <span className={c.tag}>{fmtNum(lineSum.ctns)} CTNS</span>}
          {lineSum.pcs > 0 && (
            <span className={`${c.tag} ${c.tagAmount}`}>{fmtNum(lineSum.pcs)} PCS</span>
          )}
        </span>
        {onRemove && (
          <button
            type="button"
            className={c.iconBtn}
            aria-label={`Remove invoice ${gi + 1}`}
            title="Remove invoice"
            onClick={onRemove}
          >
            {fi.trash({})}
          </button>
        )}
        <span className={c.toggle} aria-hidden="true">
          {CHEVRON}
        </span>
      </div>
      {e?.invoiceNo?.message && (
        <div className={c.err}>
          <FieldError message={e.invoiceNo.message} />
        </div>
      )}
      {htsCodes.length > 1 && (
        <div className={c.err}>
          <FieldError
            message={`The lines have different HTS codes (${htsCodes.join(', ')}). One invoice uses one HTS code — enter it above.`}
          />
        </div>
      )}

      {/* Packaging / line items: one table, a description row above each group of lines. */}
      <div className="cargo-inv-details">
        <div className="cargo-inv-details-inner">
          <div className={c.impBody}>
            <div className={c.tableWrap}>
              <table className={`${c.table} ${c.impTable} ${c.expTable}`}>
                <ExpCols />
                <thead>
                  <tr>
                    <th>PO No.</th>
                    <th>Style</th>
                    <th>PCS</th>
                    <th>CTNS</th>
                    <th>Net Wt (KGS)</th>
                    <th>Gross Wt (KGS)</th>
                    <th>CBM</th>
                    <th>Unit Price (USD)</th>
                    <th>Line Total (USD)</th>
                    <th className={c.ctr}>Action</th>
                  </tr>
                </thead>
                {groups.map((g) => {
                  const id = lines.fields[g.start]!.id;
                  return (
                    <tbody key={id}>
                      <tr className={c.descRow}>
                        <td colSpan={10}>
                          <div className={c.descInner}>
                            {/* No label: the placeholder names the box. */}
                            <input
                              type="text"
                              className={c.cell}
                              placeholder="Description, e.g. Mens woven shorts 100 nylon"
                              aria-label="Description"
                              value={descOf(g)}
                              onChange={(ev) => setDesc(g, ev.target.value)}
                              autoFocus={focusId === id}
                            />
                            <DescMenu
                              onAddLine={() => addLineTo(g)}
                              onRemove={groups.length > 1 ? () => removeGroup(g) : undefined}
                            />
                          </div>
                        </td>
                      </tr>
                      {g.idx.map(renderLine)}
                    </tbody>
                  );
                })}
                {/* The invoice's totals, each under its own column. */}
                <tfoot>
                  <tr>
                    <td>
                      Invoice Total
                      <span className={c.footCount}>
                        {count} {count === 1 ? 'line' : 'lines'}
                      </span>
                    </td>
                    <td />
                    <td>{fmtNum(lineSum.pcs)}</td>
                    <td>{fmtNum(lineSum.ctns)}</td>
                    <td>{fmtNum(lineSum.nw, 2)}</td>
                    <td>{fmtNum(lineSum.gw, 2)}</td>
                    <td>{fmtNum(lineSum.cbm, 3)}</td>
                    <td />
                    <td className={c.footAmount}>{money(lineSum.fob)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className={c.foot}>
              {/* New line under the latest description. */}
              <button type="button" className={c.addBtn} onClick={addLine}>
                {fi.plus({})}
                Add Line
              </button>
              {/* New description row with its first line. */}
              <button type="button" className={c.addBtn} onClick={addDescription}>
                {fi.plus({})}
                Add Description
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "II. Raw Material" → "II. RAW MATERIAL", as the import schedule writes it. */
const materialOf = (it: CutStockRow) => CUT_STOCK_CATEGORY_LABEL[it.category].toUpperCase();

type LineErrs = Record<string, { message?: string } | undefined> | undefined;

/**
 * An import invoice: a bar with its invoice no. and date (a click opens or closes its items),
 * then one read-only row per item (No. · Item · Pkgs · Quantity · NW · GW · Unit Price ·
 * Amount · ⋮). An item is read, changed or added in its View Details dialog; a click on the row
 * opens it too.
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
  readOnly,
  pkgUnit,
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
  readOnly: boolean;
  /** The shipment's package unit (CTNS, PKGS…), shown in View Details after Quantity Pkgs. */
  pkgUnit: string;
}) {
  const { setValue, getValues } = useFormContext<FormValues>();
  const lines = useFieldArray({ control, name: `invoices.${gi}.lines` });
  const watchedLines = useWatch({ control, name: `invoices.${gi}.lines` });
  const invoiceNo = useWatch({ control, name: `invoices.${gi}.invoiceNo` });
  const e = errors as InvErrors;
  const lineErrs = (li: number): LineErrs =>
    e?.lines && !('message' in e.lines) ? (e.lines as Record<number, LineErrs>)[li] : undefined;
  /** The item open in View Details: its row, or 'new' for Add Item (saved as a new row). */
  const [details, setDetails] = useState<number | 'new' | null>(null);

  const itemOf = (cdcNo: string | null | undefined) =>
    cdcNo ? cdcItems.find((x) => cdcKey(x.declareRef) === cdcKey(cdcNo)) : undefined;

  const saveLine = (at: number | 'new', v: LineValues) => {
    if (at === 'new') return lines.append(v);
    const path = `invoices.${gi}.lines.${at}` as const;
    setValue(path, { ...getValues(path), ...v }, { shouldDirty: true, shouldValidate: !!e });
  };

  const count = lines.fields.length;
  const sumOf = (k: 'ctns' | 'pcs' | 'netWeightKg' | 'grossWeightKg') =>
    (watchedLines ?? []).reduce((n, l) => n + toNum(l[k]), 0);
  const invoiceAmount = (watchedLines ?? []).reduce(
    (n, l) => n + toNum(l.pcs) * toNum(l.fobUnitPrice),
    0,
  );
  // The items' CDC unit for the Quantity pill; items in different units show their units joined.
  const qtyUnit = [
    ...new Set((watchedLines ?? []).map((l) => l.unit?.trim()).filter(Boolean)),
  ].join(' / ');
  const openLine = typeof details === 'number' ? watchedLines?.[details] : undefined;
  const ref = invoiceNo?.trim() ? ` · ${invoiceNo.trim()}` : '';
  const editFirst = 'Choose Edit in the ⋯ menu first';

  return (
    <div className={`cargo-inv ${c.inv} ${c.impInv}${open ? ' open' : ''}`}>
      <div
        className={c.impHead}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        title={open ? 'Hide items' : 'Show items'}
        onClick={(ev) => !(ev.target as HTMLElement).closest('button, label, input') && onToggle()}
        onKeyDown={(ev) => {
          if (ev.target !== ev.currentTarget || (ev.key !== 'Enter' && ev.key !== ' ')) return;
          ev.preventDefault();
          onToggle();
        }}
      >
        <label className={c.impHeadField}>
          <span>Invoice No.</span>
          {/* The file icon sits inside the box, split from the number by a rule. */}
          <span className={c.impHeadBox}>
            <span className={c.impHeadAdorn}>{fi.file({})}</span>
            <input
              type="text"
              className={`${c.impHeadInput} ${c.strong}`}
              placeholder="e.g. CNQ26044"
              {...register(`invoices.${gi}.invoiceNo`)}
              aria-invalid={!!e?.invoiceNo}
              title={e?.invoiceNo?.message}
            />
          </span>
        </label>
        <label className={c.impHeadField}>
          <span>Invoice Date</span>
          <input
            type="date"
            className={c.impHeadInput}
            {...register(`invoices.${gi}.invoiceDate`, {
              onChange: (ev: React.ChangeEvent<HTMLInputElement>) => onDate(ev.target.value),
            })}
          />
        </label>
        <span className={c.tags}>
          {/* The Pkgs and Quantity stay in sight while the invoice is folded; a zero is left out. */}
          {sumOf('ctns') > 0 && (
            <span className={c.tag}>
              {fmtNum(sumOf('ctns'))} {pkgUnit}
            </span>
          )}
          {sumOf('pcs') > 0 && (
            <span className={`${c.tag} ${c.tagAmount}`}>
              {fmtNum(sumOf('pcs'), 2)}
              {qtyUnit && ` ${qtyUnit}`}
            </span>
          )}
        </span>
        {onRemove && (
          <button
            type="button"
            className={c.iconBtn}
            aria-label={`Remove invoice ${gi + 1}`}
            title="Remove invoice"
            onClick={onRemove}
          >
            {fi.trash({})}
          </button>
        )}
        <span className={c.toggle} aria-hidden="true">
          {CHEVRON}
        </span>
      </div>
      {e?.invoiceNo?.message && (
        <div className={c.err}>
          <FieldError message={e.invoiceNo.message} />
        </div>
      )}

      <div className="cargo-inv-details">
        <div className="cargo-inv-details-inner">
          <div className={c.impBody}>
            {e?.lines && 'message' in e.lines && typeof e.lines.message === 'string' && (
              <FieldError message={e.lines.message} />
            )}
            <div className={c.tableWrap}>
              <table className={`${c.table} ${c.impTable}`}>
                <ImpCols />
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Item</th>
                    <th className={c.r}>Pkgs</th>
                    <th className={c.r}>Quantity</th>
                    <th>CDC Unit</th>
                    <th className={c.r}>Net Weight (KGS)</th>
                    <th className={c.r}>Gross Weight (KGS)</th>
                    <th className={c.r}>Unit Price (USD)</th>
                    <th className={c.r}>Amount (USD)</th>
                    <th className={c.ctr}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.fields.map((f, li) => {
                    const l = watchedLines?.[li];
                    const amount =
                      l && l.pcs && l.fobUnitPrice ? toNum(l.pcs) * toNum(l.fobUnitPrice) : null;
                    const it = itemOf(l?.cdcNo);
                    const after = it ? remainingAfter.get(it.id) : undefined;
                    const over = after !== undefined && after < -1e-9;
                    const errs = lineErrs(li);
                    const errText = errs
                      ? Object.values(errs)
                          .map((x) => x?.message)
                          .filter(Boolean)
                          .join(' · ')
                      : '';
                    const empty = !l?.cdcNo && !l?.description;
                    return (
                      <tr
                        key={f.id}
                        className={c.impRow}
                        data-error={!!errText || (over && !l?.overrideReason?.trim())}
                        title={errText || 'View details'}
                        onClick={(ev) =>
                          !(ev.target as HTMLElement).closest('button, [role="button"]') &&
                          setDetails(li)
                        }
                      >
                        <td className={c.muted}>{li + 1}</td>
                        <td>
                          <span className={c.itemName}>
                            {empty ? (
                              <span className={c.muted}>
                                {readOnly ? '—' : 'Choose an item in View Details'}
                              </span>
                            ) : (
                              l?.description || l?.cdcNo
                            )}
                          </span>
                          {(over || errText) && (
                            <span className={c.balance} data-over="true">
                              {over ? 'Over the CDC balance' : errText}
                            </span>
                          )}
                        </td>
                        <td className={c.r}>{withUnit(l?.ctns, '')}</td>
                        <td className={c.r}>{withUnit(l?.pcs, '')}</td>
                        <td>{l?.unit || '—'}</td>
                        <td className={c.r}>{withUnit(l?.netWeightKg, '', 2)}</td>
                        <td className={c.r}>{withUnit(l?.grossWeightKg, '', 2)}</td>
                        <td className={c.r}>{l?.fobUnitPrice ? price(l.fobUnitPrice) : '—'}</td>
                        <td className={c.lineTotal}>{amount !== null ? money(amount) : '—'}</td>
                        <td className={c.ctr}>
                          <DotsMenu
                            label={`Item ${li + 1} actions`}
                            alwaysEnabled
                            actions={[
                              {
                                label: 'View Details',
                                icon: icons.eye({}),
                                onClick: () => setDetails(li),
                              },
                              {
                                label: 'Add Item',
                                icon: fi.plus({}),
                                onClick: readOnly ? undefined : () => setDetails('new'),
                                title: readOnly ? editFirst : undefined,
                              },
                              {
                                label: 'Delete Item',
                                icon: fi.trash({}),
                                danger: true,
                                separated: true,
                                onClick: readOnly || count < 2 ? undefined : () => lines.remove(li),
                                title: readOnly
                                  ? editFirst
                                  : count < 2
                                    ? 'An invoice needs at least one item'
                                    : undefined,
                              },
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* The invoice's totals, each under its own column. */}
                <tfoot>
                  <tr className={c.impFoot}>
                    <td />
                    <td>
                      Invoice Total
                      <span className={c.footCount}>
                        {count} {count === 1 ? 'item' : 'items'}
                      </span>
                    </td>
                    <td>{fmtNum(sumOf('ctns'))}</td>
                    <td>{fmtNum(sumOf('pcs'), 2)}</td>
                    <td />
                    <td>{fmtNum(sumOf('netWeightKg'), 2)}</td>
                    <td>{fmtNum(sumOf('grossWeightKg'), 2)}</td>
                    <td />
                    <td className={c.footAmount}>{money(invoiceAmount)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>

      {details !== null && (details === 'new' || openLine) && (
        <ItemDetailsDialog
          title={details === 'new' ? `New Item${ref}` : `Item ${details + 1}${ref}`}
          line={openLine ?? blankLine()}
          readOnly={readOnly}
          cdcItems={cdcItems}
          // The line's own quantity is already off the balance: put it back before the draft's.
          balanceAfter={(draft) => {
            const it = itemOf(draft.cdcNo);
            if (!it) return undefined;
            const base = remainingAfter.get(it.id) ?? Number(it.balance);
            const own = openLine && itemOf(openLine.cdcNo)?.id === it.id ? toNum(openLine.pcs) : 0;
            return { after: base + own - toNum(draft.pcs), unit: it.unit ?? '' };
          }}
          errs={typeof details === 'number' ? lineErrs(details) : undefined}
          pkgUnit={pkgUnit}
          onSave={(v) => {
            saveLine(details, v);
            setDetails(null);
          }}
          onClose={() => setDetails(null)}
        />
      )}
    </div>
  );
}

/** "850" + "KGS" → "850 KGS"; nothing typed → "—". */
function withUnit(v: string | number | null | undefined, unit: string, decimals = 3) {
  if (v === null || v === undefined || v === '') return '—';
  return (
    <>
      {fmtNum(v, decimals)}
      {unit && <span className={c.unit}> {unit}</span>}
    </>
  );
}

/**
 * An import item's View Details: General (item, material, CDC no., CDC unit), Quantity & Weight,
 * and Price (unit price, total, and a remark with the CDC balance after saving). It can be
 * changed while the shipment is being edited (Edit in the page's ⋯ menu), and is read-only
 * otherwise. Save puts the changes on the invoice; Close drops them.
 */
function ItemDetailsDialog({
  title,
  line,
  readOnly,
  cdcItems,
  balanceAfter,
  errs,
  pkgUnit,
  onSave,
  onClose,
}: {
  title: string;
  line: LineValues;
  readOnly: boolean;
  cdcItems: CutStockRow[];
  balanceAfter: (draft: LineValues) => { after: number; unit: string } | undefined;
  errs: LineErrs;
  pkgUnit: string;
  onSave: (v: LineValues) => void;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const [draft, setDraft] = useState<LineValues>(() => ({ ...blankLine(), ...line }));
  const editing = !readOnly;
  const set = (patch: Partial<LineValues>) => setDraft((d) => ({ ...d, ...patch }));
  const known = cdcItems.find((x) => cdcKey(x.declareRef) === cdcKey(draft.cdcNo));
  // The CDC no., material and unit come from the chosen item, and its price if none is typed.
  const pick = (cdcNo: string) => {
    const it = cdcItems.find((x) => x.declareRef === cdcNo);
    set({
      cdcNo: it?.declareRef ?? cdcNo,
      description: it?.name ?? (cdcNo && cdcNo === draft.cdcNo ? draft.description : ''),
      material: it ? materialOf(it) : '',
      unit: it?.unit ?? '',
      ...(it && !toNum(draft.fobUnitPrice) ? { fobUnitPrice: String(Number(it.unitPrice)) } : {}),
    });
  };
  const amount =
    draft.pcs && draft.fobUnitPrice ? toNum(draft.pcs) * toNum(draft.fobUnitPrice) : null;
  const bal = balanceAfter(draft);
  const over = !!bal && bal.after < -1e-9;
  const err = (k: keyof LineValues) => errs?.[k]?.message;
  const ro = !editing;

  const num = (
    k: 'ctns' | 'pcs' | 'netWeightKg' | 'grossWeightKg' | 'fobUnitPrice',
    label: string,
    suffix: string,
  ) => (
    <div className="form-field-group">
      <label htmlFor={`d-${k}`}>{label}</label>
      <div className={c.dlgAffix}>
        <NumberInput
          id={`d-${k}`}
          decimals={k === 'fobUnitPrice' ? 4 : 3}
          className="form-field-box"
          placeholder="0"
          value={String(draft[k] ?? '')}
          onChange={(ev) => set({ [k]: ev.target.value })}
          readOnly={ro}
          aria-invalid={!!err(k)}
        />
        {suffix && <span>{suffix}</span>}
      </div>
      <FieldError message={err(k)} />
    </div>
  );
  /** Filled in from the chosen item (or worked out): shown, never typed. */
  const shown = (label: string, value: string, id: string) => (
    <div className="form-field-group">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={`form-field-box ${c.dlgAuto}`}
        value={value}
        placeholder="—"
        readOnly
        tabIndex={-1}
      />
    </div>
  );

  return (
    <Modal title={title} onClose={onClose} width={980} className="caps-values caps-labels">
      <div className={c.dlg} data-editing={editing}>
        <section className={c.dlgCol}>
          <h4 className={c.dlgHead}>
            <span className="cx-title-icon">{fi.file({ width: 16, height: 16 })}</span>
            General
          </h4>
          <div className="form-field-group">
            <label htmlFor="d-item">Item</label>
            <select
              id="d-item"
              className="form-select-box"
              value={known?.declareRef ?? draft.cdcNo ?? ''}
              onChange={(ev) => pick(ev.target.value)}
              disabled={ro}
              aria-invalid={!!err('cdcNo')}
            >
              <option value="">
                {cdcItems.length ? 'Choose item…' : 'No CDC master list items'}
              </option>
              {/* A saved item no longer on the list stays shown as it was. */}
              {draft.cdcNo && !known && (
                <option value={draft.cdcNo}>{draft.description || draft.cdcNo}</option>
              )}
              {CUT_STOCK_CATEGORIES.map((cat) => {
                const items = cdcItems.filter((x) => x.category === cat);
                return items.length ? (
                  <optgroup key={cat} label={CUT_STOCK_CATEGORY_LABEL[cat]}>
                    {items.map((x) => (
                      <option key={x.id} value={x.declareRef}>
                        {x.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
            <FieldError message={err('cdcNo')} />
          </div>
          {shown('Material', draft.material ?? '', 'd-material')}
          {shown('CDC No.', draft.cdcNo ?? '', 'd-cdcNo')}
          {shown('CDC Unit', draft.unit ?? '', 'd-unit')}
        </section>

        <section className={c.dlgCol}>
          <h4 className={c.dlgHead}>
            <span className="cx-title-icon">{fi.box({ width: 16, height: 16 })}</span>
            Quantity &amp; Weight
          </h4>
          {num('ctns', 'Quantity Pkgs', pkgUnit)}
          {num('pcs', 'Quantity', draft.unit ?? '')}
          {num('netWeightKg', 'Net Weight', 'KGS')}
          {num('grossWeightKg', 'Gross Weight', 'KGS')}
        </section>

        <section className={c.dlgCol}>
          <h4 className={c.dlgHead}>
            <span className="cx-title-icon">{fi.dollar({ width: 16, height: 16 })}</span>
            Price
          </h4>
          {num('fobUnitPrice', 'Unit Price', 'USD')}
          {shown('Total Amount', amount !== null ? `${money(amount)} USD` : '', 'd-amount')}
          <div className="form-field-group">
            <label htmlFor="d-reason">Remark</label>
            <div className={c.dlgRemark} data-over={over}>
              {bal ? (
                <b>
                  Balance after saving: {fmtNum(bal.after)} {bal.unit}
                </b>
              ) : (
                <span>Choose an item to see its CDC balance.</span>
              )}
              {over &&
                (can('cutstock:override') ? (
                  <textarea
                    id="d-reason"
                    className={`form-field-box ${c.dlgReason}`}
                    rows={2}
                    placeholder="Reason for importing over the balance (required)"
                    value={draft.overrideReason ?? ''}
                    onChange={(ev) => set({ overrideReason: ev.target.value })}
                    readOnly={ro}
                  />
                ) : (
                  <span>More than the remaining balance. A Manager must approve this item.</span>
                ))}
            </div>
          </div>
        </section>
      </div>

      {/* The × at the top closes it. Viewing a shipment: no buttons here (choose Edit in the
          page's ⋯ menu to change items). */}
      {editing && (
        <div className={c.dlgActions}>
          <button type="button" className="new-shipment-btn" onClick={() => onSave(draft)}>
            Save
          </button>
        </div>
      )}
    </Modal>
  );
}
