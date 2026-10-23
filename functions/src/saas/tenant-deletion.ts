import { getAuth } from "firebase-admin/auth";
import { getFirestore, type DocumentReference, type Firestore, type Query, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { deleteCredential } from "../integrations/oauth.js";
import {
  TENANT_DELETION_KEPT,
  keptDocument,
  tenantDeletionMaySweep,
  tenantDeletionRefusal,
  type TenantDeletionRefusal,
  type TenantDeletionState,
} from "./tenant-deletion-policy.js";

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
 *   3. The handle goes last: `tenants/{id}` (and `subscriptions/{id}`, which
 *      the refusal reads) are deleted after everything else, and the request
 *      record is kept as the proof. A run that stops part way leaves the
 *      request at `deleting`, and the next run carries on.
 *
 * Never a studio that is paying, comped or otherwise live
 * (tenant-deletion-policy.ts, audit 2026-10-22). `tenantDeletionRefusal` is
 * read fresh at the run's start and again immediately before every step; a
 * refusal stops the run, sets the request to `refused` with the reason, and
 * logs TENANT_DELETION_REFUSED. Billing is stopped by a person first (runbook
 * A3), never by a delete. The owner cancelling (data-lifecycle.ts) is honored
 * at the same checkpoints.
 *
 * The order: recoverable first, then the irreversible steps from cheapest to
 * put right to dearest, so a refusal or a failure part way leaves as much
 * standing as it can:
 *   1. records     — Firestore, except what is kept. Point-in-time recovery
 *                    (7 days) can bring every one of them back.
 *   2. audit       — the trail's personal fields, stripped (Firestore too).
 *   3. credentials — Secret Manager. Irreversible, but the cheapest loss: an
 *                    owner reconnects a calendar in a minute. The providers
 *                    were written on the request before step 1, so a destroy
 *                    that fails is never orphaned: it stays named there and
 *                    in "By hand".
 *   4. people      — Firebase Auth. Irreversible; someone removed by mistake
 *                    can sign up again, but their uid is gone with it.
 *   5. files       — Storage, last of all: a studio's galleries and signed
 *                    documents are the one thing nobody can put back.
 *   6. the handle  — `subscriptions/{id}`, `tenants/{id}`, the tombstone and
 *                    `completed`, in one batch.
 *
 * Kept on purpose: see TENANT_DELETION_KEPT — this operation's proof, records
 * that belong to another studio or a partner (`saasReferrals`, …), and the
 * platform's own records about the studio. StudioCue's billing records at
 * Stripe are untouched.
 */

const PAGE = 400;

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
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];

/** The studio's subscription as it is right now, for `tenantDeletionRefusal`. */
export async function readTenantDeletionState(db: Firestore, tenantId: string): Promise<TenantDeletionState> {
  try {
    const snapshot = await db.doc(`subscriptions/${tenantId}`).get();
    return { tenantId, subscription: snapshot.exists ? (snapshot.data() ?? {}) : null };
  } catch {
    return { tenantId, subscription: "unreadable" };
  }
}

/**
 * Stop a deletion for good: the request says `refused` and why, and the
 * operational log raises it. Used by the Console's approval and the worker.
 * A platform admin approves it again once billing has really ended.
 */
