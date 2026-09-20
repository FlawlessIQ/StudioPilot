import { createHash, randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
import { isLiveAssignment } from "../crew/job-stopped.js";
import {
  purgeConfirmationMatches,
  purgeLineLabel,
  purgeMaySweep,
  type PurgeLine,
} from "./purge-policy.js";

/**
 * Permanently erasing one job.
 *
 * The deliberate exception to a product that never deletes — see
 * purge-policy.ts for why it exists and what it must never take with it.
 *
 * ## Why this is its own Function
 *
 * `crmCommand` wraps every command in one Firestore transaction, and a purge
 * is the opposite shape: an unbounded number of reads and writes across every
 * collection, plus a Storage prefix. It also needs a long timeout, which is
 * not something to hand to the Function that runs every other studio action.
 *
 * ## How records are found
 *
 * By asking Firestore what collections exist, not from a list written here.
 * A list would be wrong the first time somebody adds a collection and forgets
 * this file — and being wrong here means a wedding the studio believes is gone
 * is still readable. `projectId` is indexed automatically on every field, so
 * each collection costs one query and no composite index.
 *
 * Every candidate is then checked against the tenant before it is deleted.
 * The sweep is driven by `projectId` alone, so a colliding id in another
 * tenant's data would otherwise be destroyed by somebody else's confirmation.
 */

const command = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("previewProjectPurge"),
    tenantId: z.string().min(1),
    input: z.object({ projectId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("purgeProject"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8),
    input: z.object({
      projectId: z.string().min(1),
      /** The job's own name, typed out. Checked server-side, never trusted. */
      confirmation: z.string().min(1).max(200),
    }),
  }),
]);

const PAGE = 300;
const BATCH = 300;

type Db = FirebaseFirestore.Firestore;

/**
 * Only the owner, and only on a job nobody is waiting on.
 *
 * The live-crew rule is the same one archiving follows, for a stronger
 * reason: an assignment somebody has accepted is a person holding a Saturday.
 * Cancelling the job withdraws the offers and tells them why; deleting it
 * would simply make the job vanish from under them.
 */
async function authorise(db: Db, tenantId: string, userId: string, projectId: string) {
  const membership = await db.doc(`memberships/${tenantId}_${userId}`).get();
  if (
    !membership.exists ||
    membership.get("status") !== "active" ||
    membership.get("role") !== "studio_owner"
  )
    throw new Error("PROJECT_PURGE_OWNER_ONLY");
  const project = await db.doc(`projects/${projectId}`).get();
  if (!project.exists || project.get("tenantId") !== tenantId)
    throw new Error("PROJECT_NOT_FOUND");
  const assignments = await db
    .collection("crewAssignments")
    .where("projectId", "==", projectId)
    .get();
  const live = assignments.docs.filter(
    (item) =>
      item.get("tenantId") === tenantId && isLiveAssignment(item.get("status")),
  );
  if (live.length) throw new Error("PROJECT_HAS_LIVE_CREW");
  return project;
}

/** One page of this job's documents in one collection, tenant-checked. */
async function pageOf(
  db: Db,
  collection: string,
  tenantId: string,
  projectId: string,
  after?: FirebaseFirestore.QueryDocumentSnapshot,
) {
  let query: FirebaseFirestore.Query = db
    .collection(collection)
    .where("projectId", "==", projectId)
    .orderBy("__name__")
    .limit(PAGE);
  if (after) query = query.startAfter(after);
  const snapshot = await query.get();
  return {
    docs: snapshot.docs.filter((item) => item.get("tenantId") === tenantId),
    last: snapshot.docs.at(-1),
    exhausted: snapshot.size < PAGE,
  };
}

export async function sweepableCollections(db: Db): Promise<string[]> {
  const collections = await db.listCollections();
  return collections.map((item) => item.id).filter(purgeMaySweep).sort();
}

