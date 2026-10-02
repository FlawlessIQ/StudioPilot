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
export type BillingAddressVia = "contract_signing" | "amendment_signing" | "address_request";

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
