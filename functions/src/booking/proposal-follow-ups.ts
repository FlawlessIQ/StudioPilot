import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { mayContactClient } from "../post-event/client-outreach.js";

/**
 * Following up a proposal the client hasn't answered: Cue drafts a short
 * note on day 3 and day 7 after it went out, and the studio sends it with one
 * tap (docs/positioning-office-manager-plan-2026-10-06.md, phase 5).
 *
 * Before this, a sent proposal sat until the client acted or it expired; the
 * `package_follow_up` template had no trigger.
 *
 * Drafted only while it's worth asking:
 * - the proposal is still `sent` or `viewed`, and its offer hasn't expired;
 * - the job is still at the proposal stage and the studio hasn't stopped it
 *   (put away, paused, called off);
 * - the client hasn't written since it was sent — then it's the studio's move;
 * - no agreement sent with it is out for signature: a combined proposal is
 *   chased by the contract's own reminders (contracts/reminders.ts), and two
 *   chasers for one decision is one too many.
 *
 * One waiting at a time, latest only (a proposal first seen on day 8 gets the
 * day-7 note, not both), and a draft the studio declines or dismisses ends
 * the follow-ups for that proposal. Drafts for a proposal that has since been
 * answered, withdrawn or replaced are withdrawn here each day; the proposal is
 * also read again when the studio approves (ai/actions.ts) and as the email
 * goes (operations/jobs.ts `proposalFollowUpId`).
 *
 * Tap to send, always: a fixed template, but StudioCue can't see the studio's
 * own inbox, where the client may already have answered.
 */

export const PROPOSAL_FOLLOW_UP_DAYS = [3, 7] as const;
export const PROPOSAL_FOLLOW_UP_VERSION = "proposal_follow_up_v1";

const DAY_MS = 86_400_000;
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const OPEN = new Set(["sent", "viewed"]);

export function proposalFollowUpActionId(proposalId: string, days: number): string {
  return `ai_proposal_followup_${proposalId}_${days}`;
}

/** Pure: whether a proposal is still open for the client to answer. */
export function proposalStillOpen(proposal: { status?: unknown; expiresAt?: unknown } | null | undefined, now: string): boolean {
  if (!proposal || !OPEN.has(text(proposal.status))) return false;
  const expires = Date.parse(text(proposal.expiresAt));
  return Number.isFinite(expires) && expires > Date.parse(now);
}

export type PriorFollowUp = { days: number; status: string; decision: string | null };

/** Pure: the follow-up to draft now (3 or 7 days), or null. */
export function proposalFollowUpDue(input: {
  proposal: { status?: unknown; sentAt?: unknown; expiresAt?: unknown };
  /** When the client last wrote to the studio through StudioCue. */
  lastInboundAt: string | null;
  prior: readonly PriorFollowUp[];
  now: string;
}): number | null {
  if (!proposalStillOpen(input.proposal, input.now)) return null;
  const sentAt = text(input.proposal.sentAt);
  if (!sentAt) return null;
  if (input.lastInboundAt && input.lastInboundAt > sentAt) return null;
  if (input.prior.some((draft) => draft.status === "review_required")) return null;
  if (input.prior.some((draft) => draft.decision === "rejected" || draft.decision === "dismissed")) return null;
  const elapsed = Math.floor(
    (Date.parse(`${input.now.slice(0, 10)}T00:00:00Z`) - Date.parse(`${sentAt.slice(0, 10)}T00:00:00Z`)) / DAY_MS,
  );
  const due = [...PROPOSAL_FOLLOW_UP_DAYS].reverse().find((days) => elapsed >= days);
  if (due === undefined) return null;
  // Latest only, each once.
  if (input.prior.some((draft) => draft.days >= due)) return null;
  return due;
}

const longDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/**
 * Pure: the follow-up itself, in the studio's voice (first person, like the
 * inquiry follow-ups the client may already have had). Never names Cue.
 */
