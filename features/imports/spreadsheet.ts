import { tradeOf, tradeProfile } from "@/features/trades/trades";
import { importStateLabels, type ExistingBooking, type ImportableBookingState } from "./existing-booking";
import { cellKind, crewRoleFromHeader, hasWords, importCrewRoles, readCrewCell, readTime, type CellKind, type CrewRole } from "./sheet-columns";
import { JOB_KIND_LABELS, JOB_KINDS, jobKindFromLabel } from "@/features/job-kinds/job-kinds";

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
  "startTime",
  "eventType",
  "status",
  "venueName",
  "city",
  "packageName",
  "total",
  "tax",
  "paid",
  "paidOn",
  "signedOn",
  "coverageHours",
  "teamSize",
  "galleryUrl",
  "deliveredOn",
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
  startTime: "Start time",
  eventType: "Event type",
  status: "Job status",
  venueName: "Venue",
  city: "City",
  packageName: "Package",
  total: "Contract total",
  tax: "Tax",
  paid: "Amount paid",
  paidOn: "Date paid",
  signedOn: "Date signed or booked",
  coverageHours: "Hours",
  teamSize: "Team size",
  galleryUrl: "Gallery link",
  deliveredOn: "Date delivered",
  notes: "Notes",
};

/** A field's name for this studio: a vendor's "Hours" aren't "coverage". */
export function spreadsheetFieldLabel(field: SpreadsheetField, trade?: unknown): string {
  if (field === "coverageHours") return tradeOf(trade) === "photographer" ? "Coverage hours" : "Hours";
  return spreadsheetFieldLabels[field];
}

/** What each field is called across the exports studios actually bring. */
const synonyms: Record<SpreadsheetField, string[]> = {
  clientName: ["client", "client name", "name", "contact", "contact name", "full name", "primary contact", "couple", "couple name", "customer", "customer name", "bride", "bride name", "booked by", "client full name"],
  firstName: ["first name", "firstname", "client first name", "given name", "first"],
  lastName: ["last name", "lastname", "client last name", "surname", "family name", "last"],
  email: ["email", "email address", "client email", "primary email", "e mail", "contact email", "bride email"],
  phone: ["phone", "phone number", "mobile", "cell", "client phone", "telephone", "bride phone"],
  partnerName: ["partner", "partner name", "second client", "fiance", "fiancé", "fiancee", "spouse", "partner full name", "groom", "groom name"],
  partnerEmail: ["partner email", "second client email", "fiance email", "fiancé email", "groom email"],
  eventDate: ["event date", "wedding date", "project date", "date of event", "session date", "start date", "shoot date", "date"],
  startTime: ["start time", "event time", "time", "start", "ready by", "ready by time", "call time", "arrival time", "start of day"],
  eventType: ["event type", "project type", "type", "category", "job type"],
  status: ["status", "stage", "job status", "project status", "booking status", "workflow status"],
  venueName: ["venue", "venue name", "location", "event location", "ceremony venue", "reception venue"],
  city: ["city", "event city", "town"],
  packageName: ["package", "package name", "collection", "service", "services", "product", "offering"],
  total: ["total", "contract total", "project total", "booking total", "contract amount", "amount", "price", "total price", "booking value", "invoice total"],
  tax: ["tax", "sales tax", "tax amount"],
  paid: ["paid", "amount paid", "total paid", "paid to date", "payments received", "deposit", "deposit paid", "retainer", "retainer paid", "received"],
  paidOn: ["paid date", "payment date", "date paid", "deposit date", "retainer date", "last payment date"],
  signedOn: ["signed", "signed date", "date signed", "contract signed", "contract signed date", "booked", "booked date", "booked on", "booking date", "date booked"],
  coverageHours: ["hours", "coverage", "coverage hours", "hours of coverage", "hours on site", "duration"],
  // A total headcount, read only when the sheet has no column per role.
  teamSize: ["crew", "staff", "team", "team size", "crew size", "number of staff"],
  galleryUrl: ["gallery", "gallery link", "gallery url", "online gallery"],
  deliveredOn: ["delivered", "delivered on", "date delivered", "delivery date", "gallery delivered"],
  notes: ["notes", "note", "comments", "internal notes"],
};

