/**
 * Cue's drafts replace their own earlier versions instead of piling up.
 *
 * Cue proposes a draft or a task each time it is asked about a job, and
 * nothing retired the last one: a job asked about for a fortnight carried
 * fifteen pending versions of "remind them about the retainer", written after
 * the retainer was paid, each one Approve & send from emailing the couple for
 * money they had sent (docs/ui-audit-2026-09-27.md).
 *
 * Two rules, both applied when Cue saves a turn's proposals:
 *   - a new proposal replaces pending Cue proposals on the same job about the
 *     same thing (same kind, recipient and subject);
 *   - a proposal that is out of date for the job — a retainer reminder on a
 *     booked job, anything on a cancelled one — is never created, and any
 *     pending Cue proposal like it is retired.
 *
 * The same subjects and staleness rule as the job page's grouping,
 * features/ai/prepared-groups.ts. functions/ is a separate package with no
 * "@/features" path, so it is duplicated here; tests/cue-supersede.test.ts
 * keeps the two in step.
 */

type Json = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value : "");
const object = (value: unknown): Json =>
  value && typeof value === "object" ? (value as Json) : {};

/** The instruction versions Cue's own proposals carry. Only these are retired. */
export const CUE_PROPOSAL_VERSIONS = new Set(["copilot_proposal_v1", "copilot_action_v1"]);

const TOPICS: Array<[string, RegExp]> = [
  ["retainer", /\bretainer\b|\bdeposit\b/i],
  ["final_balance", /final (balance|invoice|payment)/i],
  ["questionnaire", /questionnaire|planning question|details form/i],
  ["run_of_show", /run of show|schedule confirmation|timeline/i],
  ["crew", /\bcrew\b|second photographer|photographer role|videographer role|staff the/i],
  ["gallery", /gallery|delivery/i],
  ["review", /\breview request|\bleave a review/i],
];

export function proposalTopic(action: Json): string | null {
  const output = object(action.structuredOutput);
  const haystack = [
    text(action.title),
    text(output.subject),
    text(output.purpose),
    text(output.label),
  ].join(" ");
  return TOPICS.find(([, pattern]) => pattern.test(haystack))?.[0] ?? null;
}

/**
 * The records a proposal answers beyond the job and its client. Proposals
 * answering different records are different decisions (see the job page's
 * `answeredRecords`, features/ai/prepared-groups.ts).
 */
export function answeredRecords(action: Json): string {
  const sources = Array.isArray(action.sourceReferences) ? action.sourceReferences : [];
  return sources
    .map(object)
    .filter((source) => !["project", "contact"].includes(text(source.entityType)))
    .map((source) => `${text(source.entityType)}:${text(source.entityId)}`)
    .sort()
    .join(",");
}

/** What a proposal is about: two with the same key are versions of one decision. */
export function proposalKey(action: Json): string {
  const output = object(action.structuredOutput);
  const topic = proposalTopic(action);
  const subject =
    topic ?? text(action.title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return [
    text(action.projectId),
    text(action.capability),
    text(output.recipientEmail).toLowerCase(),
    answeredRecords(action),
    subject || text(action.id),
  ].join("|");
}

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

/** Why a proposal is out of date for a job in this state, or null. */
export function staleReason(topic: string | null, projectState: string): string | null {
  if (topic === "retainer" && RETAINER_SETTLED.has(projectState))
    return "The retainer is already paid — this job is booked.";
  if (["CANCELLED", "ARCHIVED"].includes(projectState))
    return "This job is no longer going ahead.";
  return null;
}

/**
 * Which pending proposals a turn retires, and why.
 *
 * `pending` is what is already waiting on the jobs this turn touched;
 * `created` is what this turn is about to save. Only Cue's own drafts are
 * touched: a draft another part of StudioCue prepared is not Cue's to retire.
 */
export function proposalsToRetire(
  pending: Json[],
  created: Json[],
  projectStates: Map<string, string>,
): Array<{ id: string; note: string }> {
  const newKeys = new Set(created.map(proposalKey));
  const retire: Array<{ id: string; note: string }> = [];
  for (const action of pending) {
    if (text(action.status) !== "review_required") continue;
    if (!CUE_PROPOSAL_VERSIONS.has(text(action.instructionVersion))) continue;
    const stale = staleReason(
      proposalTopic(action),
      projectStates.get(text(action.projectId)) ?? "",
    );
    if (stale) retire.push({ id: text(action.id), note: `Out of date: ${stale}` });
    else if (newKeys.has(proposalKey(action)))
      retire.push({ id: text(action.id), note: "Replaced by a newer draft from Cue." });
  }
  return retire;
}
