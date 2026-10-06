import type { BillingAddress } from "@/features/contacts/schema";

/**
 * The couple's billing address, asked for once, as they sign.
 *
 * QuickBooks works out US sales tax from the customer's address, and the
 * studio otherwise has to chase it by email after the booking. So the
 * signing sheet asks for it just before the signature: prefilled with a
 * "This is my billing address" tick when one is on file, typed once when
 * not. It lands on the signer's own contact, marked as the couple's.
 *
 * Whether it is asked at all is the studio's tax setting, never the page's:
 *  - the studio has QuickBooks charge sales tax and this job is not exempt
 *    → required (no signature without it);
 *  - QuickBooks is connected but not charging tax → optional, still shown;
 *  - no QuickBooks → hidden (nothing would use it).
 * A booking change (amendment) asks only when nothing is on file.
 *
 * The address is never part of the signed document or its hash: the
 * agreement's text is fixed when the studio signs, and the address is a
 * record about the client, not a term of the deal.
 *
 * Pure. Used by the portal route (server/contracts/signing-billing-address.ts)
 * and the signing sheet (components/client/billing-address-step.tsx).
 */

export type BillingAddressRequirement = "required" | "optional" | "hidden";
export type SigningKind = "contract" | "amendment";

/** The studio's settings, as stored. Missing billingSettings reads as mode "none". */
export function billingAddressRequirement(input: {
  salesTaxMode: unknown;
  salesTaxExempt: unknown;
  quickBooksConnected: boolean;
}): BillingAddressRequirement {
  if (!input.quickBooksConnected) return "hidden";
  if (input.salesTaxMode === "quickbooks" && input.salesTaxExempt !== true) return "required";
  return "optional";
}

/** What this signing asks: a booking change only asks when none is on file. */
export function billingAddressStepFor(input: {
  requirement: BillingAddressRequirement;
  onFile: BillingAddress | null;
  kind: SigningKind;
}): BillingAddressRequirement {
  if (input.kind === "amendment" && input.onFile) return "hidden";
  return input.requirement;
}

/** States, DC and the territories QuickBooks taxes as states. */
const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands", AS: "American Samoa",
  MP: "Northern Mariana Islands",
};
const STATE_BY_NAME = new Map(Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]));

/** "nj", "N.J.", "New Jersey" → "NJ"; null when it isn't a US state. */
export function usStateCode(value: string): string | null {
  const plain = value.trim().replace(/\./g, "").toUpperCase();
  if (US_STATES[plain]) return plain;
  return STATE_BY_NAME.get(value.trim().toLowerCase()) ?? null;
}

export type BillingAddressProblem = "line1" | "city" | "region" | "postalCode" | "country";

/** Words for each field a couple got wrong. */
export const billingAddressProblemCopy: Record<BillingAddressProblem, string> = {
  line1: "Add your street address.",
  city: "Add your city.",
  region: "Add your state — for example NJ.",
  postalCode: "Check your ZIP code — 5 digits, like 07940.",
  country: "Choose your country.",
};

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";

/**
 * A typed address, checked lightly and tidied: a street, a city, and — in the
 * US — a real state and a 5-digit ZIP, which is all QuickBooks needs to tax
 * it. Anywhere else, state and postcode are whatever the couple writes.
 */
export function parseSigningBillingAddress(
  input: unknown,
): { ok: true; address: BillingAddress } | { ok: false; problem: BillingAddressProblem } {
  const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const line1 = text(record.line1, 200);
  if (!line1) return { ok: false, problem: "line1" };
  const city = text(record.city, 120);
  if (!city) return { ok: false, problem: "city" };
  const country = (text(record.country, 2) || "US").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false, problem: "country" };
  const line2 = text(record.line2, 200) || null;
  let region: string | null = text(record.region, 80) || null;
  let postalCode: string | null = text(record.postalCode, 20) || null;
  if (country === "US") {
    region = region ? usStateCode(region) : null;
    if (!region) return { ok: false, problem: "region" };
    if (!postalCode || !/^\d{5}(-?\d{4})?$/.test(postalCode)) return { ok: false, problem: "postalCode" };
    if (postalCode.length === 9) postalCode = `${postalCode.slice(0, 5)}-${postalCode.slice(5)}`;
  }
  return { ok: true, address: { line1, line2, city, region, postalCode, country } };
}

export type SigningBillingAddressRefusal = "BILLING_ADDRESS_REQUIRED" | "BILLING_ADDRESS_INVALID";

/**
 * What a signature does with the address it carries.
 *
 * Required and missing (or unreadable) refuses the signature; optional and
 * missing saves nothing; hidden ignores whatever arrived, because nothing on
 * the page asked for it.
 */
