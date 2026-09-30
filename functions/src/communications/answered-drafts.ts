import type { Firestore, WriteBatch } from "firebase-admin/firestore";

/**
 * Reply drafts the studio has just answered by hand.
 *
 * "Draft reply" in the inbox puts the AI draft in the reply box; the studio
 * edits it and presses Send, which goes through replyToConversation — not
 * through the draft's approval. So the draft stayed `review_required`, came
 * back on Today as "Reply to …", and one tap on Approve sent the couple the
 * same answer a second time. Any reply the studio writes itself makes a pending
 * reply draft for the same conversation (or inquiry, or job) moot, so sending
 * one puts the others away.
 *
 * Only drafts that *answer* the couple are touched. A T-30 schedule
 * confirmation or a review request is its own message, not a reply, and a
 * studio's note about something else does not make it moot.
 */
export const REPLY_DRAFT_CAPABILITIES: readonly string[] = [
  "inquiry_reply_draft",
  "inquiry_follow_up",
];

export type AnsweredScope = {
  /** The thread the studio replied in. */
  conversationId: string | null;
  /** The inquiry that thread belongs to. */
  leadId: string | null;
  /** The job the message was sent on. */
  projectId: string | null;
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Whether this open draft is answered by a studio message sent in `scope`. Pure. */
export function isAnsweredReplyDraft(
  action: Record<string, unknown>,
  scope: AnsweredScope,
): boolean {
  if (action.status !== "review_required") return false;
  const capability = String(action.capability ?? "");
  const output = record(action.structuredOutput);
  // Anything drafted into this very thread is a reply to it, whatever it was
  // filed as (a planning follow-up drafted in the thread included).
  if (scope.conversationId && action.conversationId === scope.conversationId)
    return (
      REPLY_DRAFT_CAPABILITIES.includes(capability) ||
      capability === "planning_followup_draft"
    );
  // A draft that answers a different thread — the other half of the couple,
  // writing separately — is not answered by this one.
  if (typeof action.conversationId === "string" && action.conversationId)
    return false;
  if (!REPLY_DRAFT_CAPABILITIES.includes(capability)) return false;
  if (scope.leadId && output.leadId === scope.leadId) return true;
  if (scope.projectId && action.projectId === scope.projectId) return true;
  return false;
}

/**
 * Adds the dismissal of every answered draft to `batch`, so it commits with
 * the send itself: either both happen or neither does. Returns the ids.
 *
 * The lead and job lookups are equality-only (served by merged single-field
 * indexes); a lookup that fails is skipped rather than failing the studio's
 * reply — a draft left behind is the old behaviour, a reply that will not go
 * is worse.
 */
export async function dismissAnsweredReplyDrafts(
  db: Firestore,
  batch: WriteBatch,
  input: AnsweredScope & { tenantId: string; actorId: string; now: string },
): Promise<string[]> {
  const base = db
    .collection("aiActions")
    .where("tenantId", "==", input.tenantId)
    .where("status", "==", "review_required");
  const lookups = [
    input.conversationId
      ? base.where("conversationId", "==", input.conversationId)
      : null,
    input.leadId ? base.where("structuredOutput.leadId", "==", input.leadId) : null,
    input.projectId ? base.where("projectId", "==", input.projectId) : null,
  ].filter((query) => query !== null);
  const results = await Promise.all(
    lookups.map((query) =>
      query
        .limit(50)
        .get()
        .then((snapshot) => snapshot.docs)
        .catch((error: unknown) => {
          console.warn("answered reply draft lookup failed", error);
          return [];
        }),
    ),
  );
  const dismissed = new Set<string>();
  for (const document of results.flat()) {
    if (dismissed.has(document.id)) continue;
    if (!isAnsweredReplyDraft(document.data(), input)) continue;
    dismissed.add(document.id);
    batch.update(
      document.ref,
      {
        status: "dismissed",
        decision: {
          actorId: input.actorId,
          action: "dismissed",
          decidedAt: input.now,
          note: "Answered by the studio's own reply.",
          editDelta: null,
          emailJobId: null,
        },
        dismissedReason: "answered_by_studio_reply",
        snoozedUntil: null,
        updatedAt: input.now,
        updatedBy: input.actorId,
      },
      // Only as read: a draft approved in another tab since the lookup must
      // not be relabelled "dismissed" after it has gone out.
      { lastUpdateTime: document.updateTime },
    );
  }
  return [...dismissed];
}
