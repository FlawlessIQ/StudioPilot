/**
 * The part of a client's brief the crew need, and only that part.
 *
 * Crew never saw the questionnaire at all — they can't read responses, and the
 * crew workspace never showed them — so the answers that matter most on the day
 * stayed with the studio: who must not be photographed, whether under-18s will
 * be, what to handle carefully, what the venue forbids. For a sports day with
 * children in front of the camera, that list is the one thing a second shooter
 * most needs, and it had no way to reach them.
 *
 * But a client's brief also holds things crew have no business reading —
 * billing contacts, who approves the selects, a couple's private email. So
 * this is an allowlist, not a filter: a field reaches crew only when it is
 * marked crew-visible, or when it is one of the starter fields known to be for
 * the day. A studio-internal note never does.
 *
 * Pure. Duplicated at functions/src/planning/crew-brief.ts, which writes the
 * projection crew can read; tests/crew-brief.test.ts keeps the copies equal.
 */

export type BriefField = {
  id: string;
  label: string;
  type: string;
  internalOnly?: boolean;
  /** Explicitly shared with crew, or explicitly not. Absent falls back to the starter list. */
  crewVisible?: boolean;
};

export type CrewBriefItem = {
  fieldId: string;
  label: string;
  text: string;
};

export type CrewBrief = {
  /** Read before shooting: who must not appear, minors, restrictions, sensitivities. */
  beforeYouShoot: CrewBriefItem[];
  /** Everything else crew use on the day. */
  onTheDay: CrewBriefItem[];
};

/**
 * Starter fields that are for the day, by id, across the wedding, corporate and
 * sports briefs. A studio's own questionnaire uses crewVisible instead.
 */
export const crewStarterFieldIds: ReadonlySet<string> = new Set([
  // wedding
  "day-of-contact",
  "ceremony-address",
  "reception-address",
  "getting-ready",
  "first-look",
  "planner",
  "videographer",
  "must-have-groups",
  "sensitivities",
  "ceremony-time",
  "sunset-priority",
  "end-time",
  "accessibility",
  "restrictions",
  "social-consent",
  "guest-count",
  // corporate
  "on-site-contact",
  "address",
  "access-notes",
  "load-in",
  "power",
  "shot-priorities",
  "brand-guidelines",
  // corporate and sports
  "headcount",
  "no-photo-list",
  // sports
  "day-contact",
  "venue-address",
  "arrival-time",
  "schedule",
  "weather-plan",
  "teams",
  "minors-present",
  "consent-on-file",
]);

/** The answers a photographer must have read before lifting a camera. */
const beforeYouShootIds: ReadonlySet<string> = new Set([
  "no-photo-list",
  "minors-present",
  "consent-on-file",
  "sensitivities",
  "restrictions",
  "accessibility",
  "social-consent",
]);

export function fieldReachesCrew(field: BriefField): boolean {
  if (field.crewVisible === true) return true;
  if (field.crewVisible === false) return false;
  // A studio-internal note stays internal unless someone deliberately shared it.
  if (field.internalOnly === true) return false;
  return crewStarterFieldIds.has(field.id);
}

/** An answer as a sentence fragment, or "" when there's nothing to say. */
export function answerText(type: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") {
    if (type === "acknowledgement") return value ? "Confirmed" : "Not confirmed";
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value))
    return value
      .map((item) => answerText(type, item))
      .filter(Boolean)
      .join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Uploaded files carry a name; nothing else about them is crew's to open.
    if (typeof record.name === "string" && Object.keys(record).length <= 4)
      return record.name;
    return Object.values(record)
      .map((item) => answerText(type, item))
      .filter(Boolean)
      .join(" · ");
  }
  return "";
}

export function buildCrewBrief(input: {
  sections: unknown;
  answers: Record<string, unknown>;
}): CrewBrief {
  const brief: CrewBrief = { beforeYouShoot: [], onTheDay: [] };
  const sections = Array.isArray(input.sections) ? input.sections : [];
  for (const section of sections) {
    const fields = (section as { fields?: unknown }).fields;
    if (!Array.isArray(fields)) continue;
    for (const raw of fields) {
      const field = raw as BriefField;
      if (typeof field?.id !== "string" || !fieldReachesCrew(field)) continue;
      const value = input.answers[field.id];
      // A file is never passed to crew, only the fact that one exists would be,
      // and that isn't useful on the day.
      if (field.type === "file") continue;
      // "No" to minors is still worth saying; an empty answer isn't.
      const text = answerText(field.type, value);
      if (!text) continue;
      const critical = beforeYouShootIds.has(field.id);
      const item: CrewBriefItem = {
        fieldId: field.id,
        label:
          field.id === "minors-present" && text === "Yes"
            ? "Under-18s will be photographed"
            : String(field.label ?? field.id),
        text,
      };
      (critical ? brief.beforeYouShoot : brief.onTheDay).push(item);
    }
  }
  // The do-not-photograph list leads, whatever order the form asked it in.
  brief.beforeYouShoot.sort(
    (left, right) =>
      Number(right.fieldId === "no-photo-list") - Number(left.fieldId === "no-photo-list"),
  );
  return brief;
}
