import { parseCsv } from "@/features/imports/spreadsheet";
import { normalizeReferralCode, OFFER_SUMMARY } from "@/features/subscriptions/referral-program";
import { PARTNER_TYPE_LABELS, PARTNER_TYPES, partnerSignupLink, type PartnerType } from "./partner-payouts";

/**
 * Partner codes in bulk (Conor, 2026-10-13): "if gabe has a spreadsheet with
 * 200 partners he can easily generate codes for them all. then he should be
 * able to export the file again to give to his ai agent like Muse".
 *
 * - **In:** any CSV with a name in it. Columns are matched by what they mean
 *   ("Contact", "Company", "Vendor type"), so the sheet Gabe already keeps
 *   works as it is.
 * - **Codes:** a code in the sheet is used as written. A row without one gets
 *   one made from the business (or the person's name), so 200 partners need
 *   no typing. Two rows that would make the same code get 2, 3… on the end.
 * - **Already a partner** (same email, or the sheet's code is theirs): skipped,
 *   never made twice, so the same sheet can go in again after fixing a row.
 * - **Out:** one row per partner with their code, their signup link and the
 *   offer in words, which is what an agent writing to them needs.
 *
 * The server checks every code again (functions/src/console/handlers/partners.ts):
 * a code taken by a discount or a studio gets a number on the end if it was
 * made here, and is refused if it came from the sheet.
 */

export const PARTNER_IMPORT_MAX = 500;
/** Rows per command, so a long sheet never runs into a request timeout. */
export const PARTNER_IMPORT_CHUNK = 50;

export const partnerImportFields = ["name", "firstName", "lastName", "business", "email", "phone", "type", "code", "payoutHandle", "notes"] as const;
export type PartnerImportField = (typeof partnerImportFields)[number];

export const partnerImportFieldLabels: Record<PartnerImportField, string> = {
  name: "Name",
  firstName: "First name",
  lastName: "Last name",
  business: "Business",
  email: "Email",
  phone: "Phone",
  type: "Type",
  code: "Code",
  payoutHandle: "How you pay them",
  notes: "Notes",
};

/** Header words, compared with everything but letters and digits removed. */
const ALIASES: Record<PartnerImportField, string[]> = {
  name: ["name", "fullname", "contact", "contactname", "partner", "partnername", "person", "vendorcontact"],
  firstName: ["firstname", "first", "givenname"],
  lastName: ["lastname", "last", "surname", "familyname"],
  business: ["business", "businessname", "company", "companyname", "vendor", "vendorname", "brand", "studio", "organization", "organisation"],
  email: ["email", "emailaddress", "mail", "contactemail"],
  phone: ["phone", "phonenumber", "mobile", "cell", "tel", "telephone"],
  type: ["type", "vendortype", "category", "service", "services", "role", "trade", "kind", "partnertype"],
  code: ["code", "referralcode", "partnercode", "promocode"],
  payoutHandle: ["payout", "payouthandle", "howtopay", "payment", "paymenthandle", "venmo", "zelle", "paypal", "payto"],
  notes: ["notes", "note", "comments", "comment"],
};

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export type PartnerColumns = Partial<Record<PartnerImportField, number>>;

/** Which column holds what. Exact header matches first, so "Business name" never lands on Name. */
export function detectPartnerColumns(header: string[]): PartnerColumns {
  const columns: PartnerColumns = {};
  const taken = new Set<number>();
  const keys = header.map(squash);
  for (const field of partnerImportFields) {
    const index = keys.findIndex((key, position) => !taken.has(position) && ALIASES[field].includes(key));
    if (index >= 0) {
      columns[field] = index;
      taken.add(index);
    }
  }
  return columns;
}

/** "Wedding planner", "Hair & Makeup", "MUA", "Disc jockey" → a partner type. Earliest word wins. */
export function partnerTypeFromLabel(raw: string): PartnerType {
  const text = raw.toLowerCase();
  if (PARTNER_TYPES.includes(text.trim() as PartnerType)) return text.trim() as PartnerType;
  const hits: Array<[number, PartnerType]> = [];
  const find = (pattern: RegExp, type: PartnerType) => {
    const match = pattern.exec(text);
    if (match) hits.push([match.index, type]);
  };
  find(/plann|coordinat/, "planner");
  find(/\bdj\b|disc ?jockey|deejay|music|entertain/, "dj");
  find(/hair|stylist|salon/, "hair");
  find(/make ?up|\bmua\b|beauty|cosmetic/, "makeup");
  hits.sort((a, b) => a[0] - b[0]);
  return hits[0]?.[1] ?? "other";
}