/** What is there, without touching any of it. */
export async function manifest(
  db: Db,
  tenantId: string,
  projectId: string,
): Promise<PurgeLine[]> {
  const lines: PurgeLine[] = [];
  for (const collection of await sweepableCollections(db)) {
    let count = 0;
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    for (;;) {
      const page = await pageOf(db, collection, tenantId, projectId, cursor);
      count += page.docs.length;
      cursor = page.last;
      if (page.exhausted || !cursor) break;
    }
    if (count)
      lines.push({ collection, label: purgeLineLabel(collection, count), count });
  }
  // Counted by hand because the sweep deliberately leaves it until last.
  lines.push({
    collection: "projects",
    label: purgeLineLabel("projects", 1),
    count: 1,
  });
  return lines;
}

/**
 * Whether the couple leave with the job.
 *
 * "Delete everything about this wedding" plainly includes the couple — but a
 * client who books twice is one contact on two jobs, and deleting them because
 * one was purged would gut a wedding nobody asked about. So they go only when
 * this was their last job, and the preview says which of the two will happen
 * before anything is destroyed.
 */
type NamedContact = { id: string; name: string };

export async function contactsToDelete(
  db: Db,
  tenantId: string,
  projectId: string,
  contactIds: readonly string[],
): Promise<{ deleting: NamedContact[]; keeping: NamedContact[] }> {
  const deleting: NamedContact[] = [];
  const keeping: NamedContact[] = [];
  for (const contactId of contactIds) {
    const contact = await db.doc(`contacts/${contactId}`).get();
    if (!contact.exists || contact.get("tenantId") !== tenantId) continue;
    const named: NamedContact = {
      id: contactId,
      name: String(
        contact.get("displayName") ?? contact.get("email") ?? contactId,
      ),
    };
    const elsewhere = await db
      .collection("projects")
      .where("clientContactIds", "array-contains", contactId)
      .get();
    const others = elsewhere.docs.filter(
      (item) => item.id !== projectId && item.get("tenantId") === tenantId,
    );
    (others.length ? keeping : deleting).push(named);
  }
  return { deleting, keeping };
}

async function deleteAll(
  db: Db,
  docs: readonly FirebaseFirestore.QueryDocumentSnapshot[],
) {
  for (let index = 0; index < docs.length; index += BATCH) {
    const batch = db.batch();
    for (const item of docs.slice(index, index + BATCH)) batch.delete(item.ref);
    await batch.commit();
  }
}

/**
 * Delete every record of this job, collection by collection.
 *
 * Exported so tests/project-purge-sweep.test.ts can run it against a real
 * Firestore rather than only reading it: a sweep is the kind of code whose
 * bugs — a cursor that loops, a tenant check that does not hold — are
 * invisible in the source and total in production.
 *
 * Returns what it deleted, per collection.
 */
export async function sweepProjectRecords(
  db: Db,
  tenantId: string,
  projectId: string,
): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  for (const collection of await sweepableCollections(db)) {
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    for (;;) {
      const page = await pageOf(db, collection, tenantId, projectId, cursor);
      if (page.docs.length) {
        await deleteAll(db, page.docs);
        deleted[collection] = (deleted[collection] ?? 0) + page.docs.length;
      }
      /**
       * Forward only, never restarting the collection.
       *
       * A page holds every document with this `projectId`, including any
       * belonging to another tenant, and those are deliberately left behind —
       * so a restart would read them again for ever. Paging on `__name__` is
       * safe while deleting: the cursor keeps the last document's key even
       * once that document is gone.
       */
      if (page.exhausted || !page.last) break;
      cursor = page.last;
    }
  }
  return deleted;
}

