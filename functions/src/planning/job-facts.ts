import type { Firestore } from "firebase-admin/firestore";
import { isTbd, suggestedFromOf, suggestedTime } from "./field-extras.js";

/**
 * Everything a job already knows that a couple's form might ask — and which
 * of the studio's questions asks it.
 *
 * Studios write their own forms ("Date of your big day", "Ceremony
 * location", "How many guests?"), so a form can't name the job's fields.
 * Until 2026-10-02 the prefill matched five exact labels against the project
 * alone, and two of the five fields it read were never written: a wedding
 * starter form arrived with nothing filled but what the inquiry page had just
 * been told. Now:
 *
 *   1. the fact sheet — the project, the couple's contacts, their inquiry,
 *      the job's vendors, the run of show, and what the couple answered on
 *      earlier forms for this job;
 *   2. which fact a field asks for — the same question on an earlier form,
 *      then rules over the label and the field's type, then (for the studio's
 *      odd wordings) a map an AI made once per form version
 *      (questionnaire-fact-map.ts), which only ever names a fact;
 *   3. the value, always from the records, shaped for the field's type — a
 *      date field gets YYYY-MM-DD, a choice only one of its own options, and
 *      anything that doesn't fit stays blank for the couple.
 *
 * Every prefilled answer carries where it came from, and the couple sees
 * "Filled in from your booking. You can change it."
 */

export const FACT_KEYS = [
  "event_date",
  "event_type",
  "venue_name",
  "venue_address",
  "venue_city",
  "ceremony_time",
  "guest_count",
  "partner_one_name",
  "partner_two_name",
  "couple_names",
  "client_email",
  "client_phone",
  "partner_two_email",
  "partner_two_phone",
  "billing_address",
  "venue_contact",
  "planner",
  "videographer",
  "florist",
  "dj",
  "band",
  "caterer",
  "hair_makeup",
  "budget",
  "referral_source",
] as const;

export type FactKey = (typeof FACT_KEYS)[number];

/** What each fact is, in words — for the AI map's instructions and for people reading a provenance. */
export const FACT_DESCRIPTIONS: Record<FactKey, string> = {
  event_date: "the wedding or event date",
  event_type: "the kind of event (wedding, engagement, corporate…)",
  venue_name: "the name of the venue where the event (or ceremony) is held",
  venue_address: "the street address of the event venue",
  venue_city: "the city or town of the event",
  ceremony_time: "the time the ceremony starts",
  guest_count: "how many guests are expected",
  partner_one_name: "the full name of the person who booked (the first partner)",
  partner_two_name: "the full name of the other person getting married (the second partner)",
  couple_names: "both partners' names together",
  client_email: "the main client's email address",
  client_phone: "the main client's phone number",
  partner_two_email: "the second partner's email address",
  partner_two_phone: "the second partner's phone number",
  billing_address: "the client's billing or mailing address",
  venue_contact: "the venue's coordinator or contact person",
  planner: "the wedding planner or coordinator",
  videographer: "the videographer",
  florist: "the florist",
  dj: "the DJ",
  band: "the band or live music",
  caterer: "the caterer",
  hair_makeup: "the hair and makeup artist",
  budget: "the budget",
  referral_source: "how they heard about the studio",
};

/** Where a fact came from, as the couple reads it: "Filled in from your booking." */
export type FactOrigin = "booking" | "inquiry" | "run_of_show" | "earlier_answer";
const ORIGIN_LABEL: Record<FactOrigin, string> = {
  booking: "your booking",
  inquiry: "your inquiry",
  run_of_show: "your timeline",
  earlier_answer: "your earlier answers",
};

export type JobFact = {
  key: FactKey;
  value: string;
  origin: FactOrigin;
  sourceCollection: string;
  sourceId: string;
  sourceField: string;
};

export type EarlierAnswer = {
  /** The question, normalised: the same question on two forms reads the same. */
  label: string;
  type: string;
  value: unknown;
  responseId: string;
  fieldId: string;
};

export type JobFactSheet = { facts: Partial<Record<FactKey, JobFact>>; earlier: EarlierAnswer[] };

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const normalisedQuestion = (value: unknown) =>
  String(value ?? "")
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const fullName = (contact: Row) =>
  text(contact.displayName) || [text(contact.firstName), text(contact.lastName)].filter(Boolean).join(" ");

/** One person's name: never a couple filed as one contact ("Priya & Jordan"). */
const personName = (contact: Row) => {
  const name = [text(contact.firstName), text(contact.lastName)].filter(Boolean).join(" ") || text(contact.displayName);
  return /&| and /i.test(name) ? "" : name;
};

