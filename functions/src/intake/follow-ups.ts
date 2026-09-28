import type { Firestore, DocumentSnapshot } from "firebase-admin/firestore";
import { withInquiryLink } from "./inquiry-link.js";

/**
 * Following up an inquiry that went quiet (docs/lead-management-plan-2026-09-28.md,
 * phase 5): a nudge drafted on day 3, another on day 7, and on day 14 an
 * offer to close it as "went quiet".
 *
 * Counted from a *round*: the studio's last message before the couple went
 * quiet. The nudges are themselves messages the studio sends, so counting
 * from the latest outbound would restart the clock with every nudge and send
 * the day-3 one for ever. A round ends when the couple writes (their move
 * now) or the studio says they replied elsewhere, and the next quiet spell
 * starts a new one.
 *
 * Nudges are fixed templates, not model-written, and still wait for the
 * studio's tap: a nudge to a couple who already answered in the studio's own
 * inbox is the one mistake this must not make, and StudioCue cannot see that
 * inbox. Nothing here sends.
 */

const DAY = 86_400_000;
export const FIRST_NUDGE_DAYS = 3;
export const SECOND_NUDGE_DAYS = 7;
export const CLOSE_OFFER_DAYS = 14;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

export type FollowUpRound = {
  startedAt: string;
  firstDraftedAt: string | null;
  secondDraftedAt: string | null;
  closeSuggestedAt: string | null;
};

export type FollowUpStep =
  | { kind: "none"; round: FollowUpRound | null }
  | { kind: "first" | "second" | "close"; round: FollowUpRound };

/**
 * What this inquiry is due, given its thread and the round so far. Pure.
 *
 * `heardElsewhereAt` is the studio saying the couple answered outside
 * StudioCue: it ends the round like an inbound message would.
 */
export function followUpStep(input: {
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  heardElsewhereAt: string | null;
  closeDeferredUntil: string | null;
  round: FollowUpRound | null;
  now: string;
}): FollowUpStep {
  const coupleSpokeLast = later(input.lastInboundAt, input.heardElsewhereAt);
  // Nothing sent yet, or the couple (or news of them) came after the studio's
  // last word: their move is done, it's the studio's turn — no round.
  if (!input.lastOutboundAt) return { kind: "none", round: null };
  if (coupleSpokeLast && coupleSpokeLast > input.lastOutboundAt && input.heardElsewhereAt !== coupleSpokeLast) {
    return { kind: "none", round: null };
  }
  const start = later(input.lastOutboundAt, input.heardElsewhereAt)!;
  const stale =
    !input.round ||
    (input.lastInboundAt !== null && input.lastInboundAt > input.round.startedAt) ||
    (input.heardElsewhereAt !== null && input.heardElsewhereAt > input.round.startedAt);
  const round: FollowUpRound = stale
    ? { startedAt: start, firstDraftedAt: null, secondDraftedAt: null, closeSuggestedAt: null }
    : input.round!;
  const days = (Date.parse(input.now) - Date.parse(round.startedAt)) / DAY;
  if (days >= CLOSE_OFFER_DAYS && !round.closeSuggestedAt) {
    const deferred = input.closeDeferredUntil && input.closeDeferredUntil > input.now;
    if (!deferred) return { kind: "close", round };
  }
  if (days >= SECOND_NUDGE_DAYS && round.firstDraftedAt && !round.secondDraftedAt) {
    return { kind: "second", round };
  }
  if (days >= FIRST_NUDGE_DAYS && !round.firstDraftedAt) return { kind: "first", round };
  return { kind: "none", round };
}

function longDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/** The nudge itself, in the studio's voice. */
export function followUpCopy(input: {
  which: "first" | "second";
  firstName: string | null;
  eventDate: string | null;
  studioName: string;
}): { subject: string; body: string } {
  const hello = input.firstName ? `Hi ${input.firstName},` : "Hi there,";
  const on = input.eventDate ? ` on ${longDate(input.eventDate)}` : "";
  const body =
    input.which === "first"
      ? `${hello}\n\nJust checking my note reached you — I'd love to hear more about your plans for the day${on}.\n\nWarmly,\n${input.studioName}`
      : `${hello}\n\nI know planning gets busy! I'd still love to photograph your day${on}, and I'm happy to talk whenever suits. If your plans have changed, no problem at all — a quick note lets me know.\n\nWarmly,\n${input.studioName}`;
  return {
    subject: input.which === "first" ? "Following up on your inquiry" : "Still thinking it over?",
    body,
  };
}

