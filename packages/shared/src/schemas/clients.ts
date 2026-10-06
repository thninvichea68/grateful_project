import { z } from 'zod';
import { CLIENT_STATUSES, type ClientStatus, type Direction, type ShipmentStatus } from '../enums';
import { paginationQuerySchema } from './common';
import { decimal, optText } from './fields';

export const clientInputSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,6}$/, '2–6 letters or digits, e.g. JR'),
  name: z.string().trim().min(2, 'Enter the company name').max(120),
  legalName: optText(200),
  legalNameKm: optText(200),
  countryIso2: z.string().trim().toUpperCase().length(2, 'Choose a country'),
  address: optText(400),
  vattin: optText(40),
  contactName: optText(120),
  contactEmail: z
    .string()
    .trim()
    .email('Enter a valid email')
    .nullish()
    .or(z.literal(''))
    .transform((v) => (v ? v : null)),
  contactPhone: optText(40),
  commissionUsd: decimal(2, { min: 0, allowEmpty: false }),
  status: z.enum(CLIENT_STATUSES).default('ACTIVE'),
});
export type ClientInput = z.input<typeof clientInputSchema>;
export type ClientInputParsed = z.output<typeof clientInputSchema>;

export const clientListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(CLIENT_STATUSES).optional(),
});

export interface ClientListItem {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  countryIso2: string;
  countryName: string;
  status: ClientStatus;
  commissionUsd: string;
  shipmentCount: number;
  activeShipments: number;
  lastEta: string | null;
  /** Only returned to roles with accounting:read. */
  netProfitYtd?: string;
}

export interface ClientDetail extends ClientListItem {
  legalNameKm: string | null;
  address: string | null;
  vattin: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  createdAt: string;
  importCount: number;
  exportCount: number;
  cutStockItems: number;
  consignees: { id: string; name: string; countryIso2: string | null }[];
  recentShipments: {
    id: string;
    reference: string;
    direction: Direction;
    status: ShipmentStatus;
    eta: string | null;
    invoiceNos: string[];
  }[];
}
