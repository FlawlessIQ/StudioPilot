/**
 * The billing address a couple gave on a form, saved to their client record.
 *
 * GR Productions (2026-10-06): "billing address isn't populating with the info
 * from event form." Signing already offers an address from the job's forms
 * (features/contacts/billing-address-signing.ts), but only offers it: that
 * reader guesses which of several address questions is the couple's own, so a
 * guess is never saved without them confirming it.
 *
 * A question that asks for the billing address is not a guess. Its answer is
 * the couple saying where they are billed, so it goes onto their contact when
 * nothing is on file — never over an address the studio or the couple already
 * set. Venues and other places on the day are never billing addresses.
 *
 * The parser below MIRRORS features/contacts/billing-address-signing.ts
 * (functions/ has no "@/features" path); tests/billing-address-from-form.test.ts
 * runs both on the same answers and fails if they disagree.
 */

export type BillingAddress = {
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
};

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

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";

function parseAddress(
  input: unknown,
): { ok: true; address: BillingAddress } | { ok: false } {
  const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const line1 = text(record.line1, 200);
  if (!line1) return { ok: false };
  const city = text(record.city, 120);
  if (!city) return { ok: false };
  const country = (text(record.country, 2) || "US").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false };
  const line2 = text(record.line2, 200) || null;
  let region: string | null = text(record.region, 80) || null;
  let postalCode: string | null = text(record.postalCode, 20) || null;
  if (country === "US") {
    region = region ? usStateCode(region) : null;
    if (!region) return { ok: false };
    if (!postalCode || !/^\d{5}(-?\d{4})?$/.test(postalCode)) return { ok: false };
    if (postalCode.length === 9) postalCode = `${postalCode.slice(0, 5)}-${postalCode.slice(5)}`;
  }
  return { ok: true, address: { line1, line2, city, region, postalCode, country } };
}

/** "140 Briarwood Rd\nFlorham Park, NJ 07932" (or one line, commas) as an address, or null. */
export function addressFromAnswer(value: unknown): BillingAddress | null {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const direct = parseAddress({
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
  const parsed = parseAddress({
    line1: rest[0],
    line2: rest.slice(1).join(", ") || null,
    city,
    region,
    postalCode,
    country: "US",
  });
  return parsed.ok ? parsed.address : null;
}

const PLACE_WORDS =
  /\b(venue|ceremony|reception|church|chapel|hotel|prep|preparation|getting ready|location|photos?|portraits?|party|rehearsal|event|cocktail|first look|vendor|planner)\b/i;

/** A question that asks where the couple is billed — not a guess at whose address. */
export function isBillingAddressQuestion(field: { id: string; label?: unknown }): boolean {
  const words = `${typeof field.label === "string" ? field.label : ""} ${field.id.replace(/[-_]/g, " ")}`;
  return /\bbilling\b/i.test(words) && /\baddress\b/i.test(words) && !PLACE_WORDS.test(words);
}

/** The one billing address a submitted form gives, or null (none, unreadable, or two that differ). */
export function billingAddressFromForm(input: {
  fields: ReadonlyArray<{ id: string; label?: unknown }>;
  answers: Record<string, unknown>;
}): { address: BillingAddress; question: string } | null {
  const found = input.fields
    .filter(isBillingAddressQuestion)
    .map((field) => ({ field, address: addressFromAnswer(input.answers[field.id]) }))
    .filter((entry): entry is { field: { id: string; label?: unknown }; address: BillingAddress } => entry.address !== null);
  if (!found.length) return null;
  const first = found[0]!;
  const same = (a: BillingAddress, b: BillingAddress) =>
    (["line1", "line2", "city", "region", "postalCode", "country"] as const).every((key) => (a[key] ?? null) === (b[key] ?? null));
  if (found.some((entry) => !same(entry.address, first.address))) return null;
  return { address: first.address, question: typeof first.field.label === "string" && first.field.label ? first.field.label : first.field.id };
}

type FormResponse = {
  tenantId?: unknown;
  projectId?: unknown;
  status?: unknown;
  archivedAt?: unknown;
  answers?: unknown;
  templateSnapshot?: unknown;
};

/** The fields of a response's own template copy, flattened. */
function responseFields(response: FormResponse): Array<{ id: string; label?: unknown }> {
  const sections = (response.templateSnapshot as { sections?: unknown } | undefined)?.sections;
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((section) => {
    const fields = (section as { fields?: unknown })?.fields;
    return Array.isArray(fields)
      ? (fields as Array<Record<string, unknown>>)
          .filter((field) => typeof field?.id === "string")
          .map((field) => ({ id: String(field.id), label: field.label }))
      : [];
  });
}

/**
 * Save a submitted form's billing address onto the job's client, when they
 * have none. Returns what it did, for the trigger's log. Never throws for a
 * form that simply has no such question.
 */
export async function saveFormBillingAddress(
  db: import("firebase-admin/firestore").Firestore,
  responseId: string,
  response: FormResponse,
): Promise<"saved" | "skipped"> {
  if (response.archivedAt || !["submitted", "locked"].includes(String(response.status))) return "skipped";
  const tenantId = typeof response.tenantId === "string" ? response.tenantId : "";
  const projectId = typeof response.projectId === "string" ? response.projectId : "";
  if (!tenantId || !projectId) return "skipped";
  const answers =
    response.answers && typeof response.answers === "object" ? (response.answers as Record<string, unknown>) : {};
  const found = billingAddressFromForm({ fields: responseFields(response), answers });
  if (!found) return "skipped";
  const project = await db.doc(`projects/${projectId}`).get();
  if (!project.exists || project.get("tenantId") !== tenantId) return "skipped";
  const contactId = Array.isArray(project.get("clientContactIds"))
    ? String((project.get("clientContactIds") as unknown[])[0] ?? "")
    : "";
  if (!contactId) return "skipped";
  const contactReference = db.doc(`contacts/${contactId}`);
  return db.runTransaction(async (transaction) => {
    const contact = await transaction.get(contactReference);
    if (!contact.exists || contact.get("tenantId") !== tenantId || contact.get("archivedAt")) return "skipped";
    // Never over an address the studio or the couple already set.
    const onFile = contact.get("billingAddress") as { line1?: unknown } | null | undefined;
    if (onFile && typeof onFile.line1 === "string" && onFile.line1.trim()) return "skipped";
    const now = new Date().toISOString();
    transaction.update(contactReference, {
      billingAddress: found.address,
      "fieldProvenance.billingAddress": {
        source: "couple",
        label: "Given by the couple on their form",
        at: now,
        via: "form",
        recordId: responseId,
      },
      updatedAt: now,
      updatedBy: "form-billing-address",
    });
    const auditId = `audit_form_billing_${responseId}_${now.replace(/\D/g, "")}`;
    transaction.create(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId,
      projectId,
      actorId: "form-billing-address",
      actorType: "system",
      action: "contact.billing_address_from_form",
      entityType: "contact",
      entityId: contactId,
      timestamp: now,
      before: { billingAddress: onFile ?? null },
      after: { billingAddress: found.address, question: found.question, responseId },
      ipAddress: null,
      userAgent: null,
      correlationId: responseId,
      automationRunId: null,
      providerEventId: null,
    });
    return "saved" as const;
  });
}