export function proposalFollowUpCopy(input: {
  days: number;
  viewed: boolean;
  firstName: string | null;
  projectName: string;
  sentAt: string;
  expiresAt: string;
  studioName: string;
}): { subject: string; body: string; title: string } {
  const hello = input.firstName ? `Hi ${input.firstName},` : "Hi there,";
  const sign = `Warmly,\n${input.studioName}`;
  const until = longDate(input.expiresAt);
  const who = input.firstName ?? "the client";
  if (input.days >= 7)
    return {
      subject: "Still thinking it over?",
      body: [
        hello,
        "",
        `Just checking in on your proposal for ${input.projectName}. It's open until ${until}, and if you'd like to go ahead you can accept it using the button below.`,
        "",
        "If you'd like to change anything, or your plans have changed, no problem at all. A quick reply lets me know.",
        "",
        sign,
      ].join("\n"),
      title: `Follow up with ${who} on their proposal`,
    };
  if (!input.viewed)
    return {
      subject: "Did your proposal reach you?",
      body: [
        hello,
        "",
        `I sent over your proposal for ${input.projectName} on ${longDate(input.sentAt)} and wanted to make sure it reached you. You can look it over any time using the button below.`,
        "",
        "If you have questions, or you'd like to change anything about the coverage, just reply.",
        "",
        sign,
      ].join("\n"),
      title: `Check ${who} got their proposal`,
    };
  return {
    subject: "Any questions about your proposal?",
    body: [
      hello,
      "",
      `I hope the proposal for ${input.projectName} was helpful. If you have questions, or you'd like to adjust the coverage, just reply and we'll work it out together.`,
      "",
      `It's open until ${until}, and you can accept it using the button below whenever you're ready.`,
      "",
      sign,
    ].join("\n"),
    title: `Follow up with ${who} on their proposal`,
  };
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
}

async function lastInboundAt(db: Firestore, tenantId: string, projectId: string): Promise<string | null> {
  const threads = await db
    .collection("conversations")
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", projectId)
    .limit(20)
    .get();
  let latest: string | null = null;
  for (const thread of threads.docs) {
    if (text(thread.get("movedTo"))) continue;
    const inbound =
      text(thread.get("lastInboundAt")) ||
      (text(thread.get("lastMessageDirection")) === "inbound" ? text(thread.get("lastMessageAt")) : "");
    if (inbound && (!latest || inbound > latest)) latest = inbound;
  }
  return latest;
}

/** Withdraw drafts whose proposal was answered, withdrawn, replaced or expired since. */
async function retireClosedDrafts(db: Firestore, now: string): Promise<number> {
  const pending = await db
    .collection("aiActions")
    .where("instructionVersion", "==", PROPOSAL_FOLLOW_UP_VERSION)
    .where("status", "==", "review_required")
    .limit(500)
    .get();
  let retired = 0;
  for (const draft of pending.docs) {
    const proposalId = text(((draft.get("structuredOutput") ?? {}) as Record<string, unknown> & { proposalFollowUp?: { proposalId?: unknown } }).proposalFollowUp?.proposalId);
    const proposal = proposalId ? await db.doc(`proposals/${proposalId}`).get() : null;
    const open =
      proposal?.exists && proposal.get("tenantId") === draft.get("tenantId") && proposalStillOpen(proposal.data(), now);
    if (open) continue;
    await draft.ref.update({
      status: "dismissed",
      decision: {
        actorId: "proposal-follow-up",
        action: "dismissed",
        decidedAt: now,
        note: "The proposal was answered, withdrawn, replaced or expired.",
        editDelta: null,
      },
      updatedAt: now,
    });
    retired += 1;
  }
  return retired;
}

