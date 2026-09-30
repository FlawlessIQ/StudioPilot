import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { publicLeadIntakeSchema } from "@/features/leads/schema";
import { PUBLIC_INTAKE_MESSAGES, validatePublicLeadIntake } from "@/features/leads/public-intake-validate";

/**
 * The inquiry form checks itself without Zod (H5, 2026-09-30), so the two
 * checks must never disagree: a value the browser lets through and the server
 * refuses is an inquiry lost at "Send", and one the browser refuses that the
 * server would take is a couple told they're wrong when they aren't.
 */

const valid = {
  tenantSlug: "alder-and-muse",
  firstName: "  Nora ",
  lastName: "Quill",
  partnerName: " Sam ",
  email: " nora.quill@example.com ",
  phone: "555 010 1234",
  eventDate: "2027-06-12",
  eventType: "wedding",
  venue: "Brooklyn Botanic Garden",
  venuePlace: null,
  coiRequired: null,
  venueContactName: null,
  venueContactEmail: "",
  city: " Brooklyn ",
  estimatedGuestCount: 120,
  servicesRequested: ["photography"],
  budgetRange: null,
  referralSource: "Instagram",
  message: "A relaxed garden wedding, candid photos please.",
  consent: true,
  source: "public_inquiry",
  honeypot: "",
};

const variants: Array<[string, Record<string, unknown>]> = [
  ["valid", {}],
  ["only the required fields", { partnerName: undefined, venue: undefined, venueContactEmail: undefined, estimatedGuestCount: undefined, budgetRange: undefined, referralSource: undefined, source: undefined, honeypot: undefined, coiRequired: undefined, venuePlace: undefined, venueContactName: undefined }],
  ["no first name", { firstName: "   " }],
  ["long first name", { firstName: "x".repeat(81) }],
  ["no last name", { lastName: "" }],
  ["bad email", { email: "nora@" }],
  ["email with double dot", { email: "nora..q@example.com" }],
  ["email with plus", { email: "nora+wed@example.co.uk" }],
  ["short phone", { phone: "12345" }],
  ["long phone", { phone: "1".repeat(31) }],
  ["no date", { eventDate: "" }],
  ["impossible date", { eventDate: "2027-02-30" }],
  ["leap day", { eventDate: "2028-02-29" }],
  ["not a leap day", { eventDate: "2027-02-29" }],
  ["date with spaces", { eventDate: " 2027-06-12" }],
  ["short city", { city: "N" }],
  ["short message", { message: "Hi there" }],
  ["no consent", { consent: false }],
  ["venue contact email blank", { venueContactEmail: "   " }],
  ["venue contact email bad", { venueContactEmail: "planner@" }],
  ["venue contact email good", { venueContactEmail: " planner@venue.com " }],
  ["guests zero", { estimatedGuestCount: 0 }],
  ["guests fractional", { estimatedGuestCount: 12.5 }],
  ["guests not a number", { estimatedGuestCount: Number.NaN }],
  ["no services", { servicesRequested: [] }],
  ["unknown service", { servicesRequested: ["drone"] }],
  ["coi answer", { coiRequired: "not_sure" }],
  ["bad coi answer", { coiRequired: "maybe" }],
  ["honeypot filled", { honeypot: "http://spam" }],
  ["bad slug", { tenantSlug: "Alder Muse" }],
  ["partner blank", { partnerName: "  " }],
  ["long venue", { venue: "v".repeat(161) }],
];

test("the browser check and the schema accept and refuse the same fields", () => {
  for (const [name, change] of variants) {
    const input = { ...valid, ...change };
    for (const [key, value] of Object.entries(change)) if (value === undefined) delete (input as Record<string, unknown>)[key];
    const zod = publicLeadIntakeSchema.safeParse(input);
    const ours = validatePublicLeadIntake(input);
    const zodFields = zod.success ? [] : [...new Set(zod.error.issues.map((issue) => String(issue.path[0])))].sort();
    const ourFields = ours.errors ? Object.keys(ours.errors).sort() : [];
    assert.deepEqual(ourFields, zodFields, `${name}: refused fields`);
    if (zod.success) assert.deepEqual(ours.values, zod.data, `${name}: parsed values`);
    else
      for (const issue of zod.error.issues) {
        const field = String(issue.path[0]) as keyof typeof PUBLIC_INTAKE_MESSAGES;
        // Where the schema has its own words, the browser says the same.
        if (Object.values(PUBLIC_INTAKE_MESSAGES).includes(issue.message as never))
          assert.equal(ours.errors![field], issue.message, `${name}: ${field} message`);
      }
  }
});

test("the form uses the Zod-free check, and nothing it imports at runtime brings Zod back", () => {
  const form = readFileSync("components/crm/lead-intake-form.tsx", "utf8");
  assert.match(form, /resolver: publicLeadIntakeResolver<PublicLeadIntakeInput>\(\)/);
  assert.doesNotMatch(form, /zodResolver/);
  assert.match(form, /^import type \{ z \} from "zod";$/m);
  assert.match(form, /^import type \{ publicLeadIntakeSchema, PublicLeadIntake \} from "@\/features\/leads\/schema";$/m);
  assert.doesNotMatch(readFileSync("features/leads/public-intake-validate.ts", "utf8"), /^import (?!type)[^;]*from "zod"/m);
  assert.match(readFileSync("components/forms/address-field.tsx", "utf8"), /from "@\/features\/places\/place-text"/);
  assert.doesNotMatch(readFileSync("features/places/place-text.ts", "utf8"), /^import (?!type)/m);
});
