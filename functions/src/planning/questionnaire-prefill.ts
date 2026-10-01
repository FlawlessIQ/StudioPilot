/**
 * Answers a questionnaire can start with, from facts the job already holds.
 *
 * Moved out of commands.ts so the couple's inquiry page (intake/inquiry-form.ts)
 * starts its event form from the same facts the studio's "Send the form" does:
 * a field labelled "Wedding date" or "Venue" arrives filled in, with its
 * provenance, instead of asking the couple for what they already told us.
 */

const plainRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** A project snapshot, or anything that reads a field by name. */
type FactSource = { get(field: string): unknown };

const normalizedLabel = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
const projectFactAliases = [
  {
    labels: ["event date", "wedding date", "date"],
    field: "eventDate",
    label: "Project event date",
  },
  {
    labels: ["venue", "venue name", "ceremony venue"],
    field: "venueName",
    label: "Project venue",
  },
  {
    labels: ["venue address", "event address", "ceremony address"],
    field: "venueAddress",
    label: "Project venue address",
  },
  {
    labels: ["client", "couple", "client name", "couple names"],
    field: "clientName",
    label: "Project client",
  },
  {
    labels: ["timezone", "time zone"],
    field: "timezone",
    label: "Project timezone",
  },
] as const;

export function verifiedPrefill(
  projectId: string,
  project: FactSource,
  sections: unknown,
) {
  const answers: Record<string, unknown> = {};
  const answerProvenance: Record<string, unknown> = {};
  const sectionValues = Array.isArray(sections) ? sections : [];
  for (const section of sectionValues) {
    const sectionRecord = plainRecord(section);
    const fields = Array.isArray(sectionRecord.fields)
      ? sectionRecord.fields
      : [];
    for (const candidate of fields) {
      const field = plainRecord(candidate);
      const fieldId = String(field.id ?? "");
      const label = normalizedLabel(field.label ?? field.id);
      const alias = projectFactAliases.find((item) =>
        item.labels.some((candidateLabel) => candidateLabel === label),
      );
      if (!fieldId || !alias) continue;
      const value = project.get(alias.field);
      if (
        value === null ||
        value === undefined ||
        (typeof value === "string" && !value.trim())
      )
        continue;
      answers[fieldId] = value;
      answerProvenance[fieldId] = {
        sourceType: "project_fact",
        sourceId: projectId,
        sourceField: alias.field,
        label: alias.label,
        verified: true,
      };
    }
  }
  return { answers, answerProvenance };
}
