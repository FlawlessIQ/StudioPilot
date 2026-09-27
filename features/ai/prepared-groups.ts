/**
 * Folding a job's prepared decisions into one row per thing to decide.
 *
 * Cue proposes a draft each time it is asked about a job and nothing retires
 * the last one, so a job asked about for a fortnight carried fifteen versions
 * of "remind them about the retainer" — worded differently each time, all
 * pending, each a full card (docs/ui-audit-2026-09-27.md). Grouping is by
 * what the decision is about (kind, capability, recipient, topic), newest
 * first; the older versions can be dismissed together.
 */

export type PreparedRecord = Record<string, unknown> & { id: string };

export type PreparedEntry = {
  kind: "ai" | "automation";
  record: PreparedRecord;
};

export type PreparedGroup<T extends PreparedEntry = PreparedEntry> = {
  key: string;
  /** The newest version: the one shown and opened. */
  lead: T;
  /** Every version, newest first (the lead included). */
  entries: T[];
  topic: string | null;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/**
 * What a decision is about, when it is one of the recurring subjects. Worded
 * differently by every draft ("Remind the client about their overdue retainer
 * payment", "A gentle reminder … retainer", "Create a task to follow up on the
 * overdue retainer"), so matched by subject rather than by title.
 */
const TOPICS: Array<[string, RegExp]> = [
  ["retainer", /\bretainer\b|\bdeposit\b/i],
  ["final_balance", /final (balance|invoice|payment)/i],
  ["questionnaire", /questionnaire|planning question|details form/i],
  ["run_of_show", /run of show|schedule confirmation|timeline/i],
  ["crew", /\bcrew\b|second photographer|photographer role|videographer role|staff the/i],
  ["gallery", /gallery|delivery/i],
  ["review", /\breview request|\bleave a review/i],
];

export function preparedTopic(entry: PreparedEntry): string | null {
  const output = object(entry.record.structuredOutput);
  const haystack = [
    text(entry.record.title),
    text(output.subject),
    text(object(entry.record.proposedChange).summary),
  ].join(" ");
  return TOPICS.find(([, pattern]) => pattern.test(haystack))?.[0] ?? null;
}

/**
 * The records a draft answers, other than the job and the client every draft
 * on the job shares. Two drafts answering different records — two forms the
 * couple filled in, two emails they sent — are two decisions, however alike
 * their titles: Gabe and Dionne's planning questionnaire and venue form each
 * got a follow-up titled "Approve questionnaire follow-up", and folding them
 * together offered to dismiss one as an "older version" of the other.
 */
export function answeredRecords(record: PreparedRecord): string {
  const sources = Array.isArray(record.sourceReferences) ? record.sourceReferences : [];
  return sources
    .map(object)
    .filter((source) => !["project", "contact"].includes(text(source.entityType)))
    .map((source) => `${text(source.entityType)}:${text(source.entityId)}`)
    .sort()
    .join(",");
}

function groupKey(entry: PreparedEntry, topic: string | null): string {
  const record = entry.record;
  const output = object(record.structuredOutput);
  const recipient = text(output.recipientEmail).toLowerCase();
  // Without a recognised topic, only identical titles are the same decision.
  const subject = topic ?? text(record.title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return [entry.kind, text(record.capability), recipient, answeredRecords(record), subject || record.id].join("|");
}

function timeOf(record: PreparedRecord): number {
  const value = Date.parse(text(record.updatedAt) || text(record.createdAt));
  return Number.isFinite(value) ? value : 0;
}

export function groupPrepared<T extends PreparedEntry>(entries: T[]): PreparedGroup<T>[] {
  const groups = new Map<string, { topic: string | null; entries: T[] }>();
  for (const entry of entries) {
    const topic = preparedTopic(entry);
    const key = groupKey(entry, topic);
    const group = groups.get(key) ?? { topic, entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const sorted = [...group.entries].sort((a, b) => timeOf(b.record) - timeOf(a.record));
      return { key, lead: sorted[0]!, entries: sorted, topic: group.topic };
    })
    .sort((a, b) => timeOf(b.lead.record) - timeOf(a.lead.record));
}

/** States in which the booking gate has already seen the retainer paid. */
const RETAINER_SETTLED = new Set([
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
  "CLOSED",
]);

/**
 * Why a group is out of date for this job, or null. A job is only booked once
 * its retainer is paid, so a retainer reminder on a booked job asks the couple
 * for money they have already sent — the drafts behind this rule were one
 * "Approve & send" from doing exactly that.
 */
export function staleReason(topic: string | null, projectState: string): string | null {
  if (topic === "retainer" && RETAINER_SETTLED.has(projectState))
    return "The retainer is already paid — this job is booked.";
  if (["CANCELLED", "ARCHIVED"].includes(projectState))
    return "This job is no longer going ahead.";
  return null;
}