/** "Gather & Grace — Maya Lin, 555 0100, maya@gather.co". */
function vendorLine(vendor: Row): string {
  const who = [text(vendor.contactName), text(vendor.phone), text(vendor.email)].filter(Boolean).join(", ");
  const company = text(vendor.company);
  return company && who ? `${company} — ${who}` : company || who;
}

function formattedAddress(value: unknown): string {
  const address = record(value);
  if (text(address.formatted)) return text(address.formatted);
  const street = [text(address.line1), text(address.line2)].filter(Boolean).join(", ");
  const place = [text(address.city), [text(address.region), text(address.postalCode)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [street, place].filter(Boolean).join(", ");
}

/** "4pm", "4:30 PM", "16:30" → "16:30"; anything else → "". */
export function clockTime(value: unknown): string {
  const raw = text(value).toLowerCase().replace(/\s+/g, "");
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm|a\.m\.|p\.m\.)?$/.exec(raw);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const half = match[3]?.startsWith("p") ? "pm" : match[3]?.startsWith("a") ? "am" : null;
  if (half === "pm" && hour < 12) hour += 12;
  if (half === "am" && hour === 12) hour = 0;
  if (!half && !match[2]) return "";
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** The ceremony's start in the schedule's own zone, as HH:MM. */
function ceremonyFromSchedule(schedule: Row | null): string {
  if (!schedule) return "";
  const item = list(schedule.items)
    .map(record)
    .find((entry) => /\bceremony\b/i.test(text(entry.title)));
  const startAt = text(item?.startAt);
  if (!startAt) return "";
  const instant = new Date(startAt);
  if (Number.isNaN(instant.valueOf())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: text(schedule.timezone) || "UTC",
    }).format(instant);
  } catch {
    return "";
  }
}

const ANSWERED_BY_PEOPLE = new Set(["client_answer", "studio_answer"]);

/**
 * Pure: the fact sheet, from records the caller has loaded. Contacts are in
 * the project's own order: the first is the person who booked.
 */