const normalise = (value: string) =>
  value.toLowerCase().replace(/['’]s\b/g, "").replace(/[_\-.:/()#*?]+/g, " ").replace(/\s+/g, " ").trim();

/** A column that counts or names the studio's own crew. */
export type CrewColumn = { index: number; role: CrewRole; extra: boolean; kind: CellKind };

/**
 * Which column holds which field, by header.
 *
 * Whole words only (2026-10-26): "Assistant Names" used to contain "name" and
 * become the client. Exact names first; then, for headers no exact name
 * claimed, the field whose name is the longest whole-word part of the header,
 * so "Deposit Amount" is what was paid. A header naming a crew role is never
 * a field (detectCrewColumns has it). No column is used twice.
 */
export function detectColumns(
  headers: readonly string[],
  trade?: unknown,
): Partial<Record<SpreadsheetField, number>> {
  const normalised = headers.map(normalise);
  const crew = new Set(headers.map((header, index) => (crewRoleFromHeader(header, trade) ? index : -1)).filter((index) => index >= 0));
  const mapping: Partial<Record<SpreadsheetField, number>> = {};
  const taken = new Set<number>(crew);
  for (const field of spreadsheetFields) {
    const index = normalised.findIndex((header, at) => !taken.has(at) && synonyms[field].map(normalise).includes(header));
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
      for (const name of synonyms[field].map(normalise)) {
        if (name.length >= 4 && hasWords(header, name) && name.length > (best?.length ?? 0)) best = { field, length: name.length };
      }
    }
    if (best) {
      mapping[best.field] = index;
      taken.add(index);
    }
  });
  return mapping;
}

/** The columns that count or name the studio's crew, read by what's in them. */
export function detectCrewColumns(headers: readonly string[], trade: unknown, rows: readonly (readonly string[])[]): CrewColumn[] {
  return headers.flatMap((header, index) => {
    const found = crewRoleFromHeader(header, trade);
    return found ? [{ index, role: found.role, extra: found.extra, kind: cellKind(rows.map((row) => String(row[index] ?? ""))) }] : [];
  });
}

