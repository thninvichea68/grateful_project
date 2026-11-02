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
  /** The month the card opens on (YYYY-MM): this month, or December for a past year. */
  currentMonth: string;
  /** Each client's net profit per month of the year (months with ledger entries only). */
  byClientMonthly: {
    month: string;
    clientId: string;
    code: string;
    name: string;
    netProfit: string;
  }[];
  /**
   * Ledger rows with costs but nothing billed yet (INV + DIS + DN = 0), per month (months
   * with such rows only). They are left out of every profit figure above.
   */
  unbilled: { month: string; entries: number; costs: string }[];
}

/** One client's ledger figures for a period (by invoice date), for the Analytics cards. */
export interface ClientRevenueRow {
  clientId: string;
  code: string;
  name: string;
  /** Billed ledger entries (one per customs declaration); every figure below is from these. */
  entries: number;
  /** Billed entries Chea hasn't been paid for yet. */
  unpaid: number;
  /** Entries with costs but nothing billed yet (INV + DIS + DN = 0): left out of the figures. */
  unbilled: number;
  /** Clear fee + THC + CM + Other of the unbilled entries. */
  unbilledCosts: string;
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
  /** The day the figures run to: today for the live month, else the chosen month's last day. */
  today: string;
  /** The month shown (YYYY-MM); for a full year, its last month (this month for this year). */
  month: string;
  /** True when the KPIs cover January to `month` (kpis.period) instead of one month. */
  fullYear: boolean;
  /** True for the current month or year (figures refresh); false for a past one. */
  live: boolean;
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

/* ---------------- Business Insights (Analytics → Business Insights) ---------------- */

/** A measure this period and the period before; `better` says which way is good. */
export interface InsightMetric {
  value: number | null;
  previous: number | null;
  better: 'up' | 'down';
}

export type ClientHealth = 'NEW' | 'GROWING' | 'STABLE' | 'DECLINING' | 'AT_RISK';

export interface InsightClient {
  clientId: string;
  code: string;
  name: string;
  shipments: number;
  prevShipments: number;
  /** Shipments vs the period before, in %; null when there were none before. */
  growthPct: number | null;
  lastShipment: string | null;
  daysSinceLast: number | null;
  /** Days between shipments, on average, this period. */
  usualGapDays: number | null;
  health: ClientHealth;
  /** Money (billed ledger rows), for accounting roles only. */
  revenue?: string;
  netProfit?: string;
  marginPct?: number | null;
  profitPerDeclaration?: string | null;
  sharePct?: number | null;
}

export interface InsightRecommendation {
  severity: 'high' | 'medium' | 'good';
  area: 'Service' | 'Clients' | 'Profit' | 'Partners' | 'Team';
  title: string;
  detail: string;
  action: string;
  /** Where to act, e.g. "/clients/…". */
  link?: string;
}

export interface InsightsResponse {
  period: Period;
  previous: Period;
  /** Whether money figures are included (accounting:read). */
  money: boolean;
  scorecard: {
    shipments: InsightMetric;
    /** Import: days from arrival (ATA, else ETA) to the first declare date. */
    clearanceDays: InsightMetric;
    /** Import: days from clearance to arrival at the factory. */
    deliveryDays: InsightMetric;
    /** Import: delivered to the factory within 2 days of clearance, in %. */
    onTimeDeliveryPct: InsightMetric;
    exceptionPct: InsightMetric;
    /** Follow-ups completed in the period by their due time, in %. */
    followUpOnTimePct: InsightMetric;
    netProfit?: InsightMetric;
    marginPct?: InsightMetric;
    profitPerDeclaration?: InsightMetric;
  };
  trend: {
    month: string;
    shipments: number;
    clearanceDays: number | null;
    deliveryDays: number | null;
    netProfit?: string;
  }[];
  ports: {
    code: string;
    name: string;
    shipments: number;
    clearanceDays: number | null;
    deliveryDays: number | null;
    exceptionPct: number;
  }[];
  forwarders: {
    id: string;
    name: string;
    shipments: number;
    onTimePct: number | null;
    avgDelayDays: number | null;
    exceptionPct: number;
    clearanceDays: number | null;
    /** 0–100: on time 50%, no exceptions 30%, quick clearance 20%. */
    score: number;
  }[];
  clients: InsightClient[];
  concentration: {
    by: 'profit' | 'shipments';
    topCode: string | null;
    topPct: number;
    top3Pct: number;
  };
  team: {
    userId: string;
    name: string;
    active: number;
    handled: number;
    openFollowUps: number;
    overdueFollowUps: number;
  }[];
  recommendations: InsightRecommendation[];
}
