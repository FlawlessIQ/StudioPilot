import type { ExistingBooking } from "./existing-booking";

/**
 * Turning a studio's exported spreadsheet into bookings to review.
 *
 * Every tool a studio leaves — HoneyBook, Dubsado, Studio Ninja, 17hats, a
 * spreadsheet kept by hand — exports a CSV, and no two name their columns the
 * same way: "Wedding Date", "Event Date", "Project Date"; "Client", "Contact
 * Name", "First Name" and "Last Name". So columns are matched by what they
 * mean, the studio can correct any match, and each row becomes either a
 * booking to check or a plain-language list of what's missing.
 *
 * Nothing here decides whether a booking may be imported. That is
 * assessExistingBooking on the server, the same check the one-at-a-time form
 * uses. This only reads the sheet faithfully, and refuses to guess where the
 * sheet is ambiguous — a date like 03/04/2027 is read month-first, the US
 * convention every one of those tools exports in, and said so.
 */

/** RFC 4180: quoted fields, doubled quotes, newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === "") quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

export const spreadsheetFields = [
  "clientName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "partnerName",
  "partnerEmail",
  "eventDate",
  "eventType",
  "venueName",
  "city",
  "packageName",
  "total",
  "tax",
  "paid",
  "paidOn",
  "signedOn",
  "coverageHours",
  "photographers",
  "notes",
] as const;
export type SpreadsheetField = (typeof spreadsheetFields)[number];

export const spreadsheetFieldLabels: Record<SpreadsheetField, string> = {
  clientName: "Client name (full)",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  partnerName: "Partner's name",
  partnerEmail: "Partner's email",
  eventDate: "Event date",
  eventType: "Event type",
  venueName: "Venue",
  city: "City",
  packageName: "Package",
  total: "Contract total",
  tax: "Tax",
  paid: "Amount paid",
  paidOn: "Date paid",
  signedOn: "Date signed or booked",
  coverageHours: "Coverage hours",
  photographers: "Photographers",
  notes: "Notes",
};

/** What each field is called across the exports studios actually bring. */
const synonyms: Record<SpreadsheetField, string[]> = {
  clientName: ["client", "client name", "name", "contact", "contact name", "full name", "primary contact", "couple", "couple name", "customer", "customer name"],
  firstName: ["first name", "firstname", "client first name", "given name", "first"],
  lastName: ["last name", "lastname", "client last name", "surname", "family name", "last"],
  email: ["email", "email address", "client email", "primary email", "e-mail", "contact email"],
  phone: ["phone", "phone number", "mobile", "cell", "client phone", "telephone"],
  partnerName: ["partner", "partner name", "second client", "fiance", "fiancé", "fiancee", "spouse", "partner full name"],
  partnerEmail: ["partner email", "second client email", "fiance email", "fiancé email"],
  eventDate: ["event date", "wedding date", "project date", "date of event", "session date", "start date", "shoot date"],
  eventType: ["event type", "project type", "type", "category", "job type"],
  venueName: ["venue", "venue name", "location", "event location", "ceremony venue", "reception venue"],
  city: ["city", "event city", "town"],
  packageName: ["package", "package name", "collection", "service", "services", "product", "offering"],
  total: ["total", "contract total", "project total", "booking total", "contract amount", "amount", "price", "total price", "booking value", "invoice total"],
  tax: ["tax", "sales tax", "tax amount"],
  paid: ["paid", "amount paid", "total paid", "paid to date", "payments received", "deposit", "deposit paid", "retainer", "retainer paid", "received"],
  paidOn: ["paid date", "payment date", "date paid", "deposit date", "retainer date", "last payment date"],
  signedOn: ["signed", "signed date", "date signed", "contract signed", "contract signed date", "booked", "booked date", "booking date", "date booked"],
  coverageHours: ["hours", "coverage", "coverage hours", "hours of coverage"],
  photographers: ["photographers", "number of photographers", "shooters", "crew size"],
  notes: ["notes", "note", "comments", "internal notes"],
};

