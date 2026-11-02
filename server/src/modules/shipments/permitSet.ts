import type { PermitCover, PermitInvoice, PermitSetResponse } from '@gs/shared';
import { khmerLunarText, khmerSolarText } from '../../lib/khmerDate';
import { authorizeLetter } from './authorizeLetter';
import {
  cifPlace,
  dmy,
  letterProfile,
  load,
  localPhone,
  n,
  portKm,
  round,
  titleCase,
  today,
  twoLines,
  type Line,
} from './importInvoicePackingList';

/**
 * The import permit application set, for printing: the cover letter to Customs, each
 * commercial invoice with its packing list, and the transfer of rights. Same figures as the
 * INV + PL workbook; each document says what it still needs instead of printing half-filled.
 */
export async function permitSet(shipmentId: string): Promise<PermitSetResponse> {
  const [{ head: h, lines }, authorize] = await Promise.all([
    load(shipmentId),
    authorizeLetter(shipmentId),
  ]);
  const unit = titleCase((h.quantityUnit ?? 'ROLLS').trim());
  const company = h.legalName ?? h.clientName;
  const address = twoLines(h.clientAddress);
  const phone = localPhone(h.contactPhone);
  const supplierAddress = (h.supplierAddress ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim().toUpperCase())
    .filter(Boolean);
  const containers = h.containers.map((k) =>
    [k.containerNo, k.linerSeal, k.size?.replace(/^(\d+)/, "$1'")].filter(Boolean).join(' / '),
  );

  // ---- Invoices + packing lists ----
  const byInvoice = new Map<string, Line[]>();
  for (const l of lines) byInvoice.set(l.invoiceId, [...(byInvoice.get(l.invoiceId) ?? []), l]);
  const invoices: PermitInvoice[] = [...byInvoice.values()].map((inv) => {
    const rows = inv.map((l, i) => {
      const unitPrice = n(l.price) || n(l.cdcPrice);
      return {
        no: i + 1,
        description: (l.description || l.invoiceDescription || '').trim().toUpperCase(),
        cdcRef: l.cdcRef ?? '',
        qty: n(l.pcs),
        cdcUnit: l.cdcUnit ?? '',
        unitPrice,
        amount: round(unitPrice * n(l.pcs), 2),
        packages: n(l.ctns),
        nw: n(l.nw),
        gw: n(l.gw),
      };
    });
    const sum = (k: 'qty' | 'amount' | 'packages' | 'nw' | 'gw') =>
      round(
        rows.reduce((s, r) => s + r[k], 0),
        k === 'amount' ? 2 : 3,
      );
    return {
      supplier: (h.shipperName ?? '').toUpperCase(),
      supplierAddress,
      invoiceNo: inv[0]!.invoiceNo,
      invoiceDate: inv[0]!.invoiceDate,
      consignee: {
        company,
        address,
        attn: h.contactName
          ? `ATTN: ${h.contactName.toUpperCase()}${phone ? ` TEL ${phone}` : ''}`
          : '',
        vat: h.vattin ? `VAT# ${h.vattin}` : '',
      },
      origin: (h.originName ?? '').toUpperCase(),
      terms: `CIF ${cifPlace(h.portName)}`.trim(),
      unit,
      lines: rows,
      totals: {
        qty: sum('qty'),
        amount: sum('amount'),
        packages: sum('packages'),
        nw: sum('nw'),
        gw: sum('gw'),
      },
      containers,
    };
  });
  const invoiceMissing = [
    !invoices.length && 'Cargo invoices with their items (Invoice / PL tab)',
    !h.shipperName?.trim() && 'Shipper (General tab)',
  ].filter((x): x is string => !!x);

  // ---- Cover letter ----
  const profile = letterProfile(h);
  const coverMissing = [
    !profile && `${h.clientName}'s letter signatory (Client Details)`,
    !h.cdcNo && 'CDC no. (Client Details)',
    !h.hblNo?.trim() && 'B/L, AWB or waybill No. (HBL Release tab)',
    !h.portCode && 'Clearance port (HBL Release tab)',
    !invoices.length && 'Cargo invoices (Invoice / PL tab)',
  ].filter((x): x is string => !!x);
  let cover: PermitCover | null = null;
  if (!coverMissing.length && profile) {
    const letterDate = today();
    const total = (k: 'packages' | 'gw' | 'amount') =>
      round(
        invoices.reduce((s, i) => s + i.totals[k], 0),
        k === 'amount' ? 2 : 3,
      );
    cover = {
      company,
      address,
      vattin: h.vattin ?? '',
      lunarDate: khmerLunarText(letterDate),
      solarDate: khmerSolarText(letterDate),
      items: invoices.reduce((s, i) => s + i.lines.length, 0),
      packages: `${total('packages') || n(h.quantity)} ${unit}`,
      gw: total('gw'),
      amount: total('amount'),
      port: portKm(h),
      extensionLetterNo: profile.extensionLetterNo,
      cdcNo: h.cdcNo ?? '',
      cdcIssueDate: dmy(h.cdcIssueDate),
      customsNoteDate: dmy(profile.customsNoteDate),
      invoiceNos: invoices.map((i) => i.invoiceNo).join(', '),
      invoiceDate: invoices[0]!.invoiceDate,
      hblNo: h.hblNo!.trim(),
      hblDate: h.etd,
      signatory: {
        name: profile.signatory.name,
        title: profile.signatory.title,
        titleKm: profile.signatory.titleKm,
      },
    };
  }

  return {
    cover: { missing: coverMissing, data: cover },
    invoices: { missing: invoiceMissing, data: invoiceMissing.length ? [] : invoices },
    authorize,
  };
}