/** One proposal's follow-up, drafted if due. */
async function advanceProposal(db: Firestore, proposal: DocumentSnapshot, now: string): Promise<boolean> {
  const tenantId = text(proposal.get("tenantId"));
  const projectId = text(proposal.get("projectId"));
  if (!tenantId || !projectId) return false;
  const project = await db.doc(`projects/${projectId}`).get();
  if (!project.exists || project.get("tenantId") !== tenantId) return false;
  // The job has moved past the proposal (or never was at it), or the studio
  // stopped it.
  if (project.get("state") !== "PROPOSAL" || !mayContactClient(project.data())) return false;
  const client = (proposal.get("clientSnapshot") ?? {}) as { email?: unknown; displayName?: unknown };
  const email = text(client.email);
  if (!email) return false;

  const [contracts, inbound, snapshots] = await Promise.all([
    db.collection("contracts").where("tenantId", "==", tenantId).where("proposalId", "==", proposal.id).limit(5).get(),
    lastInboundAt(db, tenantId, projectId),
    db.getAll(...PROPOSAL_FOLLOW_UP_DAYS.map((days) => db.doc(`aiActions/${proposalFollowUpActionId(proposal.id, days)}`))),
  ]);
  if (contracts.docs.some((contract) => ["sent", "viewed"].includes(text(contract.get("status"))))) return false;
  const prior: PriorFollowUp[] = [];
  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) return;
    const decision = (snapshot.get("decision") ?? null) as { action?: unknown } | null;
    prior.push({ days: PROPOSAL_FOLLOW_UP_DAYS[index]!, status: text(snapshot.get("status")), decision: text(decision?.action) || null });
  });
  const days = proposalFollowUpDue({ proposal: proposal.data() ?? {}, lastInboundAt: inbound, prior, now });
  if (!days) return false;

  const tenant = await db.doc(`tenants/${tenantId}`).get();
  const studioName = text(tenant.get("brandName")) || text(tenant.get("businessName")) || "Your studio";
  const displayName = text(client.displayName) || null;
  const projectName = text(project.get("name")) || text(((proposal.get("eventSnapshot") ?? {}) as { name?: unknown }).name) || "your booking";
  const copy = proposalFollowUpCopy({
    days,
    viewed: text(proposal.get("status")) === "viewed" || Boolean(text(proposal.get("viewedAt"))),
    firstName: displayName?.split(" ")[0] ?? null,
    projectName,
    sentAt: text(proposal.get("sentAt")),
    expiresAt: text(proposal.get("expiresAt")),
    studioName,
  });
  const contactIds = Array.isArray(project.get("clientContactIds")) ? (project.get("clientContactIds") as unknown[]).map(String) : [];
  const actionId = proposalFollowUpActionId(proposal.id, days);
  await db.doc(`aiActions/${actionId}`).create({
    id: actionId,
    tenantId,
    projectId,
    actorId: "proposal-follow-up",
    actorType: "system",
    title: copy.title,
    capability: "delivery_message_draft",
    authorityBoundary: "draft_requires_review",
    status: "review_required",
    modelProvider: "studiocue",
    modelVersion: "template",
    instructionVersion: PROPOSAL_FOLLOW_UP_VERSION,
    outputSchemaVersion: "message_draft_output_v1",
    sourceReferences: [
      { entityType: "project", entityId: projectId, versionId: null, label: projectName, locator: null },
      { entityType: "proposal", entityId: proposal.id, versionId: null, label: `Proposal v${Number(proposal.get("version") ?? 1)}`, locator: null },
    ],
    structuredOutput: {
      trigger: "proposal_follow_up",
      subject: copy.subject,
      body: copy.body,
      recipientEmail: email,
      recipientName: displayName,
      contactId: contactIds[0] ?? null,
      projectName,
      highlights: [`Day ${days} after it was sent`, "Withdrawn if they answer first"],
      // Read again at approval and at send: an answered proposal is never chased.
      proposalFollowUp: {
        proposalId: proposal.id,
        days,
        actionLabel: "Review your proposal",
        actionUrl: `${appUrl()}/client/proposal`,
      },
    },
    confidence: { overall: 1, label: "high", uncertainFields: [] },
    validation: { status: "passed", issues: [] },
    decision: null,
    downstreamCommand: null,
    usage: { inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0, latencyMs: 0, estimatedMinutesSaved: 5 },
    failure: null,
    snoozedUntil: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy: "proposal-follow-up",
    updatedBy: "proposal-follow-up",
  });
  return true;
}

/**
 * The daily pass (run by intake/follow-up-scheduler.ts): withdraw drafts that
 * no longer apply, then draft what's due. One proposal failing never stops
 * the rest.
 */
export async function advanceProposalFollowUps(db: Firestore, now: string): Promise<{ drafted: number; retired: number }> {
  const retired = await retireClosedDrafts(db, now);
  const [sent, viewed] = await Promise.all([
    db.collection("proposals").where("status", "==", "sent").limit(1000).get(),
    db.collection("proposals").where("status", "==", "viewed").limit(1000).get(),
  ]);
  let drafted = 0;
  for (const proposal of [...sent.docs, ...viewed.docs]) {
    try {
      if (await advanceProposal(db, proposal, now)) drafted += 1;
    } catch (caught: unknown) {
      // A draft that already exists (a re-run racing itself) is not an error.
      if ((caught as { code?: unknown })?.code === 6) continue;
      console.warn(`[proposal-follow-up] ${proposal.id}: ${String(caught).slice(0, 160)}`);
    }
  }
  return { drafted, retired };
}