const normalise = (value: string) =>
  value.toLowerCase().replace(/[_\-.:/()#*]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Which column holds which field, by header.
 *
 * Exact names first. Then, for headers no exact name claimed, the field whose
 * name is the longest part of the header — so "Deposit Amount" is what was
 * paid, not the contract total, even though it contains "amount". No column
 * is used twice: "Email" must not also be taken as "Partner email".
 */
export function detectColumns(
  headers: readonly string[],
): Partial<Record<SpreadsheetField, number>> {
  const normalised = headers.map(normalise);
  const mapping: Partial<Record<SpreadsheetField, number>> = {};
  const taken = new Set<number>();
  for (const field of spreadsheetFields) {
    const index = normalised.findIndex(
      (header, at) => !taken.has(at) && synonyms[field].includes(header),
    );
    if (index >= 0) {
      mapping[field] = index;
      taken.add(index);
    }
  }
  normalised.forEach((header, index) => {
    if (taken.has(index)) return;
    let best: { field: SpreadsheetField; length: number } | null = null;
    for (const field of spreadsheetFields) {
      if (mapping[field] !== undefined) continue;
      for (const name of synonyms[field]) {
        if (name.length >= 4 && header.includes(name) && name.length > (best?.length ?? 0))
          best = { field, length: name.length };
      }
    }
    if (best) {
      mapping[best.field] = index;
      taken.add(index);
    }
  });
  return mapping;
}

const months: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (value: number) => String(value).padStart(2, "0");

function validDate(year: number, month: number, day: number): string | null {
  const iso = `${year}-${pad(month)}-${pad(day)}`;
  const parsed = new Date(`${iso}T12:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === iso
    ? iso
    : null;
}

/**
 * A date as a studio's export writes it. Month-first for slashed dates: the
 * US convention these tools export in. Two-digit years are 20xx.
 */
export function parseSpreadsheetDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/);
  if (match) {
    const year = match[3]!.length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return validDate(year, Number(match[1]), Number(match[2]));
  }
  // "June 12, 2027", "Jun 12 2027", "12 June 2027", "Saturday, June 12, 2027"
  const words = value.toLowerCase().replace(/,/g, " ").split(/\s+/).filter(Boolean);
  let month: number | undefined;
  let day: number | undefined;
  let year: number | undefined;
  for (const word of words) {
    const name = months[word.slice(0, 4)] ?? months[word.slice(0, 3)];
    if (name && month === undefined) month = name;
    else if (/^\d{4}$/.test(word)) year = Number(word);
    else if (/^\d{1,2}(st|nd|rd|th)?$/.test(word)) day = Number(word.replace(/\D/g, ""));
  }
  return month && day && year ? validDate(year, month, day) : null;
}

/** "$6,499.00", "6499", "USD 6,499" → cents. Blank is null, nonsense is NaN. */
export function parseSpreadsheetMoney(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const negative = /^\(.*\)$/.test(value) || value.startsWith("-");
  const digits = value.replace(/[^\d.]/g, "");
  if (!digits || digits.split(".").length > 2) return Number.NaN;
  const cents = Math.round(Number(digits) * 100);
  return negative ? -cents : cents;
}

function splitName(raw: string): { first: string; last: string } {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

/**
 * "Maya & Theo Johnson" in one cell: two people sharing a surname. Also
 * "Maya Johnson and Theo Reed".
 */
function splitCouple(raw: string): Array<{ first: string; last: string }> {
  const halves = raw.split(/\s+(?:&|and|\+)\s+/i).map((part) => part.trim()).filter(Boolean);
  if (halves.length !== 2) return [splitName(raw)];
  const first = splitName(halves[0]!);
  const second = splitName(halves[1]!);
  if (!first.last && second.last) first.last = second.last;
  return [first, second];
}

const eventTypes: Record<string, { id: string; label: string }> = {
  wedding: { id: "wedding", label: "Wedding" },
  corporate: { id: "corporate", label: "Corporate" },
  sports: { id: "sports", label: "Sports" },
};

export type SpreadsheetRowResult =
  | { row: number; booking: ExistingBooking; notes: string[] }
  | { row: number; problems: string[] };

/**
 * One row, as a booking to check or as what's missing from it.
 *
 * A sheet records what was paid as a single figure more often than a payment
 * history, so that figure becomes one payment dated when it was paid — or, if
 * the sheet doesn't say, when the contract was signed, and a note says so.
 */
export function bookingFromSpreadsheetRow(input: {
  row: number;
  cells: readonly string[];
  columns: Partial<Record<SpreadsheetField, number>>;
  timezone: string;
}): SpreadsheetRowResult {
  const get = (field: SpreadsheetField) => {
    const index = input.columns[field];
    return index === undefined ? "" : String(input.cells[index] ?? "").trim();
  };
  const problems: string[] = [];
  const notes: string[] = [];

  let people: Array<{ first: string; last: string }> = [];
  if (get("firstName") || get("lastName")) {
    people.push({ first: get("firstName"), last: get("lastName") });
    if (get("partnerName")) people.push(splitName(get("partnerName")));
  } else if (get("clientName")) {
    people = splitCouple(get("clientName"));
    if (people.length === 1 && get("partnerName")) people.push(splitName(get("partnerName")));
  }
  const primary = people[0];
  if (!primary?.first || !primary.last)
    problems.push("No client first and last name.");
  const second = people[1];
  if (second && !second.last && primary?.last) second.last = primary.last;

  const email = get("email").toLowerCase();
  if (!email) problems.push("No client email.");

  const eventDateRaw = get("eventDate");
  const eventDate = parseSpreadsheetDate(eventDateRaw);
  if (!eventDateRaw) problems.push("No event date.");
  else if (!eventDate) problems.push(`Couldn't read the event date "${eventDateRaw}".`);

  const signedRaw = get("signedOn");
  const signedOn = parseSpreadsheetDate(signedRaw);
  if (!signedRaw) problems.push("No date signed or booked.");
  else if (!signedOn) problems.push(`Couldn't read the signing date "${signedRaw}".`);

  const total = parseSpreadsheetMoney(get("total"));
  if (total === null) problems.push("No contract total.");
  else if (!Number.isFinite(total) || total < 0)
    problems.push(`Couldn't read the contract total "${get("total")}".`);

  const tax = parseSpreadsheetMoney(get("tax"));
  if (tax !== null && (!Number.isFinite(tax) || tax < 0))
    problems.push(`Couldn't read the tax "${get("tax")}".`);

  const paid = parseSpreadsheetMoney(get("paid"));
  if (paid !== null && (!Number.isFinite(paid) || paid < 0))
    problems.push(`Couldn't read the amount paid "${get("paid")}".`);
  const paidOnRaw = get("paidOn");
  const paidOn = paidOnRaw ? parseSpreadsheetDate(paidOnRaw) : null;
  if (paidOnRaw && !paidOn) problems.push(`Couldn't read the payment date "${paidOnRaw}".`);

  const hoursRaw = get("coverageHours");
  const hours = hoursRaw ? Number(hoursRaw.replace(/[^\d.]/g, "")) : 8;
  if (hoursRaw && !(hours > 0 && hours <= 24))
    problems.push(`Couldn't read the coverage hours "${hoursRaw}".`);
  else if (!hoursRaw) notes.push("Coverage isn't in the sheet, so it's set to 8 hours.");
  const photographersRaw = get("photographers");
  const photographers = photographersRaw ? Number(photographersRaw.replace(/\D/g, "")) : 1;
  if (photographersRaw && !(Number.isInteger(photographers) && photographers >= 1 && photographers <= 10))
    problems.push(`Couldn't read the number of photographers "${photographersRaw}".`);

  if (problems.length) return { row: input.row, problems };

  const type =
    eventTypes[get("eventType").toLowerCase()] ??
    Object.values(eventTypes).find((candidate) =>
      get("eventType").toLowerCase().includes(candidate.id),
    ) ??
    eventTypes.wedding!;
  if (!get("eventType")) notes.push("No event type in the sheet, so it's a wedding.");

  const payments =
    paid && paid > 0
      ? [
          {
            amountCents: paid,
            paidOn: paidOn ?? signedOn!,
            method: "Paid before StudioCue",
          },
        ]
      : [];
  if (paid && paid > 0 && !paidOn)
    notes.push("No payment date in the sheet, so it's dated when the contract was signed.");

  return {
    row: input.row,
    notes,
    booking: {
      clients: [
        {
          firstName: primary!.first,
          lastName: primary!.last,
          email,
          phone: get("phone") || null,
        },
        ...(second?.first
          ? [
              {
                firstName: second.first,
                lastName: second.last || primary!.last,
                email: get("partnerEmail").toLowerCase() || null,
                phone: null,
              },
            ]
          : []),
      ],
      projectName: null,
      eventTypeId: type.id,
      eventType: type.label,
      eventDate: eventDate!,
      timezone: input.timezone,
      venueName: get("venueName") || null,
      city: get("city") || null,
      state: "BOOKED",
      packageName: get("packageName") || `${type.label} photography`,
      coverageMinutes: Math.round(hours * 60),
      photographers,
      currency: "USD",
      totalCents: total!,
      taxCents: tax ?? 0,
      signedOn: signedOn!,
      signerName: `${primary!.first} ${primary!.last}`,
      hasSignedCopy: false,
      payments,
      notes: get("notes") || null,
    },
  };
}

/** A starting sheet for a studio with nothing to export. */
export const spreadsheetTemplateCsv = [
  "First name,Last name,Email,Phone,Partner's name,Partner's email,Event date,Event type,Venue,City,Package,Contract total,Tax,Amount paid,Date paid,Date signed,Coverage hours,Photographers,Notes",
  "Maya,Johnson,maya@example.com,555-0100,Theo Johnson,,2027-06-12,Wedding,The Grove,Madison,Signature Collection,6499,429,2000,2026-03-02,2026-03-02,8,2,",
].join("\n");