const FILLER = /\b(LLC|INC|CO|LTD|THE|AND|EVENTS?|WEDDINGS?|DESIGNS?|SERVICES?|STUDIOS?|BY)\b/g;

/** A code from the business, else the person: "Bella Bridal Beauty LLC" → "BELLABRIDALBEAUTY". */
export function partnerCodeStem(input: { name: string; business?: string | null; type: PartnerType }): string {
  const compact = (value: string, strip: boolean) => {
    const upper = value.toUpperCase().replace(/&/g, " ");
    return (strip ? upper.replace(FILLER, " ") : upper).replace(/[^A-Z0-9]/g, "");
  };
  const business = input.business?.trim() ?? "";
  let stem = business ? compact(business, true) : "";
  if (stem.length < 4 && business) stem = compact(business, false);
  if (stem.length < 4) stem = compact(input.name, false);
  if (stem.length < 4) stem = `${stem}${input.type === "other" ? "PARTNER" : input.type.toUpperCase()}`;
  return stem.slice(0, 16);
}

/** No 0/O or 1/I, so a code read aloud or off a phone is typed right. */
const SUFFIX_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const PARTNER_CODE_SUFFIX = 4;

/**
 * A made code is the partner's name plus four random characters, never the
 * name alone (Conor, 2026-10-13: "I don't want codes to just be the partners
 * name. Make it more unique"): MIKEYB → MIKEYB7KQX. Still readable as theirs,
 * not guessable, and two partners with one name never collide.
 */
export function makePartnerCode(stem: string, taken: (code: string) => boolean, random: () => number = Math.random): string {
  const head = stem.slice(0, 20 - PARTNER_CODE_SUFFIX - 6);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let suffix = "";
    for (let index = 0; index < PARTNER_CODE_SUFFIX; index += 1) suffix += SUFFIX_ALPHABET[Math.floor(random() * SUFFIX_ALPHABET.length)];
    const code = `${head}${suffix}`;
    if (!taken(code)) return code;
  }
  return `${head}${Date.now().toString(36).toUpperCase().slice(-PARTNER_CODE_SUFFIX)}`;
}

export type PartnerDraft = {
  name: string;
  business: string | null;
  email: string | null;
  phone: string | null;
  type: PartnerType;
  payoutHandle: string | null;
  notes: string | null;
  code: string;
  /** Made here, so the server may add a number if the code turns out to be taken. */
  codeMade: boolean;
};

export type PartnerImportRow =
  | { line: number; status: "ready"; partner: PartnerDraft }
  | { line: number; status: "exists"; label: string; code: string; reason: string }
  | { line: number; status: "problem"; label: string; problems: string[] };

export type ExistingPartner = { code: string; email?: string | null };