export async function refuseTenantDeletion(
  reference: DocumentReference,
  input: { requestId: string; tenantId: string; step: string; refusal: TenantDeletionRefusal; at: string },
): Promise<void> {
  logger.error("tenantDeletionRefused", {
    studiocueOperationalError: true,
    code: "TENANT_DELETION_REFUSED",
    tenantId: input.tenantId,
    requestId: input.requestId,
    step: input.step,
    refusalCode: input.refusal.code,
    reason: input.refusal.reason,
  });
  await reference.update({
    status: "refused",
    refusalCode: input.refusal.code,
    refusedReason: input.refusal.reason,
    refusedAtStep: input.step,
    refusedAt: input.at,
    updatedAt: input.at,
  });
}

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

  /**
   * Read immediately before every step: the request must still be going ahead
   * (the owner may have cancelled), and the studio must still be one that may
   * be deleted (a comp granted, a subscription revived since the last step).
   */
  const checkpoint = async (step: string): Promise<Outcome | null> => {
    const fresh = await reference.get();
    const now = text(fresh.get("status"));
    if (!["platform_approved", "deleting"].includes(now)) return { requestId, status: now, detail: `stopped_before_${step}` };
    const refusal = tenantDeletionRefusal(await readTenantDeletionState(db, tenantId));
    if (!refusal) return null;
    await refuseTenantDeletion(reference, { requestId, tenantId, step, refusal, at: stamp() });
    return { requestId, status: "refused", detail: refusal.code };
  };

  // 0 · Before anything: may this studio be deleted at all?
  const start = await checkpoint("start");
  if (start) return start;

  // What is there, who signs in, what is connected — written down before
  // anything goes. A request approved again after a refusal keeps what its
  // first run found: the memberships that run read may be gone by now.
  if (status === "platform_approved") {
    const manifest: Record<string, number> = {};
    for (const collection of await collections(db)) {
      if (TENANT_DELETION_KEPT.includes(collection)) continue;
      const count = (await db.collection(collection).where("tenantId", "==", tenantId).count().get()).data().count;
      if (count) manifest[collection] = count;
    }
    const members = await db.collection("memberships").where("tenantId", "==", tenantId).get();
    const connections = await db.collection("integrationConnections").where("tenantId", "==", tenantId).get();
    const resumed = Boolean(request.get("deletionStartedAt"));
    await reference.update({
      status: "deleting",
      deletionStartedAt: request.get("deletionStartedAt") ?? stamp(),
      blockedReason: null,
      // The first count stands: a resumed run finds less, having deleted some.
      manifest: resumed ? { ...manifest, ...((request.get("manifest") as Record<string, number> | undefined) ?? {}) } : manifest,
      memberUserIds: [...new Set([...list(request.get("memberUserIds")), ...members.docs.map((doc) => text(doc.get("userId")))].filter(Boolean))],
      connectedProviders: [
        ...new Set([...list(request.get("connectedProviders")), ...connections.docs.map((doc) => text(doc.get("provider")))].filter(Boolean)),
      ],
      stepsDone: resumed ? list(request.get("stepsDone")) : [],
      updatedAt: stamp(),
    });
  }
  const current = (await reference.get()).data() ?? {};
  const done = new Set<string>(list(current.stepsDone));
  const mark = async (step: string, extra: Record<string, unknown> = {}) => {
    done.add(step);
    await reference.update({ stepsDone: [...done], updatedAt: stamp(), ...extra });
  };
  const manual: string[] = list(current.manualSteps);

  // 1 · Every record, collection by collection, except what is kept and the
  // handle. Recoverable: point-in-time recovery holds the last 7 days.
  if (!done.has("records")) {
    for (const collection of await collections(db)) {
      if (!tenantDeletionMaySweep(collection)) continue;
      const stop = await checkpoint(`records:${collection}`);
      if (stop) return stop;
      const finished = await pages(
        db.collection(collection).where("tenantId", "==", tenantId).orderBy("__name__"),
        async (docs) => {
          const doomed = docs.filter((doc) => !keptDocument(collection, doc.data()));
          if (!doomed.length) return;
          const batch = db.batch();
          for (const doc of doomed) batch.delete(doc.ref);
          await batch.commit();
        },
        deps.deadline,
      );
      if (!finished) return { requestId, status: "deleting", detail: `paused_in_${collection}` };
    }
    await mark("records");
  }

  // 2 · The trail stays, without the personal fields in it.
  if (!done.has("audit")) {
    const stop = await checkpoint("audit");
    if (stop) return stop;
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

  // 3 · The connections' tokens. Irreversible. The providers were written on
  // the request before step 1, so the records being gone doesn't lose them.
  if (!done.has("credentials")) {
    const stop = await checkpoint("credentials");
    if (stop) return stop;
    for (const provider of list(current.connectedProviders)) {
      try {
        await deps.deleteCredential(tenantId, provider);
      } catch (caught: unknown) {
        manual.push(`Destroy the ${provider} credential by hand (${caught instanceof Error ? caught.message : "failed"}).`);
      }
    }
    await mark("credentials", { manualSteps: manual });
  }

  // 4 · Sign-ins that belonged only to this studio. Irreversible. Anyone in
  // another studio stays: this studio's memberships went in step 1, so any
  // membership left is somewhere else.
  if (!done.has("people")) {
    const stop = await checkpoint("people");
    if (stop) return stop;
    for (const uid of list(current.memberUserIds)) {
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

  // 5 · Files, the last irreversible step: the studio's own, and its feedback
  // screenshots.
  if (!done.has("files")) {
    const stop = await checkpoint("files");
    if (stop) return stop;
    await deps.deletePrefix(`tenants/${tenantId}/`);
    await deps.deletePrefix(`feedback/${tenantId}/`);
    await mark("files");
  }

  // 6 · The handle, last, with the subscription the checks read and the proof.
  const stop = await checkpoint("handle");
  if (stop) return stop;
  const batch = db.batch();
  batch.delete(db.doc(`subscriptions/${tenantId}`));
  batch.delete(db.doc(`tenants/${tenantId}`));
  batch.set(db.collection("auditEvents").doc(`tenant_deleted_${requestId}`), {
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
  batch.update(reference, {
    status: "completed",
    completedAt: stamp(),
    stepsDone: [...done, "tenant"],
    // The owner is emailed by a person (runbook A7): the studio's own mail is gone with it.
    manualSteps: [...manual, "Email the owner that the deletion is complete."],
    updatedAt: stamp(),
  });
  await batch.commit();
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