export function planSigningBillingAddress(input: {
  step: BillingAddressRequirement;
  submitted: unknown;
}): { refusal: SigningBillingAddressRefusal } | { save: BillingAddress | null } {
  if (input.step === "hidden") return { save: null };
  const given = input.submitted !== undefined && input.submitted !== null;
  if (!given) return input.step === "required" ? { refusal: "BILLING_ADDRESS_REQUIRED" } : { save: null };
  const parsed = parseSigningBillingAddress(input.submitted);
  if (!parsed.ok) return { refusal: "BILLING_ADDRESS_INVALID" };
  return { save: parsed.address };
}

/** Where an address on a contact came from. Stored at contacts.fieldProvenance.billingAddress. */
export type BillingAddressProvenance = {
  source: "couple" | "studio";
  label: string | null;
  /** When it was confirmed or typed. */
  at: string;
  /** For the couple's: the signing that carried it, or the studio's request for it. */
  via?: BillingAddressVia;
  recordId?: string;
};

/** How the couple gave it: at a signature, or when asked for it on their portal. */
export type BillingAddressVia = "contract_signing" | "amendment_signing" | "address_request" | "form";

export const COUPLE_CONFIRMED_LABEL = "Confirmed by the couple at signing";
export const COUPLE_CONFIRMED_ON_REQUEST_LABEL = "Confirmed by the couple";

export function coupleBillingAddressProvenance(input: {
  at: string;
  via: BillingAddressVia;
  recordId: string;
}): BillingAddressProvenance {
  return {
    source: "couple",
    label: input.via === "address_request" ? COUPLE_CONFIRMED_ON_REQUEST_LABEL : COUPLE_CONFIRMED_LABEL,
    at: input.at,
    via: input.via,
    recordId: input.recordId,
  };
}

/** Whether the stored address is the couple's own, and when they confirmed it. Null when it isn't. */
export function coupleConfirmed(contact: object | null | undefined): { at: string | null } | null {
  const stored = (contact as { fieldProvenance?: unknown } | null | undefined)?.fieldProvenance;
  const provenance = (stored as Record<string, unknown> | undefined)?.billingAddress as
    | Record<string, unknown>
    | undefined;
  if (provenance?.source !== "couple") return null;
  return { at: typeof provenance.at === "string" ? provenance.at : null };
}

/**
 * Where the stored address came from, in words: "confirmed by the couple at
 * signing", "given by the couple on their form" (saved by
 * functions/src/contacts/address-from-form.ts), "confirmed by the couple", or
 * "added by the studio". Two screens said "at signing" for every couple's
 * address, which was wrong for the ones they gave when asked.
 */
export function billingAddressOrigin(contact: object | null | undefined, who = "the couple"): string {
  const stored = (contact as { fieldProvenance?: unknown } | null | undefined)?.fieldProvenance;
  const provenance = (stored as Record<string, unknown> | undefined)?.billingAddress as
    | Record<string, unknown>
    | undefined;
  if (provenance?.source !== "couple") return "added by the studio";
  if (provenance.via === "form") return `given by ${who} on their form`;
  if (provenance.via === "address_request") return `confirmed by ${who}`;
  return `confirmed by ${who} at signing`;
}

/** One line: "12 Main St, Apt 4, Madison, NJ 07940" (the country only when not the US). */
export function formatBillingAddress(address: Partial<BillingAddress> | null | undefined): string {
  if (!address) return "";
  const regionLine = [address.region, address.postalCode].filter(Boolean).join(" ");
  return [
    address.line1,
    address.line2,
    address.city,
    regionLine,
    address.country && address.country !== "US" ? address.country : null,
  ]
    .filter((part) => typeof part === "string" && part.trim())
    .join(", ");
}

/**
 * Two stored addresses the same, field for field — blank and missing alike.
 * Mirrored in functions/src/contacts/billing-address.ts (updateContact keeps
 * the couple's mark on an address the studio re-saved unchanged).
 */
export function sameBillingAddress(a: unknown, b: unknown): boolean {
  const field = (value: unknown, key: string) => {
    const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const entry = record[key];
    return typeof entry === "string" && entry.trim() ? entry.trim() : null;
  };
  return ["line1", "line2", "city", "region", "postalCode", "country"].every(
    (key) => field(a, key) === field(b, key),
  );
}

