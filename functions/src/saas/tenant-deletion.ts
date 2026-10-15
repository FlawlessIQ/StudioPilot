import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore, type Query, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { deleteCredential } from "../integrations/oauth.js";

/**
 * A closed studio, deleted (docs/runbooks/data-deletion.md, A6).
 *
 * The owner asks in the app (data-lifecycle.ts: `cooling_off`, 30 days to
 * export), a platform admin approves in the Console (`platform_approved`), and
 * until now a person ran a one-off script. This is that script, run hourly on
 * every approved request whose 30 days are up.
 *
 * The per-job purge's three rules hold here too
 * ([[hard-delete-is-one-exception]], projects/purge-command.ts):
 *   1. Discovery, not a list: every top-level collection, `tenantId == id`.
 *   2. Tenant-checked: the query is on the tenant itself.
 *   3. The handle goes last: `tenants/{id}` is deleted after everything else,
 *      and the request record is kept as the proof. A run that stops part way
 *      leaves the request at `deleting`, and the next run carries on.
 *
 * Kept on purpose:
 *   - `auditEvents`, with their personal fields stripped: they prove the
 *     deletion happened (runbook A6.6).
 *   - `deletionRequests`: this operation's own record.
 *   - `webhookEvents`: provider idempotency, hashes not payloads.
 *   - StudioCue's billing records live at Stripe and are untouched.
 *
 * Refused while the studio's subscription is still live: billing is stopped
 * by a person first (runbook A3), never by a delete.
 */

const KEPT = new Set(["auditEvents", "deletionRequests", "webhookEvents"]);
/** Deleted by name, last. */
const HANDLES = new Set(["tenants"]);
const PAGE = 400;
const LIVE_SUBSCRIPTION = ["trialing", "active", "past_due", "unpaid", "paused"];

export type DeletionDeps = {
  db: Firestore;
  now: () => Date;
  /** Deletes every object under a Storage prefix. */
  deletePrefix: (prefix: string) => Promise<void>;
  /** Destroys a connection's stored tokens (integrations/oauth.ts). */
  deleteCredential: (tenantId: string, provider: string) => Promise<void>;
  deleteAuthUser: (uid: string) => Promise<void>;
  /** A platform admin's sign-in is never removed by a studio closing. */
  isPlatformAdmin: (uid: string) => Promise<boolean>;
  /** Stop starting new work after this: the request carries on next run. */
  deadline: number;
};

type Outcome = { requestId: string; status: string; detail?: string };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

async function pages(query: Query, each: (docs: QueryDocumentSnapshot[]) => Promise<void>, deadline: number) {
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    if (Date.now() > deadline) return false;
    const snapshot = await (cursor ? query.startAfter(cursor) : query).limit(PAGE).get();
    if (snapshot.empty) return true;
    await each(snapshot.docs);
    cursor = snapshot.docs.at(-1);
    if (snapshot.size < PAGE) return true;
  }
}

/** Every collection that may hold this tenant's records, found rather than listed. */
async function collections(db: Firestore) {
  return (await db.listCollections()).map((item) => item.id).sort();
}