export function jobFactSheet(input: {
  projectId: string | null;
  project: Row | null;
  leadId: string | null;
  lead: Row | null;
  contacts: Array<{ id: string; data: Row }>;
  vendors: Array<{ id: string; data: Row }>;
  schedule: { id: string; data: Row } | null;
  responses: Array<{ id: string; data: Row }>;
}): JobFactSheet {
  const facts: Partial<Record<FactKey, JobFact>> = {};
  const project = input.project ?? {};
  const lead = input.lead ?? {};
  const put = (key: FactKey, value: string, origin: FactOrigin, sourceCollection: string, sourceId: string | null, sourceField: string) => {
    if (facts[key] || !value || !sourceId) return;
    facts[key] = { key, value, origin, sourceCollection, sourceId, sourceField };
  };
  const fromProject = (key: FactKey, value: string, field: string) => put(key, value, "booking", "projects", input.projectId, field);
  const fromLead = (key: FactKey, value: string, field: string) => put(key, value, "inquiry", "leads", input.leadId, field);

  // The booking first: what the studio holds as true.
  const eventDate = text(project.eventDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) fromProject("event_date", eventDate, "eventDate");
  fromProject("event_type", text(project.eventType), "eventType");
  const venue = record(project.venue);
  fromProject("venue_name", text(project.venueName) || text(venue.name), project.venueName ? "venueName" : "venue.name");
  fromProject("venue_address", formattedAddress(venue), "venue");
  fromProject("venue_city", text(project.city) || text(venue.city), project.city ? "city" : "venue.city");

  const contacts = input.contacts.filter((contact) => !contact.data.archivedAt);
  const [first, second] = contacts;
  const fromContact = (key: FactKey, contact: { id: string; data: Row } | undefined, value: string, field: string) =>
    contact && put(key, value, "booking", "contacts", contact.id, field);
  fromContact("partner_one_name", first, first ? personName(first.data) : "", "name");
  fromContact("partner_two_name", second, second ? personName(second.data) : "", "name");
  fromContact("client_email", first, text(first?.data.email), "email");
  fromContact("client_phone", first, text(first?.data.phone), "phone");
  fromContact("partner_two_email", second, text(second?.data.email), "email");
  fromContact("partner_two_phone", second, text(second?.data.phone), "phone");
  const billing = contacts.find((contact) => formattedAddress(contact.data.billingAddress));
  fromContact("billing_address", billing, billing ? formattedAddress(billing.data.billingAddress) : "", "billingAddress");
  if (contacts.length >= 2)
    put("couple_names", contacts.map((contact) => fullName(contact.data)).filter(Boolean).join(" & "), "booking", "contacts", contacts[0]!.id, "name");

  // The job's vendors, by kind.
  const VENDOR_FACTS: Array<[FactKey, string[]]> = [
    ["planner", ["planner", "coordinator"]],
    ["videographer", ["videographer"]],
    ["florist", ["florist"]],
    ["dj", ["dj"]],
    ["band", ["band"]],
    ["caterer", ["caterer"]],
    ["hair_makeup", ["hair_makeup"]],
  ];
  const vendors = input.vendors.filter((vendor) => !vendor.data.archivedAt);
  for (const [key, types] of VENDOR_FACTS) {
    const vendor = vendors.find((candidate) => types.includes(text(candidate.data.type)));
    if (vendor) put(key, vendorLine(vendor.data), "booking", "vendors", vendor.id, "company");
  }
  const venueVendor = vendors.find((candidate) => text(candidate.data.type) === "venue");
  if (venueVendor) {
    put("venue_address", text(venueVendor.data.address), "booking", "vendors", venueVendor.id, "address");
    const contact = [text(venueVendor.data.contactName), text(venueVendor.data.phone), text(venueVendor.data.email)].filter(Boolean).join(", ");
    put("venue_contact", contact, "booking", "vendors", venueVendor.id, "contactName");
  }

  // The run of show, when there is one.
  if (input.schedule) put("ceremony_time", ceremonyFromSchedule(input.schedule.data), "run_of_show", "schedules", input.schedule.id, "items");

  // Then what the couple told us when they inquired.
  const leadDate = text(lead.eventDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(leadDate)) fromLead("event_date", leadDate, "eventDate");
  fromLead("event_type", text(lead.eventTypeLabel), "eventTypeLabel");
  fromLead("venue_name", text(lead.venue), "venue");
  fromLead("venue_address", formattedAddress(lead.venuePlace), "venuePlace");
  fromLead("venue_city", text(lead.city), "city");
  fromLead("ceremony_time", clockTime(lead.ceremonyTime), "ceremonyTime");
  const guests = Number(lead.estimatedGuestCount);
  if (Number.isInteger(guests) && guests > 0) fromLead("guest_count", String(guests), "estimatedGuestCount");
  fromLead("partner_one_name", [text(lead.firstName), text(lead.lastName)].filter(Boolean).join(" "), "firstName");
  fromLead("partner_two_name", text(lead.partnerName), "partnerName");
  fromLead("client_email", text(lead.email), "email");
  fromLead("client_phone", text(lead.phone), "phone");
  fromLead("venue_contact", [text(lead.venueContactName), text(lead.venueContactEmail)].filter(Boolean).join(", "), "venueContactName");
  fromLead("budget", text(lead.budgetRange), "budgetRange");
  fromLead("referral_source", text(lead.referralSource), "referralSource");

  // What the couple (or the studio for them) answered on this job's other forms.
  const earlier: EarlierAnswer[] = [];
  for (const response of input.responses) {
    const data = response.data;
    if (data.archivedAt || ["withdrawn"].includes(text(data.status))) continue;
    const answers = record(data.answers);
    const provenance = record(data.answerProvenance);
    for (const section of list(record(data.templateSnapshot).sections)) {
      for (const candidate of list(record(section).fields)) {
        const field = record(candidate);
        const fieldId = text(field.id);
        if (!fieldId || field.internalOnly === true) continue;
        const value = answers[fieldId];
        if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) continue;
        // "Not decided yet" is asked again, never copied forward as an answer.
        if (isTbd(value)) continue;
        // Only what a person gave: a prefill copied onward would launder a guess.
        const source = text(record(provenance[fieldId]).sourceType);
        if (source && !ANSWERED_BY_PEOPLE.has(source)) continue;
        earlier.push({ label: normalisedQuestion(field.label ?? fieldId), type: text(field.type), value, responseId: response.id, fieldId });
      }
    }
  }
  return { facts, earlier };
}

/** Field types a fact can fill. Choices only from their own options. */
const FILLABLE = new Set(["text", "long_text", "email", "phone", "date", "time", "address", "contact", "dropdown", "radio", ""]);

