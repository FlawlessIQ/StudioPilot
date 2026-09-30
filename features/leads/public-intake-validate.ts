import type { FieldErrors, Resolver } from "react-hook-form";
import type { PublicLeadIntake } from "./schema";

/**
 * The public inquiry form's browser-side check, without Zod.
 *
 * `zodResolver(publicLeadIntakeSchema)` shipped the whole of Zod (its classic
 * build, JSON-schema export and nine locales) to a couple's phone: a 265 KB
 * chunk, the largest on the page (H5). The server still validates every
 * inquiry with its own copy of the schema (functions/src/crm/public-lead.ts),
 * so this is only what the browser needs to point at a field before sending.
 *
 * It must agree with the schema: same fields accepted and refused, the same
 * words for the fields the schema words, and the same trimmed, defaulted
 * values out. tests/public-intake-validate.test.ts runs both over the same
 * inputs and fails on any difference.
 */

// Zod's own patterns (zod v4 `z.regexes.email` and `z.regexes.date`), so an
// address or date the server would refuse is refused here too.
const EMAIL =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;
const DATE =
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))$/;
const SLUG = /^[a-z0-9-]+$/;
const SERVICES = new Set([
  "photography",
  "videography",
  "engagement_session",
  "second_shooter",
  "album",
  "prints",
  "corporate_licensing",
  "team_photos",
  "other",
]);
const COI = new Set(["yes", "no", "not_sure"]);

/** What the schema says, word for word, where it says something. */
export const PUBLIC_INTAKE_MESSAGES = {
  firstName: "Tell us your first name.",
  lastName: "Tell us your last name.",
  email: "Check the email address — this is where the studio will reply.",
  phone: "Add a phone number the studio can reach you on.",
  eventDate: "Pick the date of your event.",
  venueContactEmail: "Check the venue coordinator's email.",
  city: "Which city or town is the event in?",
  message: "Tell the studio a little about the day — a sentence is plenty.",
  consent: "Please tick the box so we know we may reply to you.",
} as const;

type Outcome = { values: PublicLeadIntake; errors: null } | { values: null; errors: Record<string, string> };

