import type { FieldErrors, Resolver } from "react-hook-form";
import type { PublicLeadIntake } from "./schema";
import {
  defaultInquiryFormConfig,
  INQUIRY_CONFIG_MESSAGES,
  inquiryRequirementIssues,
  prepareInquiryInput,
  type InquiryFormConfig,
} from "./inquiry-form-config";

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
 * inputs and fails on any difference — for the default form and for studios'
 * own (inquiry-form-config.ts), whose hidden fields are dropped before
 * anything is checked, exactly as the schema does.
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
  eventDate: INQUIRY_CONFIG_MESSAGES.eventDate,
  eventType: INQUIRY_CONFIG_MESSAGES.eventType,
  venueContactEmail: "Check the venue coordinator's email.",
  city: INQUIRY_CONFIG_MESSAGES.city,
  message: "Tell the studio a little about the day — a sentence is plenty.",
  consent: "Please tick the box so we know we may reply to you.",
  customAnswers: "Check your answers.",
} as const;

type Outcome = { values: PublicLeadIntake; errors: null } | { values: null; errors: Record<string, string> };

const DEFAULT_CONFIG = defaultInquiryFormConfig();

export function validatePublicLeadIntake(
  raw: Record<string, unknown>,
  config: InquiryFormConfig = DEFAULT_CONFIG,
): Outcome {
  // What this inquiry's type does not ask is gone before anything is checked.
  const input = prepareInquiryInput(raw, config) as Record<string, unknown>;
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
  // `z.string().date()` checks the raw value, before any trimming. Blank is
  // null by now; whether null is allowed is the requirement check's.
  const eventDateRaw = input.eventDate;
  const eventDate = eventDateRaw === undefined || eventDateRaw === null ? null : eventDateRaw;
  if (eventDate !== null && (typeof eventDate !== "string" || !DATE.test(eventDate)))
    fail("eventDate", PUBLIC_INTAKE_MESSAGES.eventDate);
  const eventType = required("eventType", 2, 80, PUBLIC_INTAKE_MESSAGES.eventType);
  const eventTypeKey = optional("eventTypeKey", 40);
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
  // Present, it must read as a place; absent is the requirement check's.
  let city: string | null = null;
  if (input.city !== undefined && input.city !== null) {
    const value = typeof input.city === "string" ? input.city.trim() : null;
    if (value === null || value.length < 2) fail("city", PUBLIC_INTAKE_MESSAGES.city);
    else if (value.length > 120) fail("city", "Keep this under 120 characters.");
    city = value;
  }
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
  const answersRaw = input.customAnswers;
  const customAnswers: Record<string, string> = {};
  if (typeof answersRaw !== "object" || answersRaw === null || Array.isArray(answersRaw)) fail("customAnswers", PUBLIC_INTAKE_MESSAGES.customAnswers);
  else {
    const entries = Object.entries(answersRaw);
    if (entries.length > 30) fail("customAnswers", PUBLIC_INTAKE_MESSAGES.customAnswers);
    for (const [id, answer] of entries) {
      if (id.length > 60 || typeof answer !== "string" || answer.trim().length > 2000) fail("customAnswers", PUBLIC_INTAKE_MESSAGES.customAnswers);
      else customAnswers[id] = answer.trim();
    }
  }
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
  // What the studio's form requires of this type: a date, a city, its own
  // questions. Keyed by path, so a question's refusal sits on its own field.
  for (const issue of inquiryRequirementIssues(input, config)) fail(issue.path.join("."), issue.message);

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
      eventDate: eventDate as string | null,
      eventType,
      eventTypeKey,
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
      customAnswers,
      message,
      consent: true,
      source,
      honeypot,
    },
  };
}

/**
 * The same check, in the shape react-hook-form asks a resolver for. A
 * question's refusal ("customAnswers.<id>") is nested, as react-hook-form
 * reads errors by path.
 */
export function publicLeadIntakeResolver<Input extends Record<string, unknown>>(
  config: InquiryFormConfig = DEFAULT_CONFIG,
): Resolver<Input, unknown, PublicLeadIntake> {
  return async (values) => {
    const outcome = validatePublicLeadIntake(values, config);
    if (outcome.errors === null) return { values: outcome.values, errors: {} };
    const errors: FieldErrors<Input> = {};
    for (const [field, message] of Object.entries(outcome.errors)) {
      const [head, ...rest] = field.split(".");
      const error = { type: "validate", message };
      const tree = errors as Record<string, Record<string, unknown> | undefined>;
      if (!rest.length) tree[head!] = error;
      // The whole group already refused: that says it.
      else if (!tree[head!]?.type) (tree[head!] ??= {})[rest.join(".")] = error;
    }
    return { values: {}, errors };
  };
}