/**
 * An address the couple already gave on a form, offered at signing.
 *
 * Gabe, 2026-10-05: a bride typed "140 Briarwood Rd, Florham Park, NJ" into
 * the studio's event form, then signing asked her for a billing address as if
 * nobody knew it. So when nothing is on file, a personal address from the
 * job's forms is offered in the step's "on file" shape — shown, with "This is
 * my billing address" to tick or "Change it". It is never saved unless the
 * couple confirms it, and it is never part of what they sign.
 *
 * Only a person's own address: venues, ceremony, reception, prep and other
 * places on the day are never billing addresses. The signer's own wins
 * (matched by the email answered beside it); with several and no way to tell
 * whose, nothing is offered rather than a guess.
 */
export type FormForAddress = {
  fields: ReadonlyArray<{ id: string; label?: string | null; type?: string | null }>;
  answers: Record<string, unknown>;
};

const PLACE_WORDS =
  /\b(venue|ceremony|reception|church|chapel|hotel|prep|preparation|getting ready|location|photos?|portraits?|party|rehearsal|event|cocktail|first look|vendor|planner)\b/i;
const PERSON_WORDS = /\b(home|mailing|billing|postal|current|residential|bride'?s?|groom'?s?|partner'?s?|client'?s?|your|my)\b/i;
const ROLE = /\b(bride|groom|partner\s*(?:one|two|1|2)|client)\b/i;

/** "140 Briarwood Rd\nFlorham Park, NJ 07932" (or one line, commas) as an address, or null. */
export function addressFromAnswer(value: unknown): BillingAddress | null {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const direct = parseSigningBillingAddress({
      line1: record.line1,
      line2: record.line2,
      city: record.city,
      region: record.region,
      postalCode: record.postalCode,
      country: record.country,
    });
    if (direct.ok) return direct.address;
    return typeof record.formatted === "string" ? addressFromAnswer(record.formatted) : null;
  }
  if (typeof value !== "string") return null;
  const parts = value
    .split(/\n|,/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^(usa|us|united states( of america)?)$/i.test(part));
  if (parts.length < 2) return null;
  // The last part ends "ST 12345" or "State Name 12345", maybe after the city.
  const words = parts[parts.length - 1]!.split(/\s+/);
  const postalCode = words.pop() ?? "";
  if (!/^\d{5}(-?\d{4})?$/.test(postalCode)) return null;
  let region: string | null = null;
  for (let take = Math.min(3, words.length); take >= 1 && !region; take -= 1) {
    const code = usStateCode(words.slice(-take).join(" "));
    if (code) {
      region = code;
      words.splice(-take, take);
    }
  }
  if (!region) return null;
  let city = words.join(" ");
  let rest = parts.slice(0, -1);
  if (!city) {
    city = rest[rest.length - 1] ?? "";
    rest = rest.slice(0, -1);
  }
  if (!rest.length || !city) return null;
  const parsed = parseSigningBillingAddress({
    line1: rest[0],
    line2: rest.slice(1).join(", ") || null,
    city,
    region,
    postalCode,
    country: "US",
  });
  return parsed.ok ? parsed.address : null;
}

export function suggestedBillingAddress(input: {
  forms: readonly FormForAddress[];
  signerEmail: string | null;
}): { address: BillingAddress; question: string } | null {
  const signer = (input.signerEmail ?? "").trim().toLowerCase();
  const candidates: Array<{ address: BillingAddress; question: string; mine: boolean }> = [];
  for (const form of input.forms) {
    const emailFor = (role: string) =>
      form.fields
        .filter((field) => /email/i.test(`${field.label ?? ""} ${field.id}`) && new RegExp(role, "i").test(`${field.label ?? ""} ${field.id}`))
        .map((field) => String(form.answers[field.id] ?? "").trim().toLowerCase())
        .find(Boolean) ?? "";
    for (const field of form.fields) {
      const words = `${field.label ?? ""} ${field.id.replace(/[-_]/g, " ")}`;
      if (!/address/i.test(words) || PLACE_WORDS.test(words) || !PERSON_WORDS.test(words)) continue;
      const address = addressFromAnswer(form.answers[field.id]);
      if (!address) continue;
      const role = words.match(ROLE)?.[1] ?? null;
      const mine = Boolean(signer && role && emailFor(role.split(/\s+/)[0]!) === signer);
      candidates.push({ address, question: String(field.label || field.id), mine });
    }
  }
  const own = candidates.filter((candidate) => candidate.mine);
  const pick = own.length ? own : candidates;
  const distinct = pick.filter((candidate, index) => pick.findIndex((other) => sameBillingAddress(other.address, candidate.address)) === index);
  if (distinct.length !== 1) return null;
  return { address: distinct[0]!.address, question: distinct[0]!.question };
}
