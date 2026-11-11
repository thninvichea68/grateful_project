import { useCallback, useState } from 'react';

export type WidgetId =
  | 'kpis'
  | 'shipments'
  | 'profit'
  | 'clientTrend'
  | 'clients'
  | 'map'
  | 'accounts'
  | 'ports'
  | 'forwarders'
  | 'live';

export interface WidgetDef {
  id: WidgetId;
  label: string;
  sub: string;
  /** Profit needs accounting:read; the others show to everyone who sees the Overview. */
  accounting?: boolean;
}

/** Every Overview widget, in page order. */
export const WIDGETS: WidgetDef[] = [
  { id: 'kpis', label: 'Key figures', sub: 'The row of totals across the top' },
  { id: 'shipments', label: 'Shipment Summary', sub: 'Shipments month by month through the year' },
  {
    id: 'profit',
    label: 'Total Net Profit',
    sub: 'Net profit by month, all clients',
    accounting: true,
  },
  {
    id: 'clientTrend',
    label: 'Shipments per Client',
    sub: 'One client’s shipments month by month, picked from a list',
  },
  {
    id: 'clients',
    label: 'Shipments by Client',
    sub: 'Each client’s share of the period’s shipments',
  },
  {
    id: 'map',
    label: 'Shipments by Country',
    sub: 'World map of where imports come from and exports go',
  },
  {
    id: 'accounts',
    label: 'Shipments breakdown',
    sub: 'Clients and their shipments in the period',
  },
  { id: 'ports', label: 'Port of Discharge', sub: 'Shipments by port' },
  { id: 'forwarders', label: 'Forwarder Statistics', sub: 'Shipments by forwarder' },
  { id: 'live', label: 'Live Consignments Tracking', sub: 'Shipments on the move right now' },
];

/** The widgets one person can pick from: Profit only with accounting access. */
export const widgetsFor = (canProfit: boolean) => WIDGETS.filter((w) => canProfit || !w.accounting);

/** Shown before anyone customizes; the rest are opt-in from Edit widgets. */
const DEFAULTS: WidgetId[] = ['kpis', 'shipments', 'accounts', 'ports', 'live'];

// canProfit kept in the signature: callers and toggle() pass it, defaults may depend on it again.
export const shownByDefault = (id: WidgetId, _canProfit: boolean) => DEFAULTS.includes(id);

type Choices = Partial<Record<WidgetId, boolean>>;
const key = (userId: string) => `gs:overview-widgets:${userId}`;

function read(userId: string): Choices {
  try {
    return JSON.parse(localStorage.getItem(key(userId)) ?? '{}') as Choices;
  } catch {
    return {};
  }
}

/**
 * Which Overview widgets this person shows, kept in this browser per user. Only the ones they
 * changed are stored, so a widget added to the Overview later shows by default.
 */
export function useOverviewWidgets(userId: string, canProfit: boolean) {
  const [choices, setChoices] = useState(() => read(userId));
  const save = (next: Choices) => {
    setChoices(next);
    try {
      if (Object.keys(next).length) localStorage.setItem(key(userId), JSON.stringify(next));
      else localStorage.removeItem(key(userId));
    } catch {
      /* private window: the choice lasts until the page reloads */
    }
  };
  const shown = useCallback(
    (id: WidgetId) =>
      (canProfit || !WIDGETS.find((w) => w.id === id)?.accounting) &&
      (choices[id] ?? shownByDefault(id, canProfit)),
    [choices, canProfit],
  );
  const toggle = (id: WidgetId) => {
    const on = !shown(id);
    // Back to its default: forget the choice rather than store it.
    const { [id]: _was, ...rest } = choices;
    save(on === shownByDefault(id, canProfit) ? rest : { ...rest, [id]: on });
  };
  return {
    shown,
    toggle,
    reset: () => save({}),
    customized: Object.keys(choices).length > 0,
  };
}

/**
 * Overview grid: packs cards (each `base` columns wide) into rows of `cols` in order, and
 * shares each row's leftover columns among that row's cards, last card first, so no row
 * ends in an empty gap.
 */
export function rowSpans(base: number[], cols: number): number[] {
  const out = base.map((b) => Math.min(b, cols));
  let row: number[] = [];
  let used = 0;
  const close = () => {
    for (let free = cols - used, k = row.length - 1; free > 0; free--) {
      out[row[k]!]! += 1;
      k = k > 0 ? k - 1 : row.length - 1;
    }
    row = [];
    used = 0;
  };
  out.forEach((n, i) => {
    if (used + n > cols) close();
    row.push(i);
    used += n;
  });
  if (row.length) close();
  return out;
}