type Conversation = { lastInboundAt: string | null; lastOutboundAt: string | null };

async function threadOf(db: Firestore, tenantId: string, lead: DocumentSnapshot): Promise<Conversation> {
  const projectId = text(lead.get("projectId"));
  const threads = await db
    .collection("conversations")
    .where("tenantId", "==", tenantId)
    .where(projectId ? "projectId" : "leadId", "==", projectId || lead.id)
    .limit(20)
    .get();
  let lastInboundAt: string | null = null;
  let lastOutboundAt: string | null = null;
  for (const thread of threads.docs) {
    if (text(thread.get("movedTo"))) continue;
    const lastAt = text(thread.get("lastMessageAt")) || null;
    const direction = text(thread.get("lastMessageDirection"));
    lastInboundAt = later(lastInboundAt, text(thread.get("lastInboundAt")) || (direction === "inbound" ? lastAt : null));
    lastOutboundAt = later(lastOutboundAt, text(thread.get("lastOutboundAt")) || (direction === "outbound" ? lastAt : null));
  }
  return { lastInboundAt, lastOutboundAt };
}

async function retirePendingNudges(db: Firestore, tenantId: string, leadId: string, now: string, note: string) {
  const pending = await db
    .collection("aiActions")
    .where("tenantId", "==", tenantId)
    .where("capability", "==", "inquiry_follow_up")
    .where("status", "==", "review_required")
    .get();
  for (const draft of pending.docs) {
    const output = (draft.get("structuredOutput") ?? {}) as Record<string, unknown>;
    if (output.leadId !== leadId) continue;
    await draft.ref.update({
      status: "dismissed",
      decision: { actorId: "follow-up-scheduler", action: "dismissed", decidedAt: now, note, editDelta: null },
      updatedAt: now,
    });
  }
}

/**
 * One inquiry's follow-up, brought up to date: draft what's due, offer the
 * close, and withdraw nudges the couple has since made pointless. Re-reads
 * everything each time, so a nudge queued days ago never outlives the reason
 * for it.
 */
