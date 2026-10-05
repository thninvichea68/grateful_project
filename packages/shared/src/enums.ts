/**
 * Domain enums shared by the API (database enums) and the web app (labels, pills).
 * The string values are what is stored in PostgreSQL.
 */

export const DIRECTIONS = ['IMPORT', 'EXPORT'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** How the cargo travels. Split from load type (see Phase 1, decision 2). */
export const TRANSPORT_MODES = ['SEA', 'AIR', 'ROAD', 'RAIL'] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

/** FCL = "CY/CY" in the prototype. NONE is used for air and loose road cargo. */
export const LOAD_TYPES = ['FCL', 'LCL', 'NONE'] as const;
export type LoadType = (typeof LOAD_TYPES)[number];

export const SHIPMENT_STATUSES = ['COMPLETED', 'IN_PROGRESS', 'PENDING', 'EXCEPTION'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const CLEARANCE_STATUSES = ['PENDING', 'IN_PROGRESS', 'CLEARED', 'EXCEPTION'] as const;
export type ClearanceStatus = (typeof CLEARANCE_STATUSES)[number];

export const CONTAINER_SIZES = ['20GP', '40GP', '40HQ', '45HQ'] as const;
export type ContainerSize = (typeof CONTAINER_SIZES)[number];

export const PORT_KINDS = ['SEA', 'DRY', 'AIR', 'LAND', 'RAIL'] as const;
export type PortKind = (typeof PORT_KINDS)[number];

export const CLIENT_STATUSES = ['ACTIVE', 'ONBOARDING', 'INACTIVE'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CUT_STOCK_CATEGORIES = ['MACHINERY_EQUIPMENT', 'RAW_MATERIAL', 'ACCESSORY'] as const;
export type CutStockCategory = (typeof CUT_STOCK_CATEGORIES)[number];

export const CHEA_STATUSES = ['UNPAID', 'PAID'] as const;
export type CheaStatus = (typeof CHEA_STATUSES)[number];

export const BILLING_DOC_STATUSES = ['DRAFT', 'ISSUED', 'VOID'] as const;
export type BillingDocStatus = (typeof BILLING_DOC_STATUSES)[number];

export const QUOTATION_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'SUPERSEDED'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const DOCUMENT_CATEGORIES = [
  'BILL_OF_LADING',
  'CUSTOMS_DECLARATION',
  'CERTIFICATE_OF_ORIGIN',
  'COMMERCIAL_INVOICE',
  'PACKING_LIST',
  'CONTRACT',
  'POLICY',
  'OTHER',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const FOLLOW_UP_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type FollowUpPriority = (typeof FOLLOW_UP_PRIORITIES)[number];

export const FOLLOW_UP_STATUSES = ['OPEN', 'AWAITING_REPLY', 'IN_REVIEW', 'DONE'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const STAFF_STATUSES = ['ACTIVE', 'ON_LEAVE', 'INACTIVE'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const CREDIT_NOTE_REF_TYPES = ['HOUSE_BILL', 'BILL_NO', 'HAWB_NO'] as const;
export type CreditNoteRefType = (typeof CREDIT_NOTE_REF_TYPES)[number];

export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'RESTORE',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'TOKEN_REUSE',
  'OVERRIDE',
  'IMPORT',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const LOOKUP_TYPES = [
  'QUANTITY_UNIT',
  'MATERIAL',
  'CO_FORM',
  'BROKER',
  'DEPARTMENT',
  'CHARGE',
] as const;
export type LookupType = (typeof LOOKUP_TYPES)[number];

/* ---------- Display labels (prototype wording) ---------- */

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  COMPLETED: 'Completed',
  IN_PROGRESS: 'In Progress',
  PENDING: 'Pending',
  EXCEPTION: 'Exception',
};

/** CSS modifier used by the prototype's `.status-tag` / status pill classes. */
export const SHIPMENT_STATUS_PILL: Record<
  ShipmentStatus,
  'completed' | 'progress' | 'pending' | 'exception'
> = {
  COMPLETED: 'completed',
  IN_PROGRESS: 'progress',
  PENDING: 'pending',
  EXCEPTION: 'exception',
};

export const CLEARANCE_STATUS_LABEL: Record<ClearanceStatus, string> = {
  PENDING: 'Pending Review',
  IN_PROGRESS: 'In Progress',
  CLEARED: 'Customs Cleared',
  EXCEPTION: 'Exception',
};

/** "Freight method" as the prototype shows it, derived from mode + load type. */
export function freightMethodLabel(mode: TransportMode, load: LoadType): string {
  if (mode === 'AIR') return 'AIR';
  if (mode === 'SEA')
    return load === 'LCL' ? 'SEA LCL/LCL' : load === 'FCL' ? 'SEA CY/CY' : 'BY SEA';
  return `BY ${mode}`;
}

/** Key Logistics Accounts buckets: CY/CY, LCL, AIR. */
export type AccountBucket = 'CY' | 'LCL' | 'AIR' | 'OTHER';
export function accountBucket(mode: TransportMode, load: LoadType): AccountBucket {
  if (mode === 'AIR') return 'AIR';
  if (load === 'LCL') return 'LCL';
  if (load === 'FCL') return 'CY';
  return 'OTHER';
}