export function validatePublicLeadIntake(input: Record<string, unknown>): Outcome {
  const errors: Record<string, string> = {};
  const fail = (field: string, message: string) => {
    if (!(field in errors)) errors[field] = message;
  };
  const str = (field: string) => (typeof input[field] === "string" ? (input[field] as string).trim() : undefined);

  /** A required trimmed string between `min` and `max` characters. */
  const required = (field: string, min: number, max: number, message: string, pattern?: RegExp) => {
    const value = str(field);
    if (value !== undefined && value.length > max) fail(field, `Keep this under ${max} characters.`);
    else if (value === undefined || value.length < min || (pattern && !pattern.test(value))) fail(field, message);
    return value ?? "";
  };
  /** An optional trimmed string: missing is null; present is kept as typed, within `max`. */
  const optional = (field: string, max: number) => {
    const raw = input[field];
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== "string") {
      fail(field, "Check this field.");
      return null;
    }
    const value = raw.trim();
    if (value.length > max) fail(field, `Keep this under ${max} characters.`);
    return value;
  };

  const tenantSlug = required("tenantSlug", 2, 80, "This inquiry link is incomplete. Ask the studio for its current link.", SLUG);
  const firstName = required("firstName", 1, 80, PUBLIC_INTAKE_MESSAGES.firstName);
  const lastName = required("lastName", 1, 80, PUBLIC_INTAKE_MESSAGES.lastName);
  const partnerName = optional("partnerName", 120);
  const email = required("email", 0, Infinity, PUBLIC_INTAKE_MESSAGES.email, EMAIL);
  const phone = required("phone", 7, 30, PUBLIC_INTAKE_MESSAGES.phone);
  // `z.string().date()` checks the raw value, before any trimming.
  const eventDateRaw = input.eventDate;
  if (typeof eventDateRaw !== "string" || !DATE.test(eventDateRaw)) fail("eventDate", PUBLIC_INTAKE_MESSAGES.eventDate);
  const eventType = required("eventType", 2, 80, "Choose the kind of event.");
  const venue = optional("venue", 160);
  const venuePlace = input.venuePlace === undefined ? null : (input.venuePlace as PublicLeadIntake["venuePlace"]);
  const coiRaw = input.coiRequired;
  if (coiRaw !== undefined && coiRaw !== null && !COI.has(String(coiRaw))) fail("coiRequired", "Choose one of the answers.");
  const venueContactName = optional("venueContactName", 120);
  // Blank is "not given", the same as the schema's preprocess.
  const contactRaw = input.venueContactEmail;
  let venueContactEmail: string | null = null;
  if (contactRaw !== undefined && contactRaw !== null && !(typeof contactRaw === "string" && !contactRaw.trim())) {
    const value = typeof contactRaw === "string" ? contactRaw.trim() : "";
    if (!EMAIL.test(value)) fail("venueContactEmail", PUBLIC_INTAKE_MESSAGES.venueContactEmail);
    venueContactEmail = value;
  }
  const city = required("city", 2, 120, PUBLIC_INTAKE_MESSAGES.city);
  const guests = input.estimatedGuestCount;
  let estimatedGuestCount: number | null = null;
  if (guests !== undefined && guests !== null) {
    if (typeof guests !== "number" || !Number.isInteger(guests) || guests < 1 || guests > 100_000)
      fail("estimatedGuestCount", "Enter a whole number of guests, or leave it empty.");
    else estimatedGuestCount = guests;
  }
  const services = input.servicesRequested;
  if (!Array.isArray(services) || services.length < 1 || !services.every((service) => SERVICES.has(String(service))))
    fail("servicesRequested", "Choose what you'd like.");
  const budgetRange = optional("budgetRange", 80);
  const referralSource = optional("referralSource", 120);
  const message = required("message", 10, 5000, PUBLIC_INTAKE_MESSAGES.message);
  if (input.consent !== true) fail("consent", PUBLIC_INTAKE_MESSAGES.consent);
  let source = "public_inquiry";
  if (input.source !== undefined) {
    if (typeof input.source !== "string" || input.source.trim().length > 120) fail("source", "Check this field.");
    else source = input.source.trim();
  }
  let honeypot = "";
  if (input.honeypot !== undefined) {
    if (typeof input.honeypot !== "string" || input.honeypot.length > 0) fail("honeypot", "Leave this field empty.");
    else honeypot = input.honeypot;
  }

  if (Object.keys(errors).length) return { values: null, errors };
  return {
    errors: null,
    values: {
      tenantSlug,
      firstName,
      lastName,
      partnerName,
      email,
      phone,
      eventDate: eventDateRaw as string,
      eventType,
      venue,
      venuePlace,
      coiRequired: (coiRaw ?? null) as PublicLeadIntake["coiRequired"],
      venueContactName,
      venueContactEmail,
      city,
      estimatedGuestCount,
      servicesRequested: services as PublicLeadIntake["servicesRequested"],
      budgetRange,
      referralSource,
      message,
      consent: true,
      source,
      honeypot,
    },
  };
}

/** The same check, in the shape react-hook-form asks a resolver for. */
export function publicLeadIntakeResolver<Input extends Record<string, unknown>>(): Resolver<Input, unknown, PublicLeadIntake> {
  return async (values) => {
    const outcome = validatePublicLeadIntake(values);
    if (outcome.errors === null) return { values: outcome.values, errors: {} };
    const errors: FieldErrors<Input> = {};
    for (const [field, message] of Object.entries(outcome.errors))
      (errors as Record<string, unknown>)[field] = { type: "validate", message };
    return { values: {}, errors };
  };
}
