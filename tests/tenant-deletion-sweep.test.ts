import assert from "node:assert/strict";
import test from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { deleteTenant, type DeletionDeps } from "../functions/src/saas/tenant-deletion.js";

/**
 * A closed studio deleted against a real Firestore (saas/tenant-deletion.ts).
 * Runs under the emulator (`npm run test:tenant-deletion`) and skips without
 * one, like tests/project-purge-sweep.test.ts: the failures that matter — a
 * neighbour's records touched, a cursor that loops, a run that can't resume —
 * don't show in the source.
 */
const options = { skip: !process.env.FIRESTORE_EMULATOR_HOST };
const OURS = "tenant-closing";
const THEIRS = "tenant-staying";

function connect(name: string) {
  const app = initializeApp({ projectId: `studiohub-deletion-${Date.now()}-${name}` }, name);
  return { app, db: getFirestore(app) };
}

async function seed(db: FirebaseFirestore.Firestore, rows = 3) {
  const writes: Array<[string, Record<string, unknown>]> = [
    [`tenants/${OURS}`, { tenantId: OURS, businessName: "Closing Studio" }],
    [`tenants/${THEIRS}`, { tenantId: THEIRS, businessName: "Staying Studio" }],
    [`memberships/${OURS}_owner`, { tenantId: OURS, userId: "owner" }],
    [`memberships/${OURS}_shared`, { tenantId: OURS, userId: "shared" }],
    [`memberships/${THEIRS}_shared`, { tenantId: THEIRS, userId: "shared" }],
    [`integrationConnections/${OURS}_gc`, { tenantId: OURS, provider: "google_calendar" }],
    [`auditEvents/a1`, { tenantId: OURS, action: "x", before: { email: "a@b.c" }, ipAddress: "1.2.3.4" }],
    [`auditEvents/a2`, { tenantId: THEIRS, action: "x", before: { email: "keep@b.c" }, ipAddress: "5.6.7.8" }],
    [`users/owner`, { email: "owner@example.com" }],
    [`users/shared`, { email: "shared@example.com" }],
    [`subscriptions/${OURS}`, { tenantId: OURS, status: "cancelled", stripeSubscriptionId: "sub_1" }],
    [`deletionRequests/r1`, { tenantId: OURS, status: "platform_approved", deleteAfter: "2026-10-01T00:00:00.000Z" }],
  ];
  for (let index = 0; index < rows; index += 1) {
    writes.push([`projects/p${index}`, { tenantId: OURS, name: `Job ${index}` }]);
    writes.push([`contacts/c${index}`, { tenantId: OURS, email: `c${index}@example.com` }]);
    writes.push([`projects/q${index}`, { tenantId: THEIRS, name: `Their job ${index}` }]);
  }
  for (const [path, data] of writes) await db.doc(path).set(data);
}

function deps(db: FirebaseFirestore.Firestore, deadline = Date.now() + 60_000) {
  const calls = { prefixes: [] as string[], credentials: [] as string[], users: [] as string[] };
  const value: DeletionDeps = {
    db,
    now: () => new Date("2026-10-15T12:00:00Z"),
    deletePrefix: async (prefix) => void calls.prefixes.push(prefix),
    deleteCredential: async (tenantId, provider) => void calls.credentials.push(`${tenantId}:${provider}`),
    deleteAuthUser: async (uid) => void calls.users.push(uid),
    isPlatformAdmin: async () => false,
    deadline,
  };
  return { value, calls };
}

test("a closed studio goes, its neighbour stays, the trail stays without personal fields", options, async () => {
  const { app, db } = connect("main");
  try {
    await seed(db, 450);
    const { value, calls } = deps(db);
    const outcome = await deleteTenant(value, "r1");
    assert.equal(outcome.status, "completed");
    const ours = await Promise.all(["projects", "contacts", "memberships", "integrationConnections", "subscriptions"].map((name) => db.collection(name).where("tenantId", "==", OURS).get()));
    assert.deepEqual(ours.map((snapshot) => snapshot.size), [0, 0, 0, 0, 0]);
    assert.equal((await db.doc(`tenants/${OURS}`).get()).exists, false);
    // The neighbour: every record, and the shared person's membership.
    assert.equal((await db.collection("projects").where("tenantId", "==", THEIRS).get()).size, 450);
    assert.equal((await db.doc(`tenants/${THEIRS}`).get()).exists, true);
    assert.equal((await db.doc(`memberships/${THEIRS}_shared`).get()).exists, true);
    // Only the person in no other studio loses their sign-in.
    assert.deepEqual(calls.users, ["owner"]);
    assert.equal((await db.doc("users/owner").get()).exists, false);
    assert.equal((await db.doc("users/shared").get()).exists, true);
    assert.deepEqual(calls.credentials, [`${OURS}:google_calendar`]);
    assert.deepEqual(calls.prefixes, [`tenants/${OURS}/`, `feedback/${OURS}/`]);
    // The trail: ours kept and scrubbed, theirs untouched, plus the tombstone.
    const a1 = (await db.doc("auditEvents/a1").get()).data()!;
    assert.deepEqual([a1.before, a1.ipAddress, Boolean(a1.scrubbedAt)], [null, null, true]);
    assert.equal((await db.doc("auditEvents/a2").get()).data()!.ipAddress, "5.6.7.8");
    assert.equal((await db.doc("auditEvents/tenant_deleted_r1").get()).get("action"), "tenant.deleted");
    const request = (await db.doc("deletionRequests/r1").get()).data()!;
    assert.equal(request.status, "completed");
    assert.equal(request.manifest.projects, 450);
    // A second run is a no-op.
    assert.equal((await deleteTenant(value, "r1")).detail, "not_approved");
  } finally {
    await deleteApp(app);
  }
});

test("a run out of time stops part way and the next one finishes", options, async () => {
  const { app, db } = connect("resume");
  try {
    await seed(db, 900);
    const first = await deleteTenant(deps(db, Date.now() + 1).value, "r1");
    assert.equal(first.status, "deleting");
    assert.equal((await db.doc(`tenants/${OURS}`).get()).exists, true, "the handle outlives a stopped run");
    const second = await deleteTenant(deps(db).value, "r1");
    assert.equal(second.status, "completed");
    assert.equal((await db.collection("projects").where("tenantId", "==", OURS).get()).size, 0);
  } finally {
    await deleteApp(app);
  }
});

test("never before the 30 days, never while billing is live", options, async () => {
  const { app, db } = connect("guards");
  try {
    await seed(db, 1);
    await db.doc("deletionRequests/r1").update({ deleteAfter: "2026-11-01T00:00:00.000Z" });
    assert.equal((await deleteTenant(deps(db).value, "r1")).detail, "cooling_off");
    await db.doc("deletionRequests/r1").update({ deleteAfter: "2026-10-01T00:00:00.000Z" });
    await db.doc(`subscriptions/${OURS}`).update({ status: "active" });
    assert.equal((await deleteTenant(deps(db).value, "r1")).detail, "subscription_active");
    assert.equal((await db.doc("deletionRequests/r1").get()).get("blockedReason"), "SUBSCRIPTION_ACTIVE");
    assert.equal((await db.collection("projects").where("tenantId", "==", OURS).get()).size, 1);
  } finally {
    await deleteApp(app);
  }
});