/** The sheet, read and checked: what will be made, what's already there, and what needs fixing. */
export function planPartnerImport(text: string, existing: ExistingPartner[], columns?: PartnerColumns, random: () => number = Math.random): { columns: PartnerColumns; header: string[]; rows: PartnerImportRow[]; tooMany: boolean } {
  const [header = [], ...body] = parseCsv(text);
  const map = columns ?? detectPartnerColumns(header);
  const existingCodes = new Set(existing.map((partner) => partner.code));
  const taken = new Set(existingCodes);
  const byEmail = new Map(existing.filter((partner) => partner.email).map((partner) => [partner.email!.toLowerCase(), partner.code]));
  const seenEmails = new Set<string>();
  const cell = (cells: string[], field: PartnerImportField) => {
    const index = map[field];
    return index === undefined ? "" : (cells[index] ?? "").trim();
  };
  const rows: PartnerImportRow[] = [];
  // Codes from the sheet are claimed first, so a made code never takes one a later row asked for.
  for (const cells of body) {
    const sheetCode = normalizeReferralCode(cell(cells, "code"));
    if (sheetCode && !byEmail.has(cell(cells, "email").toLowerCase())) taken.add(sheetCode);
  }
  const sheetCodesUsed = new Set<string>();
  body.forEach((cells, index) => {
    const line = index + 2;
    const name = cell(cells, "name") || [cell(cells, "firstName"), cell(cells, "lastName")].filter(Boolean).join(" ");
    const business = cell(cells, "business") || null;
    const email = cell(cells, "email").toLowerCase() || null;
    const label = business || name || email || `Row ${line}`;
    const rawCode = cell(cells, "code");
    const sheetCode = rawCode ? normalizeReferralCode(rawCode) : null;
    const known = email ? byEmail.get(email) : undefined;
    if (known || (sheetCode && existingCodes.has(sheetCode))) {
      rows.push({ line, status: "exists", label, code: known ?? sheetCode!, reason: known ? "Already a partner with this email" : "Already a partner with this code" });
      return;
    }
    const problems: string[] = [];
    const personName = name || business || "";
    if (personName.length < 2) problems.push("No name");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(`"${email}" isn't an email`);
    if (email && seenEmails.has(email)) problems.push("Same email as a row above");
    if (rawCode && !sheetCode) problems.push(`Code "${rawCode}" must be 4 to 20 letters and numbers`);
    if (sheetCode && sheetCodesUsed.has(sheetCode)) problems.push(`Code ${sheetCode} is on a row above`);
    if (problems.length) {
      rows.push({ line, status: "problem", label, problems });
      return;
    }
    if (email) seenEmails.add(email);
    const type = partnerTypeFromLabel(cell(cells, "type"));
    let code: string;
    if (sheetCode) {
      sheetCodesUsed.add(sheetCode);
      code = sheetCode;
    } else {
      code = makePartnerCode(partnerCodeStem({ name: personName, business, type }), (candidate) => taken.has(candidate), random);
      taken.add(code);
    }
    rows.push({
      line,
      status: "ready",
      partner: {
        name: personName.slice(0, 120),
        business: business?.slice(0, 160) ?? null,
        email,
        phone: cell(cells, "phone").slice(0, 40) || null,
        type,
        payoutHandle: cell(cells, "payoutHandle").slice(0, 160) || null,
        notes: cell(cells, "notes").slice(0, 2000) || null,
        code,
        codeMade: !sheetCode,
      },
    });
  });
  return { columns: map, header, rows, tooMany: rows.filter((row) => row.status === "ready").length > PARTNER_IMPORT_MAX };
}

export const partnerImportTemplateCsv = [
  "Name,Business,Email,Phone,Type,Code,How you pay them,Notes",
  "Sarah Lee,Sarah Lee Makeup,sarah@example.com,555-0100,Makeup,SARAHMUA,Venmo @sarah-mua,",
  "Mike Ortiz,DJ Mike Events,mike@example.com,555-0101,DJ,,Zelle mike@example.com,Code is made for you when blank",
].join("\n");

export type PartnerExportRow = {
  code: string;
  name: string;
  business?: string | null;
  email?: string | null;
  phone?: string | null;
  type: PartnerType;
  payoutHandle?: string | null;
  notes?: string | null;
  active?: boolean;
  signedUp?: number;
  counted?: number;
  owedCents?: number;
};

export const PARTNER_EXPORT_HEADER = [
  "Name",
  "Business",
  "Email",
  "Phone",
  "Type",
  "Code",
  "Signup link",
  "Code works",
  "What a photographer gets",
  "How you pay them",
  "Signed up",
  "Referrals that count",
  "Owed ($)",
  "Notes",
];

/** One row per partner, for a spreadsheet or an agent writing to them. */
export function partnerExportRows(origin: string, partners: PartnerExportRow[]): Array<Array<string | number>> {
  return [...partners]
    .sort((a, b) => (a.business || a.name).localeCompare(b.business || b.name, "en") || a.code.localeCompare(b.code, "en", { numeric: true }))
    .map((partner) => [
      partner.name,
      partner.business ?? "",
      partner.email ?? "",
      partner.phone ?? "",
      PARTNER_TYPE_LABELS[partner.type] ?? "Other",
      partner.code,
      partnerSignupLink(origin, partner.code),
      partner.active === false ? "No" : "Yes",
      OFFER_SUMMARY,
      partner.payoutHandle ?? "",
      partner.signedUp ?? 0,
      partner.counted ?? 0,
      Math.max(0, partner.owedCents ?? 0) / 100,
      partner.notes ?? "",
    ]);
}
