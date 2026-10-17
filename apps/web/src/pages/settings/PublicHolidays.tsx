import { useState } from 'react';
import type { PublicHoliday } from '@gs/shared';
import { useApiMutation, usePublicHolidays } from '../../features/admin';
import { ErrorBanner } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { api, ApiError } from '../../lib/api';
import h from './PublicHolidays.module.css';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmt = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
};

type Draft = { id?: string; holidayDate: string; name: string; note: string };
const INVALIDATE = [['settings', 'holidays']];

/**
 * Settings → Public holidays: the Cambodian public holiday calendar. Tax invoices, DIS and
 * debit notes are dated the next working day after the declaration date, past weekends and
 * these days. Changes apply to documents dated from now on, not to ones already dated.
 */
export function PublicHolidays({ manage }: { manage: boolean }) {
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const list = usePublicHolidays(year);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation(
    (d: Draft) =>
      d.id
        ? api(`/settings/public-holidays/${d.id}`, { method: 'PATCH', json: d })
        : api('/settings/public-holidays', { method: 'POST', json: d }),
    INVALIDATE,
  );
  const del = useApiMutation(
    (id: string) => api(`/settings/public-holidays/${id}`, { method: 'DELETE' }),
    INVALIDATE,
  );

  const submit = async () => {
    if (!edit) return;
    setError(null);
    try {
      await save.mutateAsync(edit);
      toast(edit.id ? 'Holiday updated.' : 'Holiday added.');
      if (edit.holidayDate.slice(0, 4) !== String(year))
        setYear(Number(edit.holidayDate.slice(0, 4)));
      setEdit(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the holiday.');
    }
  };
  const remove = (r: PublicHoliday) => {
    if (!window.confirm(`Remove ${r.name} (${fmt(r.holidayDate)}) from the holiday calendar?`))
      return;
    void del.mutateAsync(r.id).then(() => toast('Holiday removed.'));
  };
  const rows = list.data ?? [];

  return (
    <div className="card">
      <div className={h.head}>
        <div>
          <h3 className={h.title}>Public holidays</h3>
          <p className={h.sub}>
            Tax invoices, disbursements and debit notes are dated the next working day after the
            declaration date, skipping weekends and these days. A change applies to documents dated
            from now on.
          </p>
        </div>
        <div className={h.tools}>
          <div className={h.year}>
            <button type="button" aria-label="Previous year" onClick={() => setYear((y) => y - 1)}>
              ‹
            </button>
            <b>{year}</b>
            <button type="button" aria-label="Next year" onClick={() => setYear((y) => y + 1)}>
              ›
            </button>
          </div>
          {manage && (
            <button
              type="button"
              className="new-shipment-btn"
              onClick={() => {
                setError(null);
                setEdit({ holidayDate: `${year}-01-01`, name: '', note: '' });
              }}
            >
              + Add holiday
            </button>
          )}
        </div>
      </div>
      <ErrorBanner error={list.error} />

      {edit && (
        <div className={h.form}>
          <label>
            Date
            <input
              type="date"
              className="form-field-box"
              value={edit.holidayDate}
              onChange={(e) => setEdit({ ...edit, holidayDate: e.target.value })}
            />
          </label>
          <label className={h.grow}>
            Name
            <input
              className="form-field-box"
              value={edit.name}
              placeholder="e.g. Khmer New Year"
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
          </label>
          <label className={h.grow}>
            Note
            <input
              className="form-field-box"
              value={edit.note}
              placeholder="Optional, e.g. the sub-decree"
              onChange={(e) => setEdit({ ...edit, note: e.target.value })}
            />
          </label>
          <div className={h.formButtons}>
            <button type="button" className="filter-btn" onClick={() => setEdit(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="new-shipment-btn"
              disabled={save.isPending || !edit.holidayDate || edit.name.trim().length < 2}
              onClick={() => void submit()}
            >
              Save
            </button>
          </div>
          {error && <p className={h.error}>{error}</p>}
        </div>
      )}

      <div className={h.table}>
        {rows.map((r) => (
          <div
            key={r.id}
            className={h.row}
            data-provisional={/provisional/i.test(r.note ?? '') || undefined}
          >
            <span className={h.date}>{fmt(r.holidayDate)}</span>
            <span className={h.name}>
              {r.name}
              {r.note && <small>{r.note}</small>}
            </span>
            {manage && (
              <span className={h.actions}>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setEdit({
                      id: r.id,
                      holidayDate: r.holidayDate,
                      name: r.name,
                      note: r.note ?? '',
                    });
                  }}
                >
                  Edit
                </button>
                <button type="button" data-danger onClick={() => remove(r)}>
                  Remove
                </button>
              </span>
            )}
          </div>
        ))}
        {!list.isLoading && !rows.length && (
          <p className={h.empty}>
            No public holidays entered for {year}.{manage ? ' Add them with “+ Add holiday”.' : ''}
          </p>
        )}
      </div>
      {rows.length > 0 && (
        <p className={h.count}>
          {rows.length} day{rows.length === 1 ? '' : 's'} in {year}
        </p>
      )}
    </div>
  );
}