export async function deleteTenant(deps: DeletionDeps, requestId: string): Promise<Outcome> {
  const { db } = deps;
  const reference = db.doc(`deletionRequests/${requestId}`);
  const request = await reference.get();
  const status = text(request.get("status"));
  if (!request.exists || !["platform_approved", "deleting"].includes(status)) return { requestId, status, detail: "not_approved" };
  const tenantId = text(request.get("tenantId"));
  if (!tenantId) return { requestId, status, detail: "no_tenant" };
  const stamp = () => deps.now().toISOString();

  // The 30 days to export are the owner's, whatever was approved.
  const deleteAfter = new Date(text(request.get("deleteAfter"))).valueOf();
  if (!Number.isFinite(deleteAfter) || deleteAfter > deps.now().valueOf()) return { requestId, status, detail: "cooling_off" };

  // 1 · Before anything goes: what is there, who signs in, what is connected.
  if (status === "platform_approved") {
    const subscription = await db.doc(`subscriptions/${tenantId}`).get();
    if (subscription.exists && text(subscription.get("stripeSubscriptionId")) && LIVE_SUBSCRIPTION.includes(text(subscription.get("status")))) {
      await reference.update({ blockedReason: "SUBSCRIPTION_ACTIVE", updatedAt: stamp() });
      return { requestId, status, detail: "subscription_active" };
    }
    const manifest: Record<string, number> = {};
    for (const collection of await collections(db)) {
      if (KEPT.has(collection)) continue;
      const count = (await db.collection(collection).where("tenantId", "==", tenantId).count().get()).data().count;
      if (count) manifest[collection] = count;
    }
    const members = await db.collection("memberships").where("tenantId", "==", tenantId).get();
    const connections = await db.collection("integrationConnections").where("tenantId", "==", tenantId).get();
    await reference.update({
      status: "deleting",
      deletionStartedAt: stamp(),
      blockedReason: null,
      manifest,
      memberUserIds: [...new Set(members.docs.map((doc) => text(doc.get("userId"))).filter(Boolean))],
      connectedProviders: [...new Set(connections.docs.map((doc) => text(doc.get("provider"))).filter(Boolean))],
      stepsDone: [],
      updatedAt: stamp(),
    });
  }
  const current = (await reference.get()).data() ?? {};
  const done = new Set<string>(Array.isArray(current.stepsDone) ? current.stepsDone : []);
  const mark = async (step: string, extra: Record<string, unknown> = {}) => {
    done.add(step);
    await reference.update({ stepsDone: [...done], updatedAt: stamp(), ...extra });
  };
  const manual: string[] = Array.isArray(current.manualSteps) ? current.manualSteps : [];

  // 2 · The connections' tokens, while the connection records still say which.
  if (!done.has("credentials")) {
    for (const provider of (current.connectedProviders as string[] | undefined) ?? []) {
      try {
        await deps.deleteCredential(tenantId, provider);
      } catch (caught: unknown) {
        manual.push(`Destroy the ${provider} credential by hand (${caught instanceof Error ? caught.message : "failed"}).`);
      }
    }
    await mark("credentials", { manualSteps: manual });
  }

  // 3 · Every record, collection by collection, except what is kept and the handle.
  if (!done.has("records")) {
    for (const collection of await collections(db)) {
      if (KEPT.has(collection) || HANDLES.has(collection)) continue;
      const finished = await pages(
        db.collection(collection).where("tenantId", "==", tenantId).orderBy("__name__"),
        async (docs) => {
          const batch = db.batch();
          for (const doc of docs) batch.delete(doc.ref);
          await batch.commit();
        },
        deps.deadline,
      );
      if (!finished) return { requestId, status: "deleting", detail: `paused_in_${collection}` };
    }
    await mark("records");
  }

  // 4 · Files: the studio's own, and its feedback screenshots.
  if (!done.has("files")) {
    await deps.deletePrefix(`tenants/${tenantId}/`);
    await deps.deletePrefix(`feedback/${tenantId}/`);
    await mark("files");
  }

  // 5 · Sign-ins that belonged only to this studio. Anyone in another studio stays.
  if (!done.has("people")) {
    for (const uid of (current.memberUserIds as string[] | undefined) ?? []) {
      const elsewhere = await db.collection("memberships").where("userId", "==", uid).limit(1).get();
      if (!elsewhere.empty) continue;
      if (await deps.isPlatformAdmin(uid)) continue;
      const user = await db.doc(`users/${uid}`).get();
      try {
        await deps.deleteAuthUser(uid);
      } catch (caught: unknown) {
        if (!(caught instanceof Error && /user-not-found/.test(caught.message))) throw caught;
      }
      if (user.exists) await user.ref.delete();
    }
    await mark("people");
  }

  // 6 · The trail stays, without the personal fields in it.
  if (!done.has("audit")) {
    const finished = await pages(
      db.collection("auditEvents").where("tenantId", "==", tenantId).orderBy("__name__"),
      async (docs) => {
        const batch = db.batch();
        for (const doc of docs) {
          if (doc.get("scrubbedAt")) continue;
          batch.update(doc.ref, { before: null, after: null, ipAddress: null, userAgent: null, reason: null, scrubbedAt: stamp() });
        }
        await batch.commit();
      },
      deps.deadline,
    );
    if (!finished) return { requestId, status: "deleting", detail: "paused_in_audit" };
    await mark("audit");
  }

  // 7 · The handle, last.
  await db.doc(`tenants/${tenantId}`).delete();
  await db.collection("auditEvents").doc(`tenant_deleted_${requestId}`).set({
    tenantId,
    projectId: null,
    actorId: "tenant-deletion",
    actorType: "system",
    action: "tenant.deleted",
    entityType: "tenant",
    entityId: tenantId,
    timestamp: stamp(),
    before: null,
    after: { requestId, collections: Object.keys((current.manifest as Record<string, number> | undefined) ?? {}).length },
    ipAddress: null,
    userAgent: null,
    correlationId: `tenant-deletion:${requestId}`,
    automationRunId: null,
    providerEventId: null,
  });
  await reference.update({
    status: "completed",
    completedAt: stamp(),
    stepsDone: [...done, "tenant"],
    // The owner is emailed by a person (runbook A7): the studio's own mail is gone with it.
    manualSteps: [...manual, "Email the owner that the deletion is complete."],
    updatedAt: stamp(),
  });
  return { requestId, status: "completed" };
}

export const tenantDeletionWorker = onSchedule(
  { schedule: "every 60 minutes", timeZone: "UTC", retryCount: 0, timeoutSeconds: 540, memory: "1GiB" },
  async () => {
    const db = getFirestore();
    const started = Date.now();
    const deps: DeletionDeps = {
      db,
      now: () => new Date(),
      deletePrefix: async (prefix) => {
        await getStorage().bucket().deleteFiles({ prefix, force: true });
      },
      deleteCredential: (tenantId, provider) => deleteCredential(tenantId, provider as never),
      deleteAuthUser: async (uid) => {
        await getAuth().deleteUser(uid);
      },
      isPlatformAdmin: async (uid) => {
        try {
          return (await getAuth().getUser(uid)).customClaims?.platformAdmin === true;
        } catch {
          return false;
        }
      },
      // Leave a minute for the last batch and the request's own write.
      deadline: started + 450_000,
    };
    const requests = await db.collection("deletionRequests").where("status", "in", ["platform_approved", "deleting"]).get();
    for (const request of requests.docs) {
      if (Date.now() > deps.deadline) break;
      try {
        const outcome = await deleteTenant(deps, request.id);
        console.log(JSON.stringify({ event: "tenant_deletion", ...outcome }));
      } catch (caught: unknown) {
        const message = caught instanceof Error ? caught.message : "FAILED";
        console.error(JSON.stringify({ event: "tenant_deletion_failed", requestId: request.id, message }));
        await request.ref.update({ lastError: message.slice(0, 500), updatedAt: new Date().toISOString() });
      }
    }
  },
);
