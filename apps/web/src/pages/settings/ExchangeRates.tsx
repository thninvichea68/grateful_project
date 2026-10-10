import { useState } from 'react';
import type { ExchangeRateImportResult, ExchangeRateSyncStatus, SettingsBundle } from '@gs/shared';
import { useApiMutation } from '../../features/admin';
import { FilePicker } from '../../components/FilePicker';
import { ErrorBanner, Modal, ui } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { icons } from '../../layout/icons';
import { api } from '../../lib/api';
import { uploadFile } from '../../lib/files';
import { fmtDate, fmtNum } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';
import r from './ExchangeRates.module.css';

const INVALIDATE = [['settings'], queryKeys.lookups];
type Rate = SettingsBundle['exchangeRates'][number];

/** One rate row; Edit turns the date and rate into inputs in place. */
export function RateRow({ rate, manage }: { rate: Rate; manage: boolean }) {
  const toast = useToast();
  const [draft, setDraft] = useState<{ effectiveDate: string; usdToKhr: string } | null>(null);
  const save = useApiMutation(
    () => api(`/settings/exchange-rates/${rate.id}`, { method: 'PATCH', json: draft }),
    INVALIDATE,
  );
  const del = useApiMutation(
    () => api(`/settings/exchange-rates/${rate.id}`, { method: 'DELETE' }),
    INVALIDATE,
  );
  const commit = () =>
    void save.mutateAsync(undefined).then(() => {
      setDraft(null);
      toast('Rate updated.');
    });

  if (draft)
    return (
      <tr className={r.editing}>
        <td>
          <input
            type="date"
            className={ui.input}
            value={draft.effectiveDate}
            onChange={(e) => setDraft({ ...draft, effectiveDate: e.target.value })}
            aria-label="Effective from"
          />
        </td>
        <td>
          <span className={r.rateInput}>
            <input
              className={ui.input}
              inputMode="decimal"
              value={draft.usdToKhr}
              autoFocus
              onChange={(e) => setDraft({ ...draft, usdToKhr: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setDraft(null);
              }}
              aria-label="KHR per USD"
            />
            KHR
          </span>
          {save.error ? <ErrorBanner error={save.error} /> : null}
        </td>
        <td>
          <div className={r.actions}>
            <button
              type="button"
              className="btn-create-submit"
              disabled={!draft.usdToKhr || !draft.effectiveDate || save.isPending}
              onClick={commit}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn-cancel-shipment" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </td>
      </tr>
    );

  return (
    <tr>
      <td>{fmtDate(rate.effectiveDate)}</td>
      <td className="val-bold">{fmtNum(rate.usdToKhr)} KHR</td>
      <td>
        {manage && (
          <div className={r.actions}>
            <button
              type="button"
              className={r.icon}
              title="Edit"
              aria-label={`Edit rate of ${fmtDate(rate.effectiveDate)}`}
              onClick={() =>
                setDraft({
                  effectiveDate: rate.effectiveDate,
                  usdToKhr: String(Number(rate.usdToKhr)),
                })
              }
            >
              {icons.edit({})}
            </button>
            <button
              type="button"
              className={`${r.icon} ${r.danger}`}
              title="Delete"
              aria-label={`Delete rate of ${fmtDate(rate.effectiveDate)}`}
              disabled={del.isPending}
              onClick={() =>
                window.confirm(`Delete the rate of ${fmtDate(rate.effectiveDate)}?`) &&
                void del.mutateAsync(undefined).then(() => toast('Rate deleted.'))
              }
            >
              {icons.trash({})}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

/** One line under the card title: where rates come from and how the last MEF check went. */
export function MefSyncStatus({
  status,
  auto,
}: {
  status: ExchangeRateSyncStatus | null;
  auto: boolean;
}) {
  const when = status
    ? new Date(status.at).toLocaleString('en-GB', {
        timeZone: 'Asia/Phnom_Penh',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  return (
    <div className={r.sync} data-tone={status && !status.ok ? 'error' : undefined}>
      <span className={r.syncDot} />
      <span>
        <strong>{auto ? 'Auto-updated' : 'Automatic updates off'}</strong>
        {auto ? ' every 3 hours' : ''} from the{' '}
        <a
          href="https://data.mef.gov.kh/datasets/pd_66a0cd503e0bd300012638fb4"
          target="_blank"
          rel="noreferrer"
        >
          MEF official rate
        </a>
        {status &&
          (status.ok ? (
            <>
              {' '}
              · Last check {when}: {fmtNum(status.usdToKhr)} KHR for {fmtDate(status.effectiveDate)}
              {status.result === 'same'
                ? ' (already up to date)'
                : status.result === 'new'
                  ? ' (added)'
                  : ' (updated)'}
            </>
          ) : (
            <>
              {' '}
              · Last check {when} failed: {status.error}
            </>
          ))}
      </span>
    </div>
  );
}

/** Upload a rate sheet, show what it will change, then apply. */
export function RateImportModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ExchangeRateImportResult | null>(null);
  const run = useApiMutation(
    (dryRun: boolean) =>
      uploadFile<ExchangeRateImportResult>('/settings/exchange-rates/import', file!, { dryRun }),
    INVALIDATE,
  );
  const changes = preview ? preview.created + preview.updated : 0;

  return (
    <Modal
      title="Import exchange rates"
      sub="Upload the rate sheet (e.g. “Exchange Rate 2026.xlsx”). Every row with a date and a rate is read; titles and headers are skipped."
      width={620}
      onClose={onClose}
    >
      <ErrorBanner error={run.error} />
      <FilePicker
        id="rate-file"
        accept=".xlsx,.csv"
        hint="Excel (.xlsx) or CSV · columns like Release Date, Currency, Rate"
        file={file}
        onChange={(f) => {
          setFile(f);
          setPreview(null);
        }}
      />
      {preview && (
        <div className={r.preview}>
          <div className={r.counts}>
            <span data-tone="new">{preview.created} new</span>
            <span data-tone="changed">{preview.updated} changed</span>
            <span>{preview.unchanged} already up to date</span>
            {preview.skipped.length > 0 && (
              <span data-tone="skipped">{preview.skipped.length} skipped</span>
            )}
          </div>
          <div className={r.previewTable}>
            <table className="data-table-clean">
              <thead>
                <tr>
                  <th>Date</th>
                  <th style={{ textAlign: 'right' }}>1 USD =</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {preview.rates.map((x) => (
                  <tr key={x.effectiveDate}>
                    <td>{fmtDate(x.effectiveDate)}</td>
                    <td className="val-bold" style={{ textAlign: 'right' }}>
                      {fmtNum(x.usdToKhr)} KHR
                    </td>
                    <td>
                      <span className={r.status} data-tone={x.status}>
                        {x.status === 'new' ? 'New' : x.status === 'changed' ? 'Changed' : 'Same'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.skipped.length > 0 && (
            <ul className={r.skipped}>
              {preview.skipped.slice(0, 8).map((x) => (
                <li key={`${x.sheet}-${x.row}`}>
                  {x.sheet} row {x.row}: {x.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className={ui.actions}>
        <button type="button" className="btn-cancel-shipment" onClick={onClose}>
          Cancel
        </button>
        {!preview ? (
          <button
            type="button"
            className="btn-create-submit"
            disabled={!file || run.isPending}
            onClick={() => void run.mutateAsync(true).then(setPreview)}
          >
            {run.isPending ? 'Reading…' : 'Preview'}
          </button>
        ) : (
          <button
            type="button"
            className="btn-create-submit"
            disabled={changes === 0 || run.isPending}
            onClick={() =>
              void run.mutateAsync(false).then((res) => {
                toast(`Rates imported: ${res.created} new, ${res.updated} changed.`);
                onClose();
              })
            }
          >
            {run.isPending
              ? 'Importing…'
              : changes === 0
                ? 'Nothing to import'
                : `Import ${changes} rate${changes === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
    </Modal>
  );
}
