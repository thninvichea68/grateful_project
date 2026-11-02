import { sql } from 'drizzle-orm';
import type { AuthorizeLetter, AuthorizeLetterResponse } from '@gs/shared';
import { db } from '../../db/client';
import { notFound } from '../../lib/errors';
import { queryRows } from '../../lib/listing';
import { KH_SOLAR_MONTHS, khmerLunarParts, khmerNumber } from '../../lib/khmerDate';
import { BROKER, letterProfile, PORT_KM } from './importInvoicePackingList';

/** The customs office named in the letter; Sihanoukville is written as on the October letter. */
const officeOf = (code: string | null, name: string | null) =>
  code === 'SHV11'
    ? 'សាខាគយនិងរដ្ឋាករកំពង់ផែអន្តរជាតិក្រុងព្រះសីហនុ'
    : `សាខាគយនិងរដ្ឋាករ${(code && PORT_KM[code]) || ` ${name ?? ''}`}`;

/** "2026-10-17" → "17 ខែ 10 ឆ្នាំ 2026", as the letter dates its documents. */
const docDate = (iso: string | null) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} ខែ ${m} ឆ្នាំ ${y}`;
};

/** Zero-width spaces kept in the Excel strings for line breaking are left out here. */
const plain = (s: string) => s.replace(/\u200b/g, '');

interface Row {
  direction: string;
  clientCode: string;
  clientName: string;
  legalName: string | null;
  vattin: string | null;
  hblNo: string | null;
  etd: string | null;
  portCode: string | null;
  portName: string | null;
  authorizeDate: string | null;
  invoices: { no: string; date: string | null }[];
  signatoryName: string | null;
  signatoryIdNo: string | null;
  signatoryTitle: string | null;
  signatoryTitleKm: string | null;
  letterPhone: string | null;
  cdcExtensionLetterNo: string | null;
  customsNoteDate: string | null;
}

/** The letter for a saved import, or the list of what it still needs. */
export async function authorizeLetter(shipmentId: string): Promise<AuthorizeLetterResponse> {
  const [r] = await queryRows<Row>(
    db,
    sql`
    SELECT s.direction, c.code AS "clientCode", c.name AS "clientName", c.legal_name AS "legalName",
           c.vattin, s.hbl_no AS "hblNo", to_char(s.etd, 'YYYY-MM-DD') AS etd,
           p.code AS "portCode", p.name AS "portName",
           to_char(s.authorize_date, 'YYYY-MM-DD') AS "authorizeDate",
           c.signatory_name AS "signatoryName", c.signatory_id_no AS "signatoryIdNo",
           c.signatory_title AS "signatoryTitle", c.signatory_title_km AS "signatoryTitleKm",
           c.letter_phone AS "letterPhone", c.cdc_extension_letter_no AS "cdcExtensionLetterNo",
           to_char(c.customs_note_date, 'YYYY-MM-DD') AS "customsNoteDate",
           coalesce((SELECT json_agg(json_build_object('no', ci.invoice_no,
                                                       'date', to_char(ci.invoice_date, 'YYYY-MM-DD'))
                                     ORDER BY ci.sort_order, ci.invoice_no)
                     FROM cargo_invoices ci WHERE ci.shipment_id = s.id), '[]') AS invoices
    FROM shipments s JOIN clients c ON c.id = s.client_id
    LEFT JOIN ports p ON p.id = s.clearance_port_id
    WHERE s.id = ${shipmentId} AND s.deleted_at IS NULL`,
  );
  if (!r) throw notFound('Shipment');

  // The owner of the goods: the client's letter signatory (Client Details).
  const profile = letterProfile(r);
  const owner = profile && {
    name: profile.signatory.name,
    idNo: profile.signatory.passportNo,
    phone: profile.companyPhone,
  };
  const invoices = r.invoices.filter((i) => i.no?.trim());
  const missing = [
    r.direction !== 'IMPORT' && 'The transfer of rights is for imports only',
    !owner && `${r.clientName}'s letter signatory (Client Details)`,
    !invoices.length && 'Invoice No. (Invoice / PL tab)',
    !r.hblNo?.trim() && 'B/L, AWB or waybill No. (HBL Release tab)',
    !r.portCode && 'Clearance port (HBL Release tab)',
    !r.authorizeDate && 'Authorize Date',
  ].filter((x): x is string => !!x);
  if (missing.length || !owner) return { missing, letter: null };

  const invNo = invoices.map((i) => i.no).join(', ');
  const invDate = docDate(invoices[0]!.date);
  const [ey, em, ed] = BROKER.cardExpiry.split('-').map(Number) as [number, number, number];
  const lunar = khmerLunarParts(r.authorizeDate!);
  const [y, m, d] = r.authorizeDate!.split('-').map(Number) as [number, number, number];

  const letter: AuthorizeLetter = {
    title: `AUTHORIZE ${invNo}`,
    owner: {
      name: owner.name,
      idNo: owner.idNo,
      company: r.legalName ?? r.clientName,
      vattin: r.vattin ?? '',
      phone: owner.phone,
    },
    broker: {
      company: BROKER.company,
      vattin: BROKER.vattin,
      grantee: { ...BROKER.grantee, phone: plain(BROKER.grantee.phone) },
      agent: { ...BROKER.agent, phone: plain(BROKER.agent.phone) },
      cardNo: BROKER.cardNo,
      cardExpiry: `${ed} ខែ ${KH_SOLAR_MONTHS[em - 1]} ឆ្នាំ ${ey}`,
    },
    office: officeOf(r.portCode, r.portName),
    documents: [
      { label: 'វិក្កយប័ត្រ(Invoice)លេខ', no: invNo, date: invDate },
      { label: 'បញ្ជីវេចខ្ចប់(Packing List)លេខ', no: invNo, date: invDate },
      { label: 'អញ្ញាតប័ណ្ណ(B/L,AWB,TWB)លេខ', no: r.hblNo!.trim(), date: docDate(r.etd) },
    ],
    lunarDate: `ថ្ងៃ${lunar.weekday} ${lunar.day} ខែ${lunar.month} ឆ្នាំ${lunar.animal} ${lunar.era} ព.ស. ${lunar.be}`,
    madeAt: `ធ្វើនៅភ្នំពេញថ្ងៃទី${khmerNumber(d)} ខែ${KH_SOLAR_MONTHS[m - 1]}ឆ្នាំ${khmerNumber(y)}`,
  };
  return { missing: [], letter };
}