export const projectPurgeCommand = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
    // A job with years of messages and a full gallery inbox is a lot of pages,
    // and a purge that times out half way leaves a wedding in pieces.
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      const parsed = command.parse(request.body);
      const db = getFirestore();
      const project = await authorise(
        db,
        parsed.tenantId,
        identity.uid,
        parsed.input.projectId,
      );
      const projectName = String(project.get("name") ?? "");
      const contactIds = (project.get("clientContactIds") as string[] | undefined) ?? [];

      if (parsed.type === "previewProjectPurge") {
        const [lines, contacts] = await Promise.all([
          manifest(db, parsed.tenantId, parsed.input.projectId),
          contactsToDelete(db, parsed.tenantId, parsed.input.projectId, contactIds),
        ]);
        const [files] = await getStorage()
          .bucket()
          .getFiles({
            prefix: `tenants/${parsed.tenantId}/projects/${parsed.input.projectId}/`,
          });
        response.status(200).json({
          projectId: parsed.input.projectId,
          projectName,
          lines,
          fileCount: files.length,
          clientsDeleted: contacts.deleting.map((contact) => contact.name),
          clientsKept: contacts.keeping.map((contact) => contact.name),
        });
        return;
      }

      if (!purgeConfirmationMatches(parsed.input.confirmation, projectName))
        throw new Error("PROJECT_PURGE_NAME_MISMATCH");

      const purgeId = createHash("sha256")
        .update(`${parsed.tenantId}:${parsed.idempotencyKey}`)
        .digest("hex")
        .slice(0, 40);
      const startedAt = new Date().toISOString();
      const record = db.doc(`projectPurges/${purgeId}`);
      if ((await record.get()).exists) {
        response.status(200).json({ purgeId, status: "already_done" });
        return;
      }
      /**
       * Written before anything is destroyed, so a purge that dies half way
       * still leaves a record saying what was being done and by whom. There is
       * nothing to roll back to, which makes the trail the only account of it.
       */
      await record.create({
        id: purgeId,
        tenantId: parsed.tenantId,
        projectId: parsed.input.projectId,
        projectName,
        requestedBy: identity.uid,
        status: "running",
        deleted: {},
        filesDeleted: 0,
        contactsDeleted: [],
        startedAt,
        completedAt: null,
      });

      const deleted = await sweepProjectRecords(
        db,
        parsed.tenantId,
        parsed.input.projectId,
      );

      const contacts = await contactsToDelete(
        db,
        parsed.tenantId,
        parsed.input.projectId,
        contactIds,
      );
      for (const contact of contacts.deleting)
        await db.doc(`contacts/${contact.id}`).delete();

      // Last, and only now that nothing it points at is left: see
      // PURGE_DEFERRED_COLLECTIONS in purge-policy.ts.
      await db.doc(`projects/${parsed.input.projectId}`).delete();
      deleted.projects = 1;

      const prefix = `tenants/${parsed.tenantId}/projects/${parsed.input.projectId}/`;
      const [files] = await getStorage().bucket().getFiles({ prefix });
      await getStorage().bucket().deleteFiles({ prefix, force: true });

      /**
       * The one thing that survives.
       *
       * The job's own audit entries are erased with it — they carry the
       * couple's name and every change made to their wedding, which is exactly
       * what was asked to be forgotten. This entry replaces them: who deleted
       * what, when, and how much of it. It names no one but the operator.
       */
      const auditId = randomUUID();
      const completedAt = new Date().toISOString();
      await db.doc(`auditEvents/${auditId}`).set({
        id: auditId,
        tenantId: parsed.tenantId,
        projectId: null,
        actorId: identity.uid,
        actorType: "user",
        action: "project.purged",
        entityType: "project",
        entityId: parsed.input.projectId,
        timestamp: completedAt,
        before: { purgeId, documents: deleted, files: files.length },
        after: null,
        ipAddress: null,
        userAgent: request.header("user-agent") ?? null,
      });
      await record.update({
        status: "complete",
        deleted,
        filesDeleted: files.length,
        contactsDeleted: contacts.deleting.map((contact) => contact.id),
        completedAt,
      });

      response.status(200).json({
        purgeId,
        status: "complete",
        deleted,
        filesDeleted: files.length,
        contactsDeleted: contacts.deleting.length,
      });
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "PROJECT_PURGE_FAILED";
      response
        .status(message === "PROJECT_PURGE_OWNER_ONLY" ? 403 : 400)
        .json({ error: message });
    }
  },
);