/**
 * Which fact a field asks for, from its label and type alone. Null when the
 * question isn't one the job can answer — or could mean two things ("Bride's
 * name" doesn't say which contact; "Reception venue" may not be the venue).
 */
export function factForField(field: { label?: unknown; id?: unknown; type?: unknown }): FactKey | null {
  const type = text(field.type);
  if (!FILLABLE.has(type)) return null;
  const n = ` ${normalisedQuestion(field.label ?? field.id)} `;
  const has = (...words: string[]) => words.some((word) => n.includes(` ${word} `) || n.includes(` ${word}`));
  const partnerOne = has("first partner", "partner 1", "partner one");
  const partnerTwo =
    !partnerOne &&
    has("partner 2", "partner two", "second partner", "fiance", "fiancee", "spouse", "other half", "your partner", "partners name", "partner name");

  if (has("bride", "groom")) return null;
  // A question about the thing, not the thing: "Any restrictions at the venue?"
  if (has("restriction", "rule", "note", "anything", "any ", "requirement", "instruction", "special", "parking", "access", "polic", "allowed", "permitted", "describe", "tell us", "how important"))
    return null;
  if (has("rehearsal", "engagement", "birth", "anniversary", "deposit", "payment", "due", "honeymoon")) return null;

  if (type === "email" || has("email", "e mail")) {
    if (has("planner", "venue", "coordinator", "vendor", "emergency")) return null;
    return partnerTwo ? "partner_two_email" : "client_email";
  }
  if (type === "phone" || has("phone", "cell", "mobile", "telephone")) {
    if (has("venue", "planner", "coordinator", "emergency", "day of", "on the day", "vendor")) return null;
    return partnerTwo ? "partner_two_phone" : "client_phone";
  }
  if (has("billing", "mailing", "home address", "your address")) return has("address") || type === "address" ? "billing_address" : null;
  if (has("budget")) return "budget";
  if (has("hear about", "find us", "referral", "referred")) return "referral_source";
  if (has("guest")) return has("count", "number", "how many", "expected", "total", "estimated", "invited", "of") || n.trim() === "guests" ? "guest_count" : null;

  // "Photo/Video Start and End Time" asks about hours, not who the videographer is.
  const askingTime = type === "time" || has("time", "times", "start", "end", "hours", "arrival", "arrive");
  if (!askingTime && has("videographer", "videography", "video")) return "videographer";
  if (!askingTime && has("florist", "flowers", "floral")) return "florist";
  if (!askingTime && has("dj", "disc jockey")) return "dj";
  if (!askingTime && has("band", "live music")) return "band";
  if (!askingTime && has("caterer", "catering")) return "caterer";
  if (!askingTime && has("hair", "makeup", "make up", "mua")) return "hair_makeup";
  if (askingTime && !has("ceremony")) return null;
  // The reception, getting ready, the hotel: often not the venue on the job.
  if (has("reception", "getting ready", "hotel", "after party") && !has("ceremony")) return null;
  if (has("venue")) {
    if (has("contact", "coordinator", "manager")) return "venue_contact";
    if (has("address") || type === "address") return "venue_address";
    if (has("city", "town")) return "venue_city";
    return "venue_name";
  }
  if (has("planner", "coordinator")) return "planner";

  if (has("ceremony")) {
    if (has("reception", "end", "finish")) return null;
    if (type === "time" || has("time", "start")) return "ceremony_time";
    if (has("address")) return "venue_address";
    if (has("location", "where", "place")) return "venue_name";
    return null;
  }
  if (type === "date" || has("date")) return has("wedding", "event", "big day", "date of", "the date", "your date") || n.trim() === "date" ? "event_date" : null;
  if (has("where", "location")) return has("married", "wedding", "event", "celebration") ? "venue_name" : null;
  if (has("event address", "wedding address")) return "venue_address";
  if (has("city", "town")) return has("wedding", "event") ? "venue_city" : null;
  if (has("event type", "type of event", "kind of event")) return "event_type";
  if (has("couple", "names") && has("name", "names")) return "couple_names";
  if (has("name")) {
    if (partnerTwo) return "partner_two_name";
    if (partnerOne || has("your name", "your full name", "client name", "full name", "client")) return "partner_one_name";
  }
  return null;
}

