import { z } from 'zod';
import {
  DIRECTIONS,
  LOAD_TYPES,
  TRANSPORT_MODES,
  type ClearanceStatus,
  type Direction,
  type ShipmentStatus,
} from '../enums';
import { multi } from './fields';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/**
 * Filters shared by every analytics endpoint. The period applies to the shipment's ETA
 * (its operational month); profit figures use the ledger's invoice date.
 */
export const analyticsQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    clientId: multi(z.string().uuid()),
    direction: z.enum(DIRECTIONS).optional(),
    transportMode: z.enum(TRANSPORT_MODES).optional(),
    loadType: z.enum(LOAD_TYPES).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '"from" must be on or before "to"',
    path: ['to'],
  });
export type AnalyticsQuery = z.input<typeof analyticsQuerySchema>;

export const flowQuerySchema = z.object({ flow: z.enum(['import', 'export']).default('import') });

export interface Period {
  from: string;
  to: string;
}

export interface KpiResponse {
  period: Period;
  previousPeriod: Period;
  total: number;
  imports: number;
  exports: number;
  cleared: number;
  clearancePending: number;
  exceptions: number;
  previous: { total: number; imports: number; exports: number; cleared: number };
}

export interface MonthlyVolumeRow {
  month: string; // YYYY-MM
  imports: number;
  exports: number;
  total: number;
}

export interface TransportShareResponse {
  imports: number;
  exports: number;
  total: number;
  byMode: { mode: string; count: number }[];
}

export interface ClearanceStatusRow {
  status: ClearanceStatus;
  count: number;
}

export interface CountryRow {
  iso2: string;
  name: string;
  count: number;
  pct: number;
}

export interface ForwarderRow {
  id: string;
  name: string;
  shipments: number;
  imports: number;
  exports: number;
  /** Imports delivered to the factory (Arrive FTY recorded). */
  factory: number;
  arrived: number;
  onTimePct: number | null;
  avgDelayDays: number | null;
  exceptionPct: number;
  clearedPct: number;
}

export interface PortRow {
  id: string;
  code: string;
  name: string;
  shortName: string;
  imports: number;
  exports: number;
  total: number;
}

export interface AccountBreakdown {
  total: number;
  cy: number;
  lcl: number;
  air: number;
}

export interface AccountRow {
  clientId: string;
  code: string;
  name: string;
  all: AccountBreakdown;
  import: AccountBreakdown;
  export: AccountBreakdown;
}

export interface ProfitSummary {
  year: number;
  total: string;
  thisMonth: string;
  lastMonth: string;
  monthly: { month: string; netProfit: string }[];
  byClient: { clientId: string; code: string; name: string; netProfit: string; pct: number }[];
}

/** One client's ledger figures for a period (by invoice date), for the Analytics cards. */
export interface ClientRevenueRow {
  clientId: string;
  code: string;
  name: string;
  /** Ledger entries (one per customs declaration). */
  entries: number;
  /** Entries Chea hasn't been paid for yet. */
  unpaid: number;
  invRevenue: string;
  disTotal: string;
  dnTotal: string;
  vat: string;
  clearFee: string;
  thc: string;
  commission: string;
  otherPay: string;
  /** INV + DIS + DN. */
  revenue: string;
  /** Clear fee + THC + CM + Other. */
  costs: string;
  netProfit: string;
  /** Net profit as a % of revenue; null when there is no revenue. */
  marginPct: number | null;
  /** This client's share of all clients' net profit in the period. */
  sharePct: number | null;
  lastInvDate: string | null;
  /** Every month of the period, zero-filled. */
  monthly: { month: string; revenue: string; netProfit: string }[];
}

export interface OverviewSummary {
  year: number;
  today: string;
  kpis: KpiResponse;
  monthly: MonthlyVolumeRow[];
  /** Present only for roles with accounting:read. */
  profit?: ProfitSummary;
}

export interface LiveConsignment {
  id: string;
  reference: string;
  clientCode: string;
  direction: Direction;
  invoiceNos: string[];
  forwarderName: string | null;
  clearancePortName: string | null;
  eta: string | null;
  status: ShipmentStatus;
  clearanceStatus: ClearanceStatus;
}
