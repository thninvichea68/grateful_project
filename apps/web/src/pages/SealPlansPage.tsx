import { Fragment, useMemo, useState } from 'react';
import type { SealPlanRow } from '@gs/shared';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useLookups, useSealPlans } from '../features/hooks';
import { HeaderFilter } from '../components/HeaderFilter';
import { TableState, ui } from '../components/ui';
import { useLocalHeaderFilters, type LocalColumn } from '../components/useLocalHeaderFilters';
import { SearchBox } from '../components/SearchBox';
import { fmtDate } from '../lib/format';
import { NewSealPlanModal } from './sealplans/NewSealPlanModal';
import { SealPlanModal, type SealPlanTarget } from './sealplans/SealPlanModal';
import { SealPlansMenu } from './sealplans/SealPlansMenu';
import { fmtTare, groupByMonth, monthHeading, MONTHS } from './sealplans/sealPlanFormat';

const COLS = 21;
const dash = (v: string | null) => v || '-';
const asDate = { kind: 'date', format: fmtDate } as const;

/** The columns after No., with what each one's header filter keeps. */
const FILTER_COLS: LocalColumn<SealPlanRow>[] = [
  { key: 'invNo', label: 'GS Inv No.', value: (r) => r.invNo },
  { key: 'client', label: 'Client', value: (r) => r.clientCode },
  { key: 'carrier', label: 'Carrier', value: (r) => r.carrier },
  { key: 'bookingNo', label: 'SO No.', value: (r) => r.bookingNo },
  { key: 'port', label: 'Port', value: (r) => r.portName },
  { key: 'destination', label: 'Destination', value: (r) => r.destination ?? r.destinationCountry },
  { key: 'containerNo', label: 'Container No.', value: (r) => r.containerNo },
  { key: 'size', label: 'Size', value: (r) => r.size },
  { key: 'linerSeal', label: 'Carrier Seal', value: (r) => r.linerSeal },
  { key: 'customsSeal', label: 'Customs Seal', value: (r) => r.customsSeal },
  { key: 'vessel', label: 'Vessel', value: (r) => r.vesselName },
  {
    key: 'tare',
    label: 'Tare Weight',
    kind: 'number',
    align: 'right',
    format: fmtTare,
    value: (r) => r.tareWeightKg,
  },
  { key: 'etd', label: 'ETD', ...asDate, value: (r) => r.etd },
  { key: 'truckBy', label: 'Truck By', value: (r) => r.truckBy },
  { key: 'driverPhone', label: 'Driver Phone', value: (r) => r.driverPhone },
  { key: 'truckNo', label: 'Truck No.', value: (r) => r.truckNo },
  { key: 'deliverTo', label: 'Deliver To', value: (r) => r.deliverTo },
  { key: 'loadingDate', label: 'Date', ...asDate, value: (r) => r.loadingDate },
  { key: 'depot', label: 'Depot', value: (r) => r.depot },
  { key: 'other', label: 'Other', value: (r) => r.other },
];

/**
 * Seal Plan — container shipment schedule: every container of an export shipment, by the month
 * it is loaded, with its seals, vessel, trucking and depot (the SEAL PLAN spreadsheet).
 */
