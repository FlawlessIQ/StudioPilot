import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { consoleHandler, fail, type ConsoleAudit } from "../command-kit.js";
import { SOURCE_CHANNELS } from "../../saas/attribution-schema.js";
import { platformEmailJob, safeActionUrl, shortToken, studioOwner, teamReplyAddress } from "../studio-owner.js";

/**
 * The CRM half of the Console: notes, tags, tasks, and writing to a studio.
 * Everything here is the team's own record. Notes and tasks are never readable
 * by a studio (firestore.rules), and every email is signed by the team.
 */

/** "studio:<tenantId>", "person:<uid>", "issue:<id>", or "lead:<id>". */
const subjectKey = z.string().regex(/^(studio|person|issue|lead):[A-Za-z0-9_\-.:@]+$/).max(260);
const tenantId = z.string().min(1).max(200);

function tenantOf(key: string | null | undefined): string | null {
  return key?.startsWith("studio:") ? key.slice("studio:".length) : null;
}

/** Lowercase words and dashes, 24 characters. One spelling per tag. */
export function normaliseTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
}

export const crmHandlers = {
  /**
   * File a studio under a channel by hand (Console → studio → Source): one
   * that signed up before tracking, or one whose owner said on a call how
   * they found us. A null channel goes back to what was recorded at signup.
   */
  setStudioSource: consoleHandler({
    capability: "crm.write",
    input: z.object({ tenantId, channel: z.enum(SOURCE_CHANNELS).nullable(), detail: z.string().trim().max(120).nullable().optional() }),
    async run({ db, identity, now }, input) {
      const reference = db.doc(`saasAttribution/${input.tenantId}`);
      const existing = await reference.get();
      const manual = input.channel ? { channel: input.channel, detail: input.detail || null, by: identity.uid, at: now } : null;
      await reference.set({ id: input.tenantId, tenantId: input.tenantId, manual, ...(existing.exists ? {} : { createdAt: now }) }, { merge: true });
      return {
        result: { tenantId: input.tenantId },
        audit: { tenantId: input.tenantId, entityType: "studio_source", entityId: input.tenantId, before: { manual: existing.get("manual") ?? null }, after: { manual } },
      };
    },
  }),
  addNote: consoleHandler({
    capability: "crm.write",
    input: z.object({ subjectKey, body: z.string().trim().min(1).max(4000), pinned: z.boolean().optional() }),
    async run({ db, identity, now }, input) {
      const reference = db.collection("consoleNotes").doc();
      const record = {
        id: reference.id,
        subjectKey: input.subjectKey,
        tenantId: tenantOf(input.subjectKey),
        body: input.body,
        pinned: input.pinned === true,
        authorUid: identity.uid,
        authorEmail: identity.email ?? null,
        authorName: typeof identity.name === "string" ? identity.name : null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
      await reference.create(record);
      return {
        result: { noteId: reference.id },
        // The note's text stays in the note. The audit says one was written.
        audit: { tenantId: record.tenantId, entityType: "console_note", entityId: reference.id, after: { subjectKey: input.subjectKey, pinned: record.pinned } },
      };
    },
  }),

  setNotePinned: consoleHandler({
    capability: "crm.write",
    input: z.object({ noteId: z.string().min(1).max(200), pinned: z.boolean() }),
    async run({ db, now }, input) {
      const reference = db.doc(`consoleNotes/${input.noteId}`);
      const note = await reference.get();
      if (!note.exists || note.get("archivedAt")) fail("NOTE_NOT_FOUND");
      await reference.update({ pinned: input.pinned, updatedAt: now });
      return { result: { noteId: input.noteId, pinned: input.pinned }, audit: { tenantId: note.get("tenantId") ?? null, entityType: "console_note", entityId: input.noteId, after: { pinned: input.pinned } } };
    },
  }),

  /** Notes are archived, never deleted: the audit trail points at them. */
  archiveNote: consoleHandler({
    capability: "crm.write",
    input: z.object({ noteId: z.string().min(1).max(200) }),
    async run({ db, identity, role, now }, input) {
      const reference = db.doc(`consoleNotes/${input.noteId}`);
      const note = await reference.get();
      if (!note.exists || note.get("archivedAt")) fail("NOTE_NOT_FOUND");
      if (note.get("authorUid") !== identity.uid && role !== "owner") fail("NOTE_NOT_YOURS");
      await reference.update({ archivedAt: now, archivedBy: identity.uid, pinned: false, updatedAt: now });
      return { result: { noteId: input.noteId, archived: true }, audit: { tenantId: note.get("tenantId") ?? null, entityType: "console_note", entityId: input.noteId, after: { archived: true } } };
    },
  }),

  /** Replace one studio's tags, or add tags to several. */
  setStudioTags: consoleHandler({
    capability: "crm.write",
    input: z.object({
      tenantIds: z.array(tenantId).min(1).max(100),
      tags: z.array(z.string().max(40)).max(12),
      mode: z.enum(["replace", "add", "remove"]),
    }),
    async run({ db, now }, input) {
      const tags = [...new Set(input.tags.map(normaliseTag).filter(Boolean))];
      if (input.mode === "replace" && input.tenantIds.length !== 1) fail("REPLACE_TAGS_ONE_STUDIO");
      const batch = db.batch();
      for (const id of input.tenantIds) {
        const reference = db.doc(`consoleStudios/${id}`);
        if (input.mode === "replace") batch.set(reference, { tags, tagsUpdatedAt: now }, { merge: true });
        else if (input.mode === "add") batch.set(reference, { tags: FieldValue.arrayUnion(...tags), tagsUpdatedAt: now }, { merge: true });
        else batch.set(reference, { tags: FieldValue.arrayRemove(...tags), tagsUpdatedAt: now }, { merge: true });
      }
      // The list the tag picker offers.
      if (tags.length && input.mode !== "remove")
        batch.set(db.doc("consoleSettings/tags"), { tags: FieldValue.arrayUnion(...tags), updatedAt: now }, { merge: true });
      await batch.commit();
      return {
        result: { studios: input.tenantIds.length, tags },
        audit: input.tenantIds.map((id): ConsoleAudit => ({ tenantId: id, entityType: "console_tags", entityId: id, after: { mode: input.mode, tags } })),
      };
    },
  }),

  /** One task, or one per studio when several are selected. */
  createTask: consoleHandler({
    capability: "crm.write",
    input: z.object({
      title: z.string().trim().min(2).max(300),
      dueAt: z.string().datetime().nullable().optional(),
      subjectKeys: z.array(subjectKey).max(100).optional(),
      assigneeUid: z.string().min(1).max(200).nullable().optional(),
    }),
    async run({ db, auth, identity, now }, input) {
      const subjects = input.subjectKeys?.length ? input.subjectKeys : [null];
      let assigneeEmail = identity.email ?? null;
      const assigneeUid = input.assigneeUid ?? identity.uid;
      if (assigneeUid !== identity.uid) {
        const admin = await db.doc(`platformAdmins/${assigneeUid}`).get();
        if (!admin.exists || admin.get("active") === false) fail("ASSIGNEE_NOT_ADMIN");
        assigneeEmail = (await auth.getUser(assigneeUid).catch(() => null))?.email ?? admin.get("email") ?? null;
      }
      const batch = db.batch();
      const ids: string[] = [];
      for (const subject of subjects) {
        const reference = db.collection("consoleTasks").doc();
        ids.push(reference.id);
        batch.create(reference, {
          id: reference.id,
          title: input.title,
          subjectKey: subject,
          tenantId: tenantOf(subject),
          dueAt: input.dueAt ?? null,
          assigneeUid,
          assigneeEmail,
          status: "open",
          createdBy: identity.uid,
          createdByEmail: identity.email ?? null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        });
      }
      await batch.commit();
      return {
        result: { taskIds: ids },
        audit: subjects.map((subject, index): ConsoleAudit => ({
          tenantId: tenantOf(subject),
          entityType: "console_task",
          entityId: ids[index]!,
          after: { title: input.title, dueAt: input.dueAt ?? null },
        })),
      };
    },
  }),

  updateTask: consoleHandler({
    capability: "crm.write",
    input: z.object({
      taskId: z.string().min(1).max(200),
      status: z.enum(["open", "done"]).optional(),
      title: z.string().trim().min(2).max(300).optional(),
      dueAt: z.string().datetime().nullable().optional(),
    }),
    async run({ db, identity, now }, input) {
      const reference = db.doc(`consoleTasks/${input.taskId}`);
      const task = await reference.get();
      if (!task.exists) fail("TASK_NOT_FOUND");
      const change: Record<string, unknown> = { updatedAt: now };
      if (input.title) change.title = input.title;
      if (input.dueAt !== undefined) change.dueAt = input.dueAt;
      if (input.status) {
        change.status = input.status;
        change.completedAt = input.status === "done" ? now : null;
        change.completedBy = input.status === "done" ? identity.uid : null;
      }
      await reference.update(change);
      return {
        result: { taskId: input.taskId, ...change },
        audit: { tenantId: task.get("tenantId") ?? null, entityType: "console_task", entityId: input.taskId, before: { status: task.get("status") }, after: change },
      };
    },
  }),

  /**
   * Email a studio's owner, from the team. One studio or several; each gets
   * its own message, and its own line on its timeline. Action links can only
   * point into StudioCue.
   */
  emailStudio: consoleHandler({
    capability: "crm.write",
    input: z.object({
      tenantIds: z.array(tenantId).min(1).max(50),
      subject: z.string().trim().min(3).max(160),
      body: z.string().trim().min(10).max(6000),
      actionLabel: z.string().trim().max(40).nullable().optional(),
      actionPath: z.string().trim().max(500).nullable().optional(),
    }),
    async run({ db, auth, identity, now }, input) {
      const actionUrl = safeActionUrl(input.actionPath);
      if (input.actionPath && !actionUrl) fail("ACTION_LINK_NOT_ALLOWED");
      const sent: string[] = [];
      const skipped: { tenantId: string; reason: string }[] = [];
      const audits: ConsoleAudit[] = [];
      const batch = db.batch();
      for (const id of input.tenantIds) {
        const owner = await studioOwner(db, auth, id);
        if (!owner) {
          skipped.push({ tenantId: id, reason: "TENANT_NOT_FOUND" });
          continue;
        }
        if (!owner.email) {
          skipped.push({ tenantId: id, reason: "OWNER_EMAIL_MISSING" });
          continue;
        }
        const jobId = `console_message_${id}_${shortToken()}`;
        batch.create(
          db.doc(`emailJobs/${jobId}`),
          platformEmailJob(
            jobId,
            {
              type: "platform_message",
              recipient: owner.email,
              recipientName: owner.name,
              replyAddress: teamReplyAddress(),
              customSubject: input.subject,
              customBody: input.body,
              actionLabel: input.actionLabel ?? null,
              actionUrl,
              // Which studio this was about, for its Console timeline.
              aboutTenantId: id,
              sentByUid: identity.uid,
            },
            now,
          ),
        );
        sent.push(id);
        audits.push({ tenantId: id, entityType: "console_email", entityId: jobId, after: { subject: input.subject, recipient: owner.email } });
      }
      if (!sent.length) fail(skipped[0]?.reason ?? "NO_RECIPIENTS");
      await batch.commit();
      return { result: { sent: sent.length, skipped }, audit: audits };
    },
  }),
};