export async function advanceFollowUp(
  db: Firestore,
  lead: DocumentSnapshot,
  now: string,
): Promise<FollowUpStep["kind"] | "skipped"> {
  const tenantId = text(lead.get("tenantId"));
  const status = text(lead.get("status"));
  if (!["new", "converted"].includes(status) || lead.get("needsConfirmation") === true || lead.get("notInquiry") === true) {
    return "skipped";
  }
  const projectId = text(lead.get("projectId"));
  const project = projectId ? await db.doc(`projects/${projectId}`).get() : null;
  // Past the first conversation — a consultation booked — the journey takes
  // over; follow-ups are for couples who haven't taken the next step.
  if (project && (project.get("state") !== "LEAD" || project.get("archivedAt"))) {
    await retirePendingNudges(db, tenantId, lead.id, now, "The inquiry moved on.");
    return "skipped";
  }
  const email = text(lead.get("email"));
  if (!email) return "skipped";
  const thread = await threadOf(db, tenantId, lead);
  const step = followUpStep({
    lastInboundAt: thread.lastInboundAt,
    lastOutboundAt: thread.lastOutboundAt,
    heardElsewhereAt: text(lead.get("heardElsewhereAt")) || null,
    closeDeferredUntil: text(lead.get("closeDeferredUntil")) || null,
    round: (lead.get("followUpRound") as FollowUpRound | undefined) ?? null,
    now,
  });
  if (!step.round) {
    if (lead.get("followUpRound")) {
      await retirePendingNudges(db, tenantId, lead.id, now, "The couple wrote back.");
      await lead.ref.update({ followUpRound: null, closeSuggestedAt: null, updatedAt: now });
    }
    return "none";
  }
  const round = { ...step.round };
  if (step.kind === "first" || step.kind === "second") {
    const tenant = await db.doc(`tenants/${tenantId}`).get();
    const studioName = text(tenant.get("brandName")) || text(tenant.get("businessName")) || "Your photographer";
    const copy = followUpCopy({
      which: step.kind,
      firstName: text(lead.get("firstName")) || null,
      eventDate: text(lead.get("eventDate")) || null,
      studioName,
    });
    const linked = await withInquiryLink(db, { tenantId, leadId: lead.id, body: copy.body, now });
    const actionId = `ai_followup_${lead.id}_${Date.parse(round.startedAt)}_${step.kind}`.slice(0, 200);
    const name = text(lead.get("displayName")) || text(lead.get("firstName")) || email;
    await db.doc(`aiActions/${actionId}`).set(
      {
        id: actionId,
        tenantId,
        projectId: projectId || null,
        actorId: "follow-up-scheduler",
        actorType: "system",
        title: `Follow up with ${name}`,
        capability: "inquiry_follow_up",
        authorityBoundary: "draft_requires_review",
        status: "review_required",
        modelProvider: "studiocue",
        modelVersion: "template",
        instructionVersion: "inquiry_follow_up_v1",
        outputSchemaVersion: "message_draft_output_v1",
        sourceReferences: [{ entityType: "lead", entityId: lead.id, versionId: null, label: `Inquiry from ${name}`, locator: null }],
        structuredOutput: {
          trigger: "inquiry_follow_up",
          followUp: step.kind,
          quietSince: round.startedAt,
          subject: copy.subject,
          body: linked.body,
          recipientEmail: email,
          recipientName: text(lead.get("displayName")) || null,
          leadId: lead.id,
          contactId: text(lead.get("primaryContactId")) || null,
          bookingLinkIncluded: linked.linked,
        },
        confidence: { overall: 1, label: "high", uncertainFields: [] },
        validation: { status: "passed", issues: [] },
        decision: null,
        downstreamCommand: null,
        snoozedUntil: null,
        createdAt: now,
        updatedAt: now,
        createdBy: "follow-up-scheduler",
        updatedBy: "follow-up-scheduler",
        archivedAt: null,
      },
      { merge: true },
    );
    if (step.kind === "first") round.firstDraftedAt = now;
    else round.secondDraftedAt = now;
  } else if (step.kind === "close") {
    round.closeSuggestedAt = now;
  }
  await lead.ref.update({
    followUpRound: round,
    closeSuggestedAt: round.closeSuggestedAt,
    updatedAt: now,
  });
  return step.kind;
}

/**
 * A closed inquiry reopens when the couple writes again: to the stage it
 * closed from, and the lead back to open. Called on every inbound message;
 * does nothing unless something was closed.
 */
export async function reopenOnReply(
  db: Firestore,
  input: { tenantId: string; projectId: string | null; leadId: string | null; now: string },
): Promise<boolean> {
  let reopened = false;
  if (input.projectId) {
    const project = await db.doc(`projects/${input.projectId}`).get();
    if (project.exists && project.get("tenantId") === input.tenantId && project.get("state") === "LOST") {
      const back = text(project.get("lostFromState")) || "LEAD";
      await project.ref.update({
        state: back,
        lostReason: null,
        lostAt: null,
        stateVersion: Number(project.get("stateVersion") ?? 0) + 1,
        reopenedAt: input.now,
        updatedAt: input.now,
        updatedBy: "inbound-email",
      });
      const leads = await db
        .collection("leads")
        .where("tenantId", "==", input.tenantId)
        .where("projectId", "==", input.projectId)
        .get();
      for (const lead of leads.docs) {
        if (lead.get("status") === "lost") {
          await lead.ref.update({ status: "converted", lostReason: null, lostAt: null, updatedAt: input.now });
        }
      }
      reopened = true;
    }
  } else if (input.leadId) {
    const lead = await db.doc(`leads/${input.leadId}`).get();
    if (lead.exists && lead.get("tenantId") === input.tenantId && lead.get("status") === "lost") {
      await lead.ref.update({ status: "new", lostReason: null, lostAt: null, reopenedAt: input.now, updatedAt: input.now });
      reopened = true;
    }
  }
  if (reopened) {
    const id = `inquiry_reopened_${input.projectId ?? input.leadId}_${Date.parse(input.now)}`;
    await db.doc(`actionReceipts/${id}`).set({
      id,
      tenantId: input.tenantId,
      projectId: input.projectId,
      title: "A closed inquiry wrote back — it's open again",
      status: "completed",
      actor: "inbound-email",
      createdAt: input.now,
      updatedAt: input.now,
    });
  }
  return reopened;
}