export function SealPlansPage() {
  const { can } = useAuth();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<SealPlanTarget | null>(null);
  const [picking, setPicking] = useState(false);

  const thisYear = new Date().getFullYear();
  const year = Number(params.get('year')) || thisYear;
  const month = params.get('month') ?? '';
  const clientId = params.get('clientId') ?? '';
  const q = params.get('q') ?? '';
  const list = useSealPlans({
    year,
    month: month || undefined,
    clientId: clientId || undefined,
    q: q || undefined,
  });

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const all = useMemo(() => list.data ?? [], [list.data]);
  const header = useLocalHeaderFilters(all, FILTER_COLS, params, setParams);
  // Sorted within each month: the months keep the list's order.
  const groups = useMemo(() => {
    const order = new Map<string, number>();
    for (const r of all) if (!order.has(r.month)) order.set(r.month, order.size);
    const byMonth = [...header.rows].sort((a, b) => order.get(a.month)! - order.get(b.month)!);
    return groupByMonth(byMonth);
  }, [all, header.rows]);

  return (
    <section className="view active caps-values caps-heads" id="view-sealplans">
      <div className="card">
        <div className="card-header-row">
          <h3 style={{ margin: 0 }}>Seal Plan — Container Shipment Schedule</h3>
          <div className={ui.toolbar}>
            {/* First and stretching across the free width, like Shipping Plans' search. */}
            <SearchBox
              grow
              placeholder="Search container, seal, SO no…"
              defaultValue={q}
              onChange={(e) => set('q', e.target.value.trim())}
              aria-label="Search seal plans"
            />
            <select
              className={ui.input}
              value={year}
              onChange={(e) =>
                set('year', e.target.value === String(thisYear) ? '' : e.target.value)
              }
              aria-label="Year"
            >
              {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <select
              className={ui.input}
              value={month}
              onChange={(e) => set('month', e.target.value)}
              aria-label="Month"
            >
              <option value="">All months</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m.charAt(0) + m.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
            <select
              className={ui.input}
              value={clientId}
              onChange={(e) => set('clientId', e.target.value)}
              aria-label="Client"
            >
              <option value="">All clients</option>
              {lookups.data?.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {can('sealplans:write') && (
              <button type="button" className="new-shipment-btn" onClick={() => setPicking(true)}>
                + New Seal Plan
              </button>
            )}
            <SealPlansMenu
              filters={{ year: String(year), month, clientId, q }}
              count={list.data?.length ?? 0}
            />
          </div>
        </div>
        <div className="plans-table-scroll">
          <table className="data-table-clean seal-plan-table">
            <thead>
              <tr>
                <th>No.</th>
                {FILTER_COLS.map((c) => (
                  <th key={c.key} style={c.align ? { textAlign: c.align } : undefined}>
                    <HeaderFilter {...header.headProps(c)} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <TableState
                cols={COLS}
                loading={list.isLoading}
                error={list.error}
                empty={!!list.data && groups.length === 0}
                emptyText={
                  q || clientId || month || header.active
                    ? 'No containers match these filters.'
                    : `No seal plans in ${year} yet. Containers of export CY/CY Shipping Plans appear here; “+ New Seal Plan” adds one.`
                }
              />
              {groups.map((g) => (
                <Fragment key={g.month}>
                  <tr className="seal-plan-month">
                    <td colSpan={COLS}>
                      <span>
                        {monthHeading(g.month)} · {g.rows.length} container
                        {g.rows.length === 1 ? '' : 's'}
                      </span>
                    </td>
                  </tr>
                  {g.rows.map((r, i) => (
                    <tr
                      key={r.id ?? `${r.shipmentId}:${r.containerNo}`}
                      className="plans-row-clickable"
                      tabIndex={0}
                      onClick={() => setOpen({ kind: 'row', row: r })}
                      onKeyDown={(e) => e.key === 'Enter' && setOpen({ kind: 'row', row: r })}
                    >
                      <td>{i + 1}</td>
                      <td style={r.invNo ? undefined : { color: 'var(--text-tertiary)' }}>
                        {r.invNo ?? 'TBA'}
                      </td>
                      <td className="val-bold" title={r.clientName}>
                        {r.clientCode}
                      </td>
                      <td>{dash(r.carrier)}</td>
                      <td>{dash(r.bookingNo)}</td>
                      <td>{dash(r.portName)}</td>
                      <td>{r.destination ?? dash(r.destinationCountry)}</td>
                      <td className="val-bold">{r.containerNo}</td>
                      <td>{dash(r.size)}</td>
                      <td>{dash(r.linerSeal)}</td>
                      <td>{dash(r.customsSeal)}</td>
                      <td>{dash(r.vesselName)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtTare(r.tareWeightKg)}</td>
                      <td>{fmtDate(r.etd)}</td>
                      <td>{dash(r.truckBy)}</td>
                      <td>{dash(r.driverPhone)}</td>
                      <td>{dash(r.truckNo)}</td>
                      <td>{dash(r.deliverTo)}</td>
                      <td>{fmtDate(r.loadingDate)}</td>
                      <td>{dash(r.depot)}</td>
                      <td>{dash(r.other)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {picking && (
        <NewSealPlanModal
          onPick={(shipmentId) => {
            setPicking(false);
            setOpen({ kind: 'shipment', shipmentId });
          }}
          onBlank={() => {
            setPicking(false);
            setOpen({ kind: 'blank' });
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {open && <SealPlanModal target={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
