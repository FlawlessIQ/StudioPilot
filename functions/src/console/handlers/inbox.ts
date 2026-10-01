import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { feedbackReplyAddress } from "../../feedback/reply-address.js";
import { applyFeedbackStatus } from "../../feedback/status.js";
import { consoleHandler, fail, type ConsoleAudit } from "../command-kit.js";
import { appUrl, platformEmailJob, shortToken, teamReplyAddress } from "../studio-owner.js";

/**
 * The Console inbox and issue tracker (docs/console.md, "Inbox and Issues").
 *
 * Feedback keeps two states apart: `status` is what the studio sees and what
 * triggers the planned/shipped emails; `triage` is the team's working state.
 * An issue gathers every piece of feedback about one thing, so the team sees
 * how many studios asked, and when the issue ships every one of them hears,
 * once each.
 */

const feedbackId = z.string().min(1).max(200);
const issueId = z.string().min(1).max(200);
const ISSUE_STATUSES = ["open", "planned", "in_progress", "shipped", "wont_do", "duplicate"] as const;

async function loadFeedback(db: Firestore, id: string) {
  const snapshot = await db.doc(`feedback/${id}`).get();
  if (!snapshot.exists) fail("FEEDBACK_NOT_FOUND");
  return snapshot;
}

/** Recount an issue's linked feedback and studios. */
async function recountIssue(db: Firestore, id: string, now: string) {
  const linked = await db.collection("feedback").where("issueId", "==", id).select("tenantId").get();
  const studios = new Set(linked.docs.map((doc) => String(doc.get("tenantId") ?? "")).filter(Boolean));
  await db.doc(`issues/${id}`).set({ feedbackCount: linked.size, studioCount: studios.size, tenantIds: [...studios], updatedAt: now }, { merge: true });
}

