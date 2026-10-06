import type { Firestore } from "firebase-admin/firestore";

/**
 * The job's venue, from the couple's form, when the job has none.
 *
 * Production walk (2026-10-06): Maya's event form named The Madison Hotel for
 * her ceremony and her reception, and the job kept no venue at all — her
 * proposal read "Mar 13, 2027 · —". The inquiry page asks for a venue only
 * if they have one, and most couples write it on the form instead. Conor:
 * "fill venue from the form".
 *
 * The reception first (where most of the day is spent and where the venue
 * coordinator usually sits), then the ceremony, then a question that just says
 * "venue". Never prep locations. Never over a venue the studio set. Stored
 * unverified: a certificate of insurance still checks the address itself.
 */

type Field = { id: string; label?: unknown };

const TBD = /^\s*(tbd|tba|n\/?a|not sure|unknown|not decided( yet)?)\s*$/i;
const PREP = /\b(prep|getting ready|hair|makeup|dressing)\b/i;

function words(field: Field): string {
  return `${typeof field.label === "string" ? field.label : ""} ${field.id.replace(/[-_]/g, " ")}`;
}

/** The answer that names the venue, in order of preference, or null. */
export function venueAnswer(fields: readonly Field[], answers: Record<string, unknown>): string | null {
  const ranked = [/\breception\b/i, /\bceremony\b/i, /\bvenue\b/i];
  for (const pattern of ranked) {
    for (const field of fields) {
      const label = words(field);
      if (!pattern.test(label) || PREP.test(label)) continue;
      // Only a place, never a time or a contact on the same subject.
      if (/\b(time|start|end|contact|phone|email|coordinator)\b/i.test(label)) continue;
      const value = answers[field.id];
      const text =
        typeof value === "string"
          ? value
          : value && typeof value === "object" && typeof (value as { formatted?: unknown }).formatted === "string"
            ? String((value as { formatted: string }).formatted)
            : "";
      const clean = text.trim().replace(/\s*\n\s*/g, ", ");
      if (clean && !TBD.test(clean)) return clean.slice(0, 500);
    }
  }
  return null;
}

/** "The Madison Hotel, 1 Convent Rd, Morristown, NJ" → name and the whole line. */
export function venueFromAnswer(answer: string): { name: string; formatted: string } {
  const formatted = answer.trim();
  const first = formatted.split(",")[0]!.trim();
  // A line that starts with a street number is an address, not a name.
  const name = /^\d/.test(first) ? formatted : first;
  return { name: name.slice(0, 160), formatted };
}

type FormResponse = {
  tenantId?: unknown;
  projectId?: unknown;
  status?: unknown;
  archivedAt?: unknown;
  answers?: unknown;
  templateSnapshot?: unknown;
};

function fieldsOf(response: FormResponse): Field[] {
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

/** Fill the job's venue from a submitted form when it has none. */
export async function fillVenueFromForm(
  db: Firestore,
  responseId: string,
  response: FormResponse,
): Promise<"saved" | "skipped"> {
  if (response.archivedAt || !["submitted", "locked"].includes(String(response.status))) return "skipped";
  const tenantId = typeof response.tenantId === "string" ? response.tenantId : "";
  const projectId = typeof response.projectId === "string" ? response.projectId : "";
  if (!tenantId || !projectId) return "skipped";
  const answers =
    response.answers && typeof response.answers === "object" ? (response.answers as Record<string, unknown>) : {};
  const answer = venueAnswer(fieldsOf(response), answers);
  if (!answer) return "skipped";
  const { name, formatted } = venueFromAnswer(answer);
  const reference = db.doc(`projects/${projectId}`);
  return db.runTransaction(async (transaction) => {
    const project = await transaction.get(reference);
    if (!project.exists || project.get("tenantId") !== tenantId || project.get("archivedAt")) return "skipped";
    const hasVenue =
      (typeof project.get("venueName") === "string" && project.get("venueName").trim()) ||
      (project.get("venue") && typeof project.get("venue") === "object");
    if (hasVenue) return "skipped";
    const now = new Date().toISOString();
    transaction.update(reference, {
      venueName: name,
      venue: {
        placeId: null,
        formatted,
        name,
        line1: null,
        city: null,
        region: null,
        postalCode: null,
        country: null,
        latitude: null,
        longitude: null,
        verified: false,
      },
      updatedAt: now,
      updatedBy: "form-venue",
    });
    const auditId = `audit_form_venue_${responseId}_${now.replace(/\D/g, "")}`;
    transaction.create(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId,
      projectId,
      actorId: "form-venue",
      actorType: "system",
      action: "project.venue_from_form",
      entityType: "project",
      entityId: projectId,
      timestamp: now,
      before: { venueName: null, venue: null },
      after: { venueName: name, formatted, responseId },
      ipAddress: null,
      userAgent: null,
      correlationId: responseId,
      automationRunId: null,
      providerEventId: null,
    });
    return "saved" as const;
  });
}