/** Columns nothing reads: kept in each job's notes so nothing is lost. */
export function unusedColumns(
  headers: readonly string[],
  fields: Partial<Record<SpreadsheetField, number>>,
  crew: readonly CrewColumn[],
): number[] {
  const used = new Set<number>([...Object.values(fields), ...crew.map((column) => column.index)]);
  return headers.map((_, index) => index).filter((index) => !used.has(index) && headers[index]!.trim());
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

const eventTypes: Record<string, { id: string; label: string }> = Object.fromEntries(
  JOB_KINDS.map((kind) => [kind, { id: kind, label: JOB_KIND_LABELS[kind] }]),
);

/** A day's hours when the sheet doesn't say, by what the studio does. */
const DEFAULT_HOURS: Record<string, number> = { photographer: 8, dj: 5, makeup: 2, hair: 2, planner: 10 };

/** A job status as studios write it, to where it is now. */
export function stateFromStatus(raw: string): ImportableBookingState | null {
  const value = normalise(raw);
  if (!value) return null;
  if (/\b(closed|finished|archived|complete and paid|paid in full|wrapped)\b/.test(value)) return "CLOSED";
  if (/\b(delivered|gallery sent|sent to client)\b/.test(value)) return "DELIVERED";
  if (/\b(editing|in edit|culling|post production|post|retouching|in progress)\b/.test(value)) return "POST_PRODUCTION";
  if (/\b(event done|shot|completed|complete|happened|done)\b/.test(value)) return "EVENT_COMPLETE";
  if (/\b(planning|prep|questionnaire)\b/.test(value)) return "PLANNING";
  if (/\b(booked|confirmed|signed|retained|contracted|upcoming|active)\b/.test(value)) return "BOOKED";
  return null;
}

export type SpreadsheetRowResult =
  | {
      row: number;
      booking: ExistingBooking;
      notes: string[];
      /** Where each part came from: "Crew" → "Lead Photographer, Second Shooter". */
      sources: Partial<Record<string, string>>;
    }
  | { row: number; problems: string[] };

/**
 * One row, as a booking to check or as what's missing from it.
 *
 * A sheet records what was paid as a single figure more often than a payment
 * history, so that figure becomes one payment dated when it was paid — or, if
 * the sheet doesn't say, when the contract was signed, and a note says so.
 *
 * The crew comes from every crew column (2026-10-26): a column of names says
 * who (and so how many), a count says how many, Yes is one, and a second
 * shooter adds a photographer. Anything the row didn't say and the import had
 * to fill in is listed in `assumed`, and the review marks it.
 */
export function bookingFromSpreadsheetRow(input: {
  row: number;
  cells: readonly string[];
  columns: Partial<Record<SpreadsheetField, number>>;
  timezone: string;
  /** The studio's trade: its crew roles, its usual hours. */
  trade?: unknown;
  /** The studio's crew columns (detectCrewColumns). */
  crewColumns?: readonly CrewColumn[];
  /** Header names, to say where things came from and to keep unused columns. */
  headers?: readonly string[];
  /** Columns nothing reads, kept in the job's notes. */
  keepInNotes?: readonly number[];
  /** Where a job whose date has passed is, when the sheet has no status. */
  pastState?: ImportableBookingState;
  /** The studio's day: what counts as passed. */
  today?: string;
  currency?: string;
}): SpreadsheetRowResult {
  const get = (field: SpreadsheetField) => {
    const index = input.columns[field];
    return index === undefined ? "" : String(input.cells[index] ?? "").trim();
  };
  const header = (index: number | undefined) => (index === undefined ? "" : String(input.headers?.[index] ?? "").trim());
  const problems: string[] = [];
  const notes: string[] = [];
  const assumed: string[] = [];
  const sources: Partial<Record<string, string>> = {};
  const trade = tradeOf(input.trade);

  let people: Array<{ first: string; last: string }> = [];
  if (get("firstName") || get("lastName")) {
    people.push({ first: get("firstName"), last: get("lastName") });
    if (get("partnerName")) people.push(splitName(get("partnerName")));
  } else if (get("clientName")) {
    people = splitCouple(get("clientName"));
    if (people.length === 1 && get("partnerName")) people.push(splitName(get("partnerName")));
  }
  sources.client = [header(input.columns.firstName), header(input.columns.lastName), header(input.columns.clientName), header(input.columns.partnerName)].filter(Boolean).join(", ");
  const primary = people[0];
  if (!primary?.first || !primary.last)
    problems.push("No client first and last name.");
  const second = people[1];
  if (second && !second.last && primary?.last) second.last = primary.last;

  const email = get("email").toLowerCase();
  const phone = get("phone");
  // A phone is enough (2026-10-26); the portal invite waits for an email.
  if (!email && !phone) problems.push("No client email or phone.");

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
  const usualHours = DEFAULT_HOURS[trade] ?? 8;
  const hours = hoursRaw ? Number(hoursRaw.replace(/[^\d.]/g, "")) : usualHours;
  if (hoursRaw && !(hours > 0 && hours <= 24))
    problems.push(`Couldn't read the hours "${hoursRaw}".`);
  else if (!hoursRaw) {
    assumed.push("coverageMinutes");
    notes.push(`Hours aren't in the sheet, so it's set to ${usualHours}.`);
  } else sources.hours = header(input.columns.coverageHours);

  const startRaw = get("startTime");
  const startTime = startRaw ? readTime(startRaw) : null;
  if (startRaw && !startTime) notes.push(`Couldn't read the start time "${startRaw}", so it's left out.`);

  // The crew, line by line, from every crew column. A count column and a
  // names column for the same role describe the same people ("Assistants: 3"
  // beside "Assistant names: Kim, Tara, Joy" is three), so a role is the
  // larger of the two, never their sum. A second shooter adds to it.
  const tallies = new Map<CrewRole, { stated: number; named: string[]; extra: number; extraNames: string[] }>();
  const crewSources: string[] = [];
  for (const column of input.crewColumns ?? []) {
    const cell = String(input.cells[column.index] ?? "");
    const read = readCrewCell(cell, column.kind);
    if ("problem" in read) {
      problems.push(`${read.problem} in "${header(column.index) || "a crew column"}".`);
      continue;
    }
    if (!read.count) continue;
    const tally = tallies.get(column.role) ?? { stated: 0, named: [], extra: 0, extraNames: [] };
    if (column.extra) {
      tally.extra += read.count;
      tally.extraNames.push(...read.names);
    } else if (read.names.length) tally.named.push(...read.names.filter((name) => !tally.named.includes(name)));
    else tally.stated += read.count;
    tallies.set(column.role, tally);
    crewSources.push(header(column.index));
  }
  const lines = new Map<CrewRole, { count: number; names: string[] }>(
    [...tallies.entries()].map(([role, tally]) => [
      role,
      {
        count: Math.max(tally.stated, tally.named.length) + tally.extra,
        names: [...tally.named, ...tally.extraNames.filter((name) => !tally.named.includes(name))],
      },
    ]),
  );
  const roles = importCrewRoles(input.trade);
  const teamRaw = get("teamSize");
  // A headcount beside a column per role says nothing new: kept as a note.
  if (lines.size && teamRaw) notes.push(`${header(input.columns.teamSize) || "Team size"}: ${teamRaw} (the crew comes from the role columns).`);
  if (!lines.size) {
    const team = teamRaw ? Number(teamRaw.replace(/\D/g, "")) : 0;
    if (teamRaw && !(Number.isInteger(team) && team >= 1 && team <= 50)) problems.push(`Couldn't read the team size "${teamRaw}".`);
    else if (team) {
      lines.set(roles[0]!, { count: team, names: [] });
      crewSources.push(header(input.columns.teamSize));
    } else {
      lines.set(roles[0]!, { count: 1, names: [] });
      assumed.push("crew");
      notes.push("The crew isn't in the sheet, so it's set to one.");
    }
  }
  if (crewSources.length) sources.crew = crewSources.filter(Boolean).join(", ");
  const crew = [...lines.entries()].map(([role, line]) => ({
    role,
    count: Math.min(50, Math.max(line.count, line.names.length)),
    names: line.names.slice(0, 50),
  }));

  const galleryRaw = get("galleryUrl");
  const galleryUrl = /^https?:\/\//i.test(galleryRaw) ? galleryRaw : null;
  const deliveredRaw = get("deliveredOn");
  const deliveredOn = deliveredRaw ? parseSpreadsheetDate(deliveredRaw) : null;
  if (deliveredRaw && !deliveredOn) problems.push(`Couldn't read the delivery date "${deliveredRaw}".`);

  if (problems.length) return { row: input.row, problems };

  // The sheet's own word for it ("Family session", "Cheer") read as a kind
  // (job-kinds.ts); an unrecognised word is an "other" event, not a wedding.
  const type = get("eventType")
    ? eventTypes[jobKindFromLabel(get("eventType")) ?? get("eventType").toLowerCase()] ??
      eventTypes.other!
    : eventTypes.wedding!;
  if (!get("eventType")) {
    assumed.push("eventType");
    notes.push("No event type in the sheet, so it's a wedding.");
  }

  // Where the job is: its status if the sheet says, otherwise by its date.
  const delivers = tradeProfile(input.trade).delivery;
  const fromStatus = stateFromStatus(get("status"));
  const passed = Boolean(input.today && eventDate! < input.today);
  let state: ImportableBookingState = fromStatus ?? (passed ? input.pastState ?? "CLOSED" : "BOOKED");
  if (!fromStatus && passed) {
    assumed.push("state");
    notes.push(`The date has passed and the sheet has no status, so it's ${importStateLabels[state].toLowerCase()}.`);
  }
  if (!delivers && (state === "POST_PRODUCTION" || state === "DELIVERED")) state = state === "DELIVERED" ? "CLOSED" : "EVENT_COMPLETE";
  if (fromStatus) sources.status = header(input.columns.status);

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
  if (paid && paid > 0 && !paidOn) {
    assumed.push("paidOn");
    notes.push("No payment date in the sheet, so it's dated when the contract was signed.");
  }
  if (!get("packageName")) assumed.push("packageName");

  // Columns nothing reads, kept as "Photo Booth: Yes" in the job's notes.
  const kept = (input.keepInNotes ?? [])
    .map((index) => [header(index), String(input.cells[index] ?? "").trim()] as const)
    .filter(([name, value]) => name && value)
    .map(([name, value]) => `${name}: ${value}`);
  const allNotes = [get("notes"), kept.join("\n")].filter(Boolean).join("\n\n");

  return {
    row: input.row,
    notes,
    sources,
    booking: {
      clients: [
        {
          firstName: primary!.first,
          lastName: primary!.last,
          email: email || null,
          phone: phone || null,
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
      state,
      packageName: get("packageName") || type.label,
      coverageMinutes: Math.round(hours * 60),
      photographers: crew.find((line) => line.role === "photographer")?.count ?? 0,
      crew,
      startTime,
      assumed,
      galleryUrl: state === "DELIVERED" || state === "CLOSED" ? galleryUrl : null,
      deliveredOn: state === "DELIVERED" || state === "CLOSED" ? deliveredOn : null,
      currency: input.currency ?? "USD",
      totalCents: total!,
      taxCents: tax ?? 0,
      signedOn: signedOn!,
      signerName: `${primary!.first} ${primary!.last}`,
      hasSignedCopy: false,
      payments,
      notes: allNotes ? allNotes.slice(0, 4000) : null,
    },
  };
}

/** A starting sheet for a studio with nothing to export, with its own crew columns. */
export function spreadsheetTemplateFor(trade?: unknown): string {
  const crew: Record<string, [string, string]> = {
    photographer: ["Photographers,Second Shooter,Videographers,Photo assistants", "Gabe,Yes,1,0"],
    dj: ["DJs,DJ assistants", "Mike,1"],
    makeup: ["Makeup artists,Makeup assistants,Hair stylists", "Jess,2,1"],
    hair: ["Hair stylists,Hair assistants,Assistant names", "Jess,3,\"Kim, Tara, Joy\""],
    planner: ["Coordinators", "2"],
  };
  const [heads, values] = crew[tradeOf(trade)] ?? crew.photographer!;
  return [
    `First name,Last name,Email,Phone,Partner's name,Partner's email,Event date,Start time,Event type,Status,Venue,City,Package,Contract total,Tax,Amount paid,Date paid,Date signed,Hours,${heads},Notes`,
    `Maya,Johnson,maya@example.com,555-0100,Theo Johnson,,2027-06-12,3:00 PM,Wedding,Booked,The Grove,Madison,Signature Collection,6499,429,2000,2026-03-02,2026-03-02,8,${values},`,
  ].join("\n");
}

/** The photographer's sheet: the template a studio of no particular trade starts from. */
export const spreadsheetTemplateCsv = spreadsheetTemplateFor("photographer");