export const inboxHandlers = {
  setFeedbackTriage: consoleHandler({
    capability: "inbox.write",
    input: z.object({ feedbackIds: z.array(feedbackId).min(1).max(100), triage: z.enum(["new", "waiting", "closed"]) }),
    async run({ db, identity, now }, input) {
      const batch = db.batch();
      const audits: ConsoleAudit[] = [];
      for (const id of input.feedbackIds) {
        const feedback = await loadFeedback(db, id);
        batch.update(feedback.ref, { triage: input.triage, triagedAt: now, triagedBy: identity.uid, updatedAt: now });
        audits.push({ tenantId: String(feedback.get("tenantId")), entityType: "feedback", entityId: id, before: { triage: feedback.get("triage") ?? null }, after: { triage: input.triage } });
      }
      await batch.commit();
      return { result: { updated: input.feedbackIds.length, triage: input.triage }, audit: audits };
    },
  }),

  assignFeedback: consoleHandler({
    capability: "inbox.write",
    input: z.object({ feedbackIds: z.array(feedbackId).min(1).max(100), assigneeUid: z.string().min(1).max(200).nullable() }),
    async run({ db, now }, input) {
      let assigneeEmail: string | null = null;
      if (input.assigneeUid) {
        const admin = await db.doc(`platformAdmins/${input.assigneeUid}`).get();
        if (!admin.exists || admin.get("active") === false) fail("ASSIGNEE_NOT_ADMIN");
        assigneeEmail = admin.get("email") ?? null;
      }
      const batch = db.batch();
      for (const id of input.feedbackIds) batch.update(db.doc(`feedback/${id}`), { assigneeUid: input.assigneeUid, assigneeEmail, updatedAt: now });
      await batch.commit();
      return { result: { updated: input.feedbackIds.length }, audit: { tenantId: null, entityType: "feedback", entityId: input.feedbackIds.join(",").slice(0, 400), after: { assigneeUid: input.assigneeUid } } };
    },
  }),

  /**
   * Email the person who sent the feedback, from the team, and keep the reply
   * on the feedback's thread. Refused when they asked not to be contacted.
   */
  replyToFeedback: consoleHandler({
    capability: "inbox.write",
    input: z.object({ feedbackId, body: z.string().trim().min(2).max(6000), markWaiting: z.boolean().optional() }),
    async run({ db, identity, now }, input) {
      const feedback = await loadFeedback(db, input.feedbackId);
      if (feedback.get("followUpOk") !== true) fail("FEEDBACK_NO_CONTACT");
      const recipient = feedback.get("userEmail");
      if (typeof recipient !== "string" || !recipient.includes("@")) fail("FEEDBACK_NO_EMAIL");
      const message = db.collection("feedbackMessages").doc();
      const jobId = `console_feedback_reply_${input.feedbackId}_${shortToken()}`;
      const replyAddress = feedbackReplyAddress(input.feedbackId) ?? teamReplyAddress();
      const batch = db.batch();
      batch.create(message, {
        id: message.id,
        feedbackId: input.feedbackId,
        tenantId: feedback.get("tenantId") ?? null,
        direction: "outbound",
        visibleToSender: true,
        senderUserId: feedback.get("userId") ?? null,
        body: input.body,
        authorUid: identity.uid,
        authorEmail: identity.email ?? null,
        // Studios see "The StudioCue team", never a person.
        authorLabel: "The StudioCue team",
        emailJobId: jobId,
        createdAt: now,
      });
      batch.create(
        db.doc(`emailJobs/${jobId}`),
        platformEmailJob(
          jobId,
          {
            type: "feedback_reply",
            recipient,
            recipientName: feedback.get("userName") ?? null,
            replyAddress,
            customBody: input.body,
            feedbackId: input.feedbackId,
            feedbackMessage: feedback.get("message") ?? null,
            actionUrl: appUrl("/studio/help#feedback"),
            aboutTenantId: feedback.get("tenantId") ?? null,
          },
          now,
        ),
      );
      batch.update(feedback.ref, {
        triage: input.markWaiting ? "waiting" : (feedback.get("issueId") ? "linked" : (feedback.get("triage") ?? "new")),
        lastReplyAt: now,
        replyCount: FieldValue.increment(1),
        updatedAt: now,
      });
      await batch.commit();
      return {
        result: { feedbackId: input.feedbackId, messageId: message.id, threaded: replyAddress !== teamReplyAddress() },
        audit: { tenantId: String(feedback.get("tenantId")), entityType: "feedback", entityId: input.feedbackId, after: { replied: true, recipient } },
      };
    },
  }),

  addFeedbackNote: consoleHandler({
    capability: "inbox.write",
    input: z.object({ feedbackId, body: z.string().trim().min(1).max(4000) }),
    async run({ db, identity, now }, input) {
      const feedback = await loadFeedback(db, input.feedbackId);
      const message = db.collection("feedbackMessages").doc();
      await message.create({
        id: message.id,
        feedbackId: input.feedbackId,
        tenantId: feedback.get("tenantId") ?? null,
        direction: "internal",
        visibleToSender: false,
        senderUserId: feedback.get("userId") ?? null,
        body: input.body,
        authorUid: identity.uid,
        authorEmail: identity.email ?? null,
        authorLabel: typeof identity.name === "string" ? identity.name : (identity.email ?? "Team"),
        createdAt: now,
      });
      return { result: { messageId: message.id }, audit: { tenantId: String(feedback.get("tenantId")), entityType: "feedback", entityId: input.feedbackId, after: { note: true } } };
    },
  }),

  /** A new issue, optionally gathering feedback into it straight away. */
  createIssue: consoleHandler({
    capability: "inbox.write",
    input: z.object({
      title: z.string().trim().min(3).max(200),
      description: z.string().trim().max(6000).optional(),
      type: z.enum(["bug", "request", "ux"]),
      priority: z.enum(["urgent", "high", "normal", "low"]),
      feedbackIds: z.array(feedbackId).max(100).optional(),
    }),
    async run({ db, identity, now }, input) {
      const reference = db.collection("issues").doc();
      const number = await db.runTransaction(async (transaction) => {
        const counter = db.doc("consoleSettings/issueCounter");
        const current = await transaction.get(counter);
        const next = Number(current.get("next") ?? 1);
        transaction.set(counter, { next: next + 1 }, { merge: true });
        transaction.create(reference, {
          id: reference.id,
          number: next,
          title: input.title,
          description: input.description ?? "",
          type: input.type,
          priority: input.priority,
          status: "open",
          feedbackCount: 0,
          studioCount: 0,
          tenantIds: [],
          createdBy: identity.uid,
          createdByEmail: identity.email ?? null,
          createdAt: now,
          updatedAt: now,
          shippedAt: null,
          duplicateOf: null,
        });
        return next;
      });
      if (input.feedbackIds?.length) {
        const batch = db.batch();
        for (const id of input.feedbackIds) batch.update(db.doc(`feedback/${id}`), { issueId: reference.id, issueNumber: number, triage: "linked", updatedAt: now });
        await batch.commit();
        await recountIssue(db, reference.id, now);
      }
      return {
        result: { issueId: reference.id, number },
        audit: { tenantId: null, entityType: "issue", entityId: reference.id, after: { number, title: input.title, linked: input.feedbackIds?.length ?? 0 } },
      };
    },
  }),

  updateIssue: consoleHandler({
    capability: "inbox.write",
    input: z.object({
      issueId,
      title: z.string().trim().min(3).max(200).optional(),
      description: z.string().trim().max(6000).optional(),
      type: z.enum(["bug", "request", "ux"]).optional(),
      priority: z.enum(["urgent", "high", "normal", "low"]).optional(),
      target: z.string().trim().max(60).nullable().optional(),
    }),
    async run({ db, now }, input) {
      const reference = db.doc(`issues/${input.issueId}`);
      if (!(await reference.get()).exists) fail("ISSUE_NOT_FOUND");
      const change = { title: input.title, description: input.description, type: input.type, priority: input.priority, target: input.target };
      for (const key of Object.keys(change) as Array<keyof typeof change>) if (change[key] === undefined) delete change[key];
      await reference.update({ ...change, updatedAt: now });
      return { result: { issueId: input.issueId }, audit: { tenantId: null, entityType: "issue", entityId: input.issueId, after: change } };
    },
  }),

  linkFeedback: consoleHandler({
    capability: "inbox.write",
    input: z.object({ feedbackIds: z.array(feedbackId).min(1).max(100), issueId: issueId.nullable() }),
    async run({ db, now }, input) {
      let number: number | null = null;
      if (input.issueId) {
        const issue = await db.doc(`issues/${input.issueId}`).get();
        if (!issue.exists) fail("ISSUE_NOT_FOUND");
        number = Number(issue.get("number")) || null;
      }
      const previous = new Set<string>();
      const batch = db.batch();
      for (const id of input.feedbackIds) {
        const feedback = await loadFeedback(db, id);
        const before = feedback.get("issueId");
        if (typeof before === "string" && before) previous.add(before);
        batch.update(feedback.ref, input.issueId ? { issueId: input.issueId, issueNumber: number, triage: "linked", updatedAt: now } : { issueId: null, issueNumber: null, triage: "new", updatedAt: now });
      }
      await batch.commit();
      for (const id of new Set([...previous, ...(input.issueId ? [input.issueId] : [])])) await recountIssue(db, id, now);
      return { result: { linked: input.feedbackIds.length, issueId: input.issueId }, audit: { tenantId: null, entityType: "issue", entityId: input.issueId ?? "unlinked", after: { feedbackIds: input.feedbackIds } } };
    },
  }),

  /**
   * Move an issue along. Planned and Shipped are passed to every linked piece
   * of feedback, which emails each person who asked (once per status, and only
   * if they said they were happy to hear back). Won't do and Duplicate close
   * the feedback quietly.
   */
  setIssueStatus: consoleHandler({
    capability: "inbox.write",
    input: z.object({ issueId, status: z.enum(ISSUE_STATUSES), note: z.string().trim().max(1000).nullable().optional() }),
    async run({ db, identity, now, request }, input) {
      const reference = db.doc(`issues/${input.issueId}`);
      const issue = await reference.get();
      if (!issue.exists) fail("ISSUE_NOT_FOUND");
      await reference.update({ status: input.status, statusNote: input.note ?? null, updatedAt: now, ...(input.status === "shipped" ? { shippedAt: now } : {}) });
      const studioStatus = input.status === "planned" || input.status === "in_progress" ? "planned" : input.status === "shipped" ? "shipped" : input.status === "wont_do" || input.status === "duplicate" ? "closed" : null;
      let notified = 0;
      let moved = 0;
      if (studioStatus) {
        const linked = await db.collection("feedback").where("issueId", "==", input.issueId).get();
        for (const feedback of linked.docs) {
          if (feedback.get("status") === studioStatus) continue;
          const outcome = await applyFeedbackStatus(db, {
            feedbackId: feedback.id,
            status: studioStatus,
            note: input.note ?? null,
            actorUid: identity.uid,
            correlationId: `issue_${input.issueId}_${input.status}`,
            userAgent: request.get("user-agent") ?? null,
            issueId: input.issueId,
          });
          moved += 1;
          if (outcome.notified) notified += 1;
        }
      }
      return {
        result: { issueId: input.issueId, status: input.status, feedbackMoved: moved, studiosNotified: notified },
        audit: { tenantId: null, entityType: "issue", entityId: input.issueId, before: { status: issue.get("status") }, after: { status: input.status, feedbackMoved: moved, studiosNotified: notified } },
      };
    },
  }),

  /** Fold one issue into another: its feedback moves, it becomes a duplicate. */
  mergeIssues: consoleHandler({
    capability: "inbox.write",
    input: z.object({ sourceIssueId: issueId, targetIssueId: issueId }),
    async run({ db, now }, input) {
      if (input.sourceIssueId === input.targetIssueId) fail("MERGE_SAME_ISSUE");
      const [source, target] = await Promise.all([db.doc(`issues/${input.sourceIssueId}`).get(), db.doc(`issues/${input.targetIssueId}`).get()]);
      if (!source.exists || !target.exists) fail("ISSUE_NOT_FOUND");
      const linked = await db.collection("feedback").where("issueId", "==", input.sourceIssueId).get();
      const batch = db.batch();
      for (const feedback of linked.docs) batch.update(feedback.ref, { issueId: input.targetIssueId, issueNumber: target.get("number") ?? null, updatedAt: now });
      batch.update(source.ref, { status: "duplicate", duplicateOf: input.targetIssueId, updatedAt: now });
      await batch.commit();
      await recountIssue(db, input.sourceIssueId, now);
      await recountIssue(db, input.targetIssueId, now);
      return {
        result: { merged: linked.size, targetIssueId: input.targetIssueId },
        audit: { tenantId: null, entityType: "issue", entityId: input.sourceIssueId, after: { mergedInto: input.targetIssueId, feedbackMoved: linked.size } },
      };
    },
  }),

  /** Saved replies for the inbox and studio emails, managed in Settings. */
  saveReply: consoleHandler({
    capability: "inbox.write",
    input: z.object({
      replyId: z.string().min(1).max(200).optional(),
      kind: z.enum(["feedback", "studio"]),
      title: z.string().trim().min(2).max(80),
      subject: z.string().trim().max(160).optional(),
      body: z.string().trim().min(2).max(6000),
      archived: z.boolean().optional(),
    }),
    async run({ db, identity, now }, input) {
      const reference = input.replyId ? db.doc(`consoleReplies/${input.replyId}`) : db.collection("consoleReplies").doc();
      await reference.set(
        {
          id: reference.id,
          kind: input.kind,
          title: input.title,
          subject: input.subject ?? null,
          body: input.body,
          archivedAt: input.archived ? now : null,
          updatedAt: now,
          updatedBy: identity.uid,
          ...(input.replyId ? {} : { createdAt: now, createdBy: identity.uid }),
        },
        { merge: true },
      );
      return { result: { replyId: reference.id }, audit: { tenantId: null, entityType: "console_reply", entityId: reference.id, after: { title: input.title, archived: input.archived === true } } };
    },
  }),
};
