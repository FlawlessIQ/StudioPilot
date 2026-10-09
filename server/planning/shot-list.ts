import type { Firestore } from "firebase-admin/firestore";
import {
  SHOT_LIST_MAX_FILES,
  SHOT_LIST_NOTE_MAX,
  isOwnShotListPath,
  shotListStatus,
  type ShotListFile,
  type ShotListRecord,
  type ShotListView,
} from "@/features/planning/shot-list";
import { jobKindOf } from "@/features/job-kinds/job-kinds";
import { tradeProfile } from "@/features/trades/trades";

export type { ShotListView };

/**
 * The couple's side of their shot list (features/planning/shot-list.ts):
 * what they've sent, and saving what they send now. Through the portal route,
 * which has already checked they are a client on this job.
 *
 * Sending is allowed before the studio asks — a couple who has their list
 * early shouldn't have to wait for an email — and again after, adding files
 * or changing the note; each send puts it back on the studio's Today.
 */


type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export async function shotListFor(db: Firestore, input: { tenantId: string; projectId: string }): Promise<ShotListView> {
  const [project, tenant, stored] = await Promise.all([
    db.doc(`projects/${input.projectId}`).get(),
    db.doc(`tenants/${input.tenantId}`).get(),
    db.doc(`clientShotLists/${input.projectId}`).get(),
  ]);
  if (!project.exists || project.get("tenantId") !== input.tenantId) throw new Error("PROJECT_NOT_FOUND");
  const record = stored.exists && stored.get("tenantId") === input.tenantId ? (stored.data() as ShotListRecord) : null;
  const files = Array.isArray(record?.files) ? record.files : [];
  return {
    status: shotListStatus(record),
    available: Boolean(record) || (jobKindOf(project.data() as Row) === "wedding" && tradeProfile(tenant.get("trade")).shotList),
    dueDate: text(record?.dueDate) || null,
    // Never the storage path: the couple's own copy isn't something to hand
    // back out, and the studio downloads through its own rules.
    files: files.map((file) => ({ name: file.name, contentType: file.contentType, sizeBytes: file.sizeBytes, uploadedAt: file.uploadedAt })),
    note: text(record?.note) || null,
    receivedAt: text(record?.receivedAt) || null,
    seenByStudio: Boolean(record?.studioSeenAt && record?.receivedAt && record.studioSeenAt >= record.receivedAt),
  };
}

export async function submitShotList(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    uid: string;
    files: Array<Pick<ShotListFile, "storagePath" | "name" | "contentType" | "sizeBytes">>;
    note: string | null;
    now: string;
  },
): Promise<ShotListView> {
  for (const file of input.files)
    if (!isOwnShotListPath(file.storagePath, input)) throw new Error("SHOT_LIST_FILE_NOT_YOURS");
  const note = (input.note ?? "").trim().slice(0, SHOT_LIST_NOTE_MAX) || null;
  if (!input.files.length && !note) throw new Error("SHOT_LIST_EMPTY");
  const project = await db.doc(`projects/${input.projectId}`).get();
  if (!project.exists || project.get("tenantId") !== input.tenantId) throw new Error("PROJECT_NOT_FOUND");
  const reference = db.doc(`clientShotLists/${input.projectId}`);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const existing: ShotListFile[] = Array.isArray(current.get("files")) ? (current.get("files") as ShotListFile[]) : [];
    const known = new Set(existing.map((file) => file.storagePath));
    const added = input.files
      .filter((file) => !known.has(file.storagePath))
      .map((file) => ({ ...file, uploadedAt: input.now, uploadedBy: input.uid }));
    const files = [...existing, ...added];
    if (files.length > SHOT_LIST_MAX_FILES) throw new Error("SHOT_LIST_TOO_MANY_FILES");
    const fields = {
      id: input.projectId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      status: "received",
      files,
      note: note ?? current.get("note") ?? null,
      receivedAt: input.now,
      receivedBy: input.uid,
      updatedAt: input.now,
    };
    if (current.exists) transaction.update(reference, fields);
    else
      transaction.create(reference, {
        ...fields,
        // Sent before the studio asked: nothing to remind them of later.
        requestedAt: null,
        requestedBy: null,
        dueDate: null,
        studioSeenAt: null,
        createdAt: input.now,
      });
    const auditId = `shot_list_${input.projectId}_${input.now.replace(/\D/g, "")}`;
    transaction.set(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      actorId: input.uid,
      actorType: "client",
      action: "planning.shot_list_received",
      entityType: "clientShotList",
      entityId: input.projectId,
      timestamp: input.now,
      before: current.exists ? { files: existing.length, note: Boolean(current.get("note")) } : null,
      after: { files: files.length, added: added.length, note: Boolean(fields.note) },
      ipAddress: null,
      userAgent: null,
      correlationId: auditId,
      automationRunId: null,
      providerEventId: null,
    });
  });
  return shotListFor(db, input);
}
