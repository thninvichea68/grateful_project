import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { type LookupsResponse, type ShipmentDetail } from '@gs/shared';
import { FieldError } from '../../components/ui';
import { maskDeclareNo } from '../../lib/declareNo';
import { fi } from './formIcons';
import { blankDeclaration, type FormValues } from './formModel';

/** Customs declarations (the CDC master list is drawn down by the import invoice items). */
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
  const transportMode = useWatch({ control, name: 'transportMode' });
  const watched = useWatch({ control, name: 'declarations' });
  const isImport = direction === 'IMPORT';
  // Air clears before customs numbers the declaration: the date can go in with the no. pending.
  const isAir = transportMode === 'AIR';

  const declErr = errors.declarations;
  return (
    <div className="cx-card">
      <div className="cx-card-head">
        <div className="cx-title">
          <span className="cx-title-icon">{fi.badge({ width: 18, height: 18 })}</span>
          <h3>Customs Declarations</h3>
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
                  placeholder={isAir ? 'Pending' : isImport ? 'e.g. I 122050' : 'e.g. E 41001'}
                  {...register(`declarations.${di}.declareNo`)}
                  onChange={(ev) => {
                    maskDeclareNo(ev);
                    void register(`declarations.${di}.declareNo`).onChange(ev);
                  }}
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
              {/* An import's declarations take the Clearance Port from step 3 (set on save). */}
              {!isImport && (
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
              )}
              <div className="form-field-group" style={{ justifyContent: 'flex-end' }}>
                {di === 0 ? null : ledger ? (
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
          </div>
        );
      })}
    </div>
  );
}