/** "16:30" → "4:30 PM", for a time going into a text box. */
function spokenTime(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

/** A fact's value, shaped for the field — or undefined when it doesn't fit. */
export function valueForField(field: { type?: unknown; options?: unknown }, value: string, fact?: FactKey): string | undefined {
  const type = text(field.type);
  if (!value) return undefined;
  if (fact === "ceremony_time" && type !== "time") return spokenTime(value);
  if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  if (type === "time") return clockTime(value) || undefined;
  if (type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : undefined;
  if (type === "radio" || type === "dropdown") {
    const options = list(field.options).map((option) => text(option)).filter(Boolean);
    const exact = options.find((option) => option.toLowerCase() === value.toLowerCase());
    if (exact) return exact;
    // A number into a range: 120 guests → "100–150".
    const number = Number(value);
    if (!Number.isFinite(number)) return undefined;
    return options.find((option) => {
      const range = /(\d+)\s*(?:-|–|—|to)\s*(\d+)/.exec(option);
      if (range) return number >= Number(range[1]) && number <= Number(range[2]);
      const plus = /(\d+)\s*\+/.exec(option);
      if (plus) return number >= Number(plus[1]);
      const under = /(?:under|less than|fewer than|up to)\s*(\d+)/i.exec(option);
      return under ? number <= Number(under[1]) : false;
    });
  }
  return value.slice(0, 5000);
}

const blank = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

/**
 * Pure: answers for a form from the sheet. Only blank, couple-visible fields
 * that nobody has touched (`touched` — the response's changeHistory) are
 * filled; an answer the couple cleared stays cleared.
 */
export function prefillFromFacts(input: {
  sheet: JobFactSheet;
  sections: unknown;
  /** fieldId → fact, from the form's AI map (questionnaire-fact-map.ts). */
  factMap?: Record<string, FactKey> | null;
  existing?: Record<string, unknown> | null;
  touched?: ReadonlySet<string>;
}): { answers: Record<string, unknown>; answerProvenance: Record<string, unknown> } {
  const answers: Record<string, unknown> = {};
  const answerProvenance: Record<string, unknown> = {};
  const existing = input.existing ?? {};
  // One person's email, phone or name answers one question per form. A second
  // unlabelled email ("Question 7") is somebody else's (GR Productions'
  // imported form, 2026-10-02); the same planner may well answer twice.
  const ONE_PERSON: ReadonlySet<FactKey> = new Set([
    "partner_one_name",
    "partner_two_name",
    "client_email",
    "client_phone",
    "partner_two_email",
    "partner_two_phone",
  ]);
  const used = new Set<FactKey>();
  for (const section of list(input.sections)) {
    for (const candidate of list(record(section).fields)) {
      const field = record(candidate);
      const fieldId = text(field.id);
      if (!fieldId || field.internalOnly === true || field.locked === true) continue;
      if (!blank(existing[fieldId]) || input.touched?.has(fieldId)) continue;
      // A time that follows another on this form follows it (below), not the
      // job's records: "Ceremony — time" is the couple's own ceremony time.
      if (suggestedFromOf(field.suggestedFrom)) continue;
      const type = text(field.type);

      // The same question, answered on another of this job's forms.
      const question = normalisedQuestion(field.label ?? fieldId);
      const earlier = question
        ? input.sheet.earlier.find((answer) => answer.label === question && (answer.type === type || (FILLABLE.has(answer.type) && FILLABLE.has(type))))
        : undefined;
      if (earlier) {
        const value = typeof earlier.value === "string" ? valueForField(field, earlier.value) : earlier.type === type ? earlier.value : undefined;
        if (!blank(value)) {
          answers[fieldId] = value;
          answerProvenance[fieldId] = {
            sourceType: "earlier_answer",
            sourceId: earlier.responseId,
            sourceField: earlier.fieldId,
            label: ORIGIN_LABEL.earlier_answer,
            verified: false,
          };
          continue;
        }
      }

      const key = factForField(field) ?? input.factMap?.[fieldId] ?? null;
      const fact = key ? input.sheet.facts[key] : undefined;
      if (!fact || (ONE_PERSON.has(fact.key) && used.has(fact.key))) continue;
      const value = valueForField(field, fact.value, fact.key);
      if (blank(value)) continue;
      used.add(fact.key);
      answers[fieldId] = value;
      answerProvenance[fieldId] = {
        // "project_fact" kept for everything the studio's records hold, so
        // readers of the old provenance (crew briefs, the studio's view) still
        // recognise it; the inquiry is the couple's own word, not verified.
        sourceType: fact.origin === "inquiry" ? "inquiry_fact" : "project_fact",
        sourceId: fact.sourceId,
        sourceCollection: fact.sourceCollection,
        sourceField: fact.sourceField,
        fact: fact.key,
        label: ORIGIN_LABEL[fact.origin],
        verified: fact.origin !== "inquiry",
      };
    }
  }
  // Then the times that follow another ("30 minutes before prep ends"), from
  // what the form now holds — the couple's own, and what was just filled.
  const known = { ...existing, ...answers };
  for (const section of list(input.sections)) {
    for (const candidate of list(record(section).fields)) {
      const field = record(candidate);
      const fieldId = text(field.id);
      if (!fieldId || field.internalOnly === true || field.locked === true || text(field.type) !== "time") continue;
      if (!blank(known[fieldId]) || input.touched?.has(fieldId)) continue;
      const from = suggestedFromOf(field.suggestedFrom);
      const value = suggestedTime(field, known);
      if (!from || !value) continue;
      answers[fieldId] = value;
      known[fieldId] = value;
      answerProvenance[fieldId] = {
        sourceType: "suggested_time",
        sourceId: fieldId,
        sourceField: from.fieldId,
        label: "the times you gave us",
        verified: false,
      };
    }
  }
  return { answers, answerProvenance };
}

/** Fields the sheet can't place by rule or by an earlier answer: what an AI map is asked about. */
export function unmatchedFields(sections: unknown): Array<{ id: string; label: string; type: string; options: string[] }> {
  const fields: Array<{ id: string; label: string; type: string; options: string[] }> = [];
  for (const section of list(sections)) {
    for (const candidate of list(record(section).fields)) {
      const field = record(candidate);
      const id = text(field.id);
      if (!id || field.internalOnly === true || field.locked === true) continue;
      if (!FILLABLE.has(text(field.type)) || factForField(field) || suggestedFromOf(field.suggestedFrom)) continue;
      fields.push({ id, label: text(field.label) || id, type: text(field.type), options: list(field.options).map((option) => text(option)).filter(Boolean) });
    }
  }
  return fields;
}

/**
 * The records behind a job's fact sheet. `lead` is passed when the caller
 * holds it (the inquiry page); otherwise the project's own lead is read.
 */
export async function loadJobFactSheet(
  db: Firestore,
  input: { tenantId: string; projectId: string | null; project?: Row | null; leadId?: string | null; lead?: Row | null; excludeResponseId?: string | null },
): Promise<JobFactSheet> {
  const { tenantId, projectId } = input;
  const sameTenant = (data: Row | undefined) => Boolean(data) && data!.tenantId === tenantId;
  const project =
    input.project ?? (projectId ? (await db.doc(`projects/${projectId}`).get()).data() ?? null : null);
  const projectRow = project && sameTenant(project) ? project : null;
  const leadId = input.leadId ?? (text(projectRow?.leadId) || null);
  const lead = input.lead ?? (leadId ? (await db.doc(`leads/${leadId}`).get()).data() ?? null : null);
  const contactIds = list(projectRow?.clientContactIds).filter((id): id is string => typeof id === "string" && Boolean(id)).slice(0, 4);
  const [contactSnapshots, vendors, schedules, responses] = await Promise.all([
    Promise.all(contactIds.map((id) => db.doc(`contacts/${id}`).get())),
    projectId
      ? db.collection("vendors").where("tenantId", "==", tenantId).where("projectIds", "array-contains", projectId).limit(20).get()
      : null,
    projectId
      ? db.collection("schedules").where("tenantId", "==", tenantId).where("projectId", "==", projectId).orderBy("version", "desc").limit(1).get()
      : null,
    projectId
      ? db.collection("questionnaireResponses").where("tenantId", "==", tenantId).where("projectId", "==", projectId).limit(20).get()
      : null,
  ]);
  const schedule = schedules?.docs[0];
  return jobFactSheet({
    projectId: projectRow ? projectId : null,
    project: projectRow,
    leadId: lead && sameTenant(lead) ? leadId : null,
    lead: lead && sameTenant(lead) ? lead : null,
    contacts: contactSnapshots
      .filter((snapshot) => snapshot.exists && sameTenant(snapshot.data()))
      .map((snapshot) => ({ id: snapshot.id, data: snapshot.data() ?? {} })),
    vendors: (vendors?.docs ?? []).map((snapshot) => ({ id: snapshot.id, data: snapshot.data() })),
    schedule: schedule ? { id: schedule.id, data: schedule.data() } : null,
    responses: (responses?.docs ?? [])
      .filter((snapshot) => snapshot.id !== input.excludeResponseId)
      .map((snapshot) => ({ id: snapshot.id, data: snapshot.data() })),
  });
}
