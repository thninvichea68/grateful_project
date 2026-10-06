import { useMemo } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import {
  CUT_STOCK_CATEGORY_LABEL,
  CUT_STOCK_CATEGORIES,
  type LookupsResponse,
  type ShipmentDetail,
} from '@gs/shared';
import { useAuth } from '../../auth/AuthProvider';
import { useCutStock } from '../../features/hooks';
import { fmtNum } from '../../lib/format';
import { FieldError } from '../../components/ui';
import { blankDeclaration, toNum, type FormValues } from './formModel';

/** Customs declarations; on imports each one carries CDC lines that draw down the client's master list. */
export function DeclarationsSection({
  ports,
  original,
}: {
  ports: LookupsResponse['ports'];
  original?: ShipmentDetail | undefined;
}) {
  const {
    control,
    register,
    getValues,
    formState: { errors },
  } = useFormContext<FormValues>();
  const decls = useFieldArray({ control, name: 'declarations' });
  const direction = useWatch({ control, name: 'direction' });
  const clientId = useWatch({ control, name: 'clientId' });
  const watched = useWatch({ control, name: 'declarations' });
  const isImport = direction === 'IMPORT';
  const cut = useCutStock({ clientId, pageSize: 500, sort: 'lineNo' }, isImport && !!clientId);

  // Quantities this shipment already holds come back when it is saved (the server replaces them).
  const originalQty = useMemo(() => {
    const m = new Map<string, number>();
    original?.declarations.forEach((d) =>
      d.cdcLines.forEach((l) =>
        m.set(l.cutStockItemId, (m.get(l.cutStockItemId) ?? 0) + toNum(l.qty)),
      ),
    );
    return m;
  }, [original]);
  const items = useMemo(() => cut.data?.data ?? [], [cut.data]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  // Balance remaining after every line in the form, per item.
  const remainingAfter = useMemo(() => {
    const used = new Map<string, number>();
    watched?.forEach((d) =>
      d.cdcLines?.forEach(
        (l) =>
          l.cutStockItemId &&
          used.set(l.cutStockItemId, (used.get(l.cutStockItemId) ?? 0) + toNum(l.qty)),
      ),
    );
    const out = new Map<string, number>();
    used.forEach((q, id) => {
      const it = itemById.get(id);
      if (it) out.set(id, Number(it.balance) + (originalQty.get(id) ?? 0) - q);
    });
    return out;
  }, [watched, itemById, originalQty]);

  const declErr = errors.declarations;
  return (
    <div className="cx-card">
      <div className="cx-card-head">
        <div className="cx-title">
          <div>
            <h3>Customs Declarations</h3>
            <p>
              {isImport
                ? 'Declaration numbers, and the CDC master-list items each import declares'
                : 'Export declaration numbers and dates'}
            </p>
          </div>
        </div>
        <div className="cargo-actions">
          <button
            type="button"
            className="cargo-btn cargo-btn-primary"
            onClick={() => decls.append(blankDeclaration(getValues('clearancePortId') ?? ''))}
          >
            + Add Declaration
          </button>
        </div>
      </div>
      {typeof declErr?.message === 'string' && <FieldError message={declErr.message} />}
      {!decls.fields.length && (
        <p className="create-header-desc">
          No declaration yet. Add one when customs has issued the declaration number.
        </p>
      )}
      {decls.fields.map((f, di) => {
        const e = Array.isArray(declErr)
          ? (declErr[di] as Record<string, { message?: string }> | undefined)
          : undefined;
        const ledger = original?.declarations.find(
          (d) => d.id === watched?.[di]?.id,
        )?.hasLedgerEntry;
        return (
          <div
            key={f.id}
            style={{
              borderTop: di ? '1px solid var(--border-subtle)' : undefined,
              paddingTop: di ? 16 : 0,
              marginTop: di ? 16 : 0,
            }}
          >
            <input type="hidden" {...register(`declarations.${di}.id`)} />
            <div className="form-fields-grid">
              <div className="form-field-group">
                <label htmlFor={`d-${di}-no`}>Declare No.</label>
                <input
                  id={`d-${di}-no`}
                  className="form-field-box"
                  placeholder={isImport ? 'e.g. I 122050' : 'e.g. E 41001'}
                  {...register(`declarations.${di}.declareNo`)}
                  aria-invalid={!!e?.declareNo}
                />
                <FieldError message={e?.declareNo?.message} />
              </div>
              <div className="form-field-group">
                <label htmlFor={`d-${di}-date`}>Declare Date</label>
                <input
                  id={`d-${di}-date`}
                  type="date"
                  className="form-field-box"
                  {...register(`declarations.${di}.declareDate`)}
                  aria-invalid={!!e?.declareDate}
                />
                <FieldError message={e?.declareDate?.message} />
              </div>
              <div className="form-field-group">
                <label htmlFor={`d-${di}-port`}>Customs Port</label>
                <select
                  id={`d-${di}-port`}
                  className="form-select-box"
                  {...register(`declarations.${di}.portId`)}
                >
                  <option value="">Port</option>
                  {ports.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field-group" style={{ justifyContent: 'flex-end' }}>
                {ledger ? (
                  <span className="create-header-desc">
                    Has a ledger entry in Accounting, so it can't be removed here.
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn-delete-shipment"
                    onClick={() => decls.remove(di)}
                  >
                    Remove declaration
                  </button>
                )}
              </div>
            </div>
            {isImport && (
              <CdcLines
                di={di}
                items={items}
                loading={cut.isLoading}
                remainingAfter={remainingAfter}
                itemById={itemById}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CdcLines({
  di,
  items,
  loading,
  remainingAfter,
  itemById,
}: {
  di: number;
  items: NonNullable<ReturnType<typeof useCutStock>['data']>['data'];
  loading: boolean;
  remainingAfter: Map<string, number>;
  itemById: Map<string, (typeof items)[number]>;
}) {
  const {
    control,
    register,
    setValue,
    formState: { errors },
  } = useFormContext<FormValues>();
  const { can } = useAuth();
  const lines = useFieldArray({ control, name: `declarations.${di}.cdcLines` });
  const watched = useWatch({ control, name: `declarations.${di}.cdcLines` });
  const lineErrors = (
    errors.declarations as unknown as
      | Record<number, { cdcLines?: Record<number, Record<string, { message?: string }>> }>
      | undefined
  )?.[di]?.cdcLines;

  return (
    <div style={{ marginTop: 14 }}>
      <div className="form-section-title">Item &amp; Costing (CDC)</div>
      <p style={{ margin: '-8px 0 14px', fontSize: 11.5, color: 'var(--text-tertiary)' }}>
        Pick items from this client’s CDC master list. Each declared quantity reduces the item’s
        balance.
      </p>
      {!loading && !items.length && (
        <p className="create-header-desc">
          This client has no CDC master list yet. Import one on the Cut Stock page.
        </p>
      )}
      <div className="cdc-lines-wrap">
        <table className="cdc-lines-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>CDC No.</th>
              <th>Quantity</th>
              <th>CDC Unit</th>
              <th>Unit Price</th>
              <th>Total Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.fields.map((f, li) => {
              const w = watched?.[li];
              const it = w?.cutStockItemId ? itemById.get(w.cutStockItemId) : undefined;
              const after = w?.cutStockItemId ? remainingAfter.get(w.cutStockItemId) : undefined;
              const over = after !== undefined && after < -1e-9;
              const err = lineErrors?.[li];
              return (
                <tr key={f.id}>
                  <td>
                    <select
                      className="form-field-box"
                      {...register(`declarations.${di}.cdcLines.${li}.cutStockItemId`, {
                        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                          const picked = itemById.get(e.target.value);
                          if (picked && !w?.unitPrice)
                            setValue(
                              `declarations.${di}.cdcLines.${li}.unitPrice`,
                              String(Number(picked.unitPrice)),
                            );
                        },
                      })}
                      aria-invalid={!!err?.cutStockItemId}
                    >
                      <option value="">Choose item…</option>
                      {CUT_STOCK_CATEGORIES.map((cat) => (
                        <optgroup key={cat} label={CUT_STOCK_CATEGORY_LABEL[cat]}>
                          {items
                            .filter((i) => i.category === cat)
                            .map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} (bal. {fmtNum(i.balance)} {i.unit})
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                    {after !== undefined && (
                      <span
                        style={{
                          display: 'block',
                          marginTop: 4,
                          fontSize: 11,
                          fontWeight: 700,
                          color: over ? 'var(--status-exception-fg)' : 'var(--text-tertiary)',
                        }}
                      >
                        Balance after saving: {fmtNum(after)} {it?.unit}
                      </span>
                    )}
                    {over &&
                      (can('cutstock:override') ? (
                        <input
                          className="form-field-box"
                          style={{ marginTop: 6 }}
                          placeholder="Reason for importing over the balance (required)"
                          {...register(`declarations.${di}.cdcLines.${li}.overrideReason`)}
                        />
                      ) : (
                        <FieldError message="More than the remaining balance. A Manager must approve this line." />
                      ))}
                    <FieldError message={err?.cutStockItemId?.message} />
                  </td>
                  <td>
                    <input
                      className="form-field-box"
                      readOnly
                      value={it?.declareRef ?? ''}
                      placeholder="CDC No."
                      tabIndex={-1}
                    />
                  </td>
                  <td>
                    <input
                      className="form-field-box"
                      inputMode="decimal"
                      placeholder="Quantity"
                      {...register(`declarations.${di}.cdcLines.${li}.qty`)}
                      aria-invalid={!!err?.qty}
                    />
                    <FieldError message={err?.qty?.message} />
                  </td>
                  <td>
                    <input
                      className="form-field-box"
                      readOnly
                      value={it?.unit ?? ''}
                      placeholder="CDC Unit"
                      tabIndex={-1}
                    />
                  </td>
                  <td>
                    <input
                      className="form-field-box"
                      inputMode="decimal"
                      placeholder="Unit Price"
                      {...register(`declarations.${di}.cdcLines.${li}.unitPrice`)}
                    />
                  </td>
                  <td>
                    <input
                      className="form-field-box"
                      readOnly
                      tabIndex={-1}
                      placeholder="Total Amount"
                      value={
                        w?.qty && w?.unitPrice
                          ? (toNum(w.qty) * toNum(w.unitPrice)).toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : ''
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="cdc-remove-line-btn"
                      title="Remove line"
                      onClick={() => lines.remove(li)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="cdc-add-line-btn"
        disabled={!items.length}
        onClick={() =>
          lines.append({
            cutStockItemId: '',
            qty: '',
            unitPrice: '',
            netWeightKg: '',
            overrideReason: '',
          })
        }
      >
        + Add Line
      </button>
    </div>
  );
}
