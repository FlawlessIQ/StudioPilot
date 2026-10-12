import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import type { DocumentReference, DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import {
  MAX_CLIENT_CONTACTS,
  accessGrantKey,
  accessOpensJob,
  clientsAddedToJob,
  ensureReturningClientAccess,
  jobClientContactIds,
  readReturningClientAccess,
  returningClientAccessPlan,
  writeReturningClientAccess,
} from "../functions/src/client/returning-client-access.ts";
import { questionnaireLinkFor } from "../functions/src/planning/questionnaire-link.ts";

/**
 * F13, 2026-10-12 (prod walk, Jess Styles Bridal): a client who already had a
 * portal account never got access to their next job. Priya Shah's membership
 * listed only her wedding; the studio sent her Sangeet's booking link, and
 * "Read and sign" opened the wedding agreement she had already signed. An
 * invitation was minted only for a contact with no portal account, and
 * nothing else ever added a job to a membership.
 *
 * Now the job is added to the account's own active client membership when the
 * studio sends anything for it and when the job is made or the client is put
 * on it. A revoked or missing membership is never re-activated: the send
 * carries an invitation, as a new client's does.
 */

// The functions package's own copy of firebase-admin — the one the module
// under test builds its sentinels with — so `isEqual` compares like with like.
const functionsRequire = createRequire(join(process.cwd(), "functions/package.json"));
const { FieldValue } = functionsRequire("firebase-admin/firestore") as typeof import("firebase-admin/firestore");

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const TENANT = "tenant_jess";
const WEDDING = "job_wedding";
const SANGEET = "job_sangeet";

type Write = { kind: "update" | "create" | "set"; path: string; data: Record<string, unknown> };

/**
 * An in-memory Firestore just wide enough for these modules: documents by
 * path, `runTransaction`, `doc(...).get()`, auto ids for the audit trail.
 * Writes are recorded, and applied (an `arrayUnion` as a union), so a read
 * after a grant sees it.
 */
function fakeFirestore(initial: Record<string, Record<string, unknown>>) {
  const documents = new Map<string, Record<string, unknown>>(
    Object.entries(initial).map(([path, data]) => [path, structuredClone(data)]),
  );
  const writes: Write[] = [];
  const reads: string[] = [];
  let autoId = 0;
  const snapshot = (path: string) => {
    reads.push(path);
    const data = documents.get(path);
    return {
      id: path.split("/").pop(),
      ref: reference(path),
      exists: data !== undefined,
      data: () => (data ? structuredClone(data) : undefined),
      get: (field: string) => data?.[field],
    } as unknown as DocumentSnapshot;
  };
  function reference(path: string): DocumentReference {
    return {
      path,
      id: path.split("/").pop(),
      get: async () => snapshot(path),
    } as unknown as DocumentReference;
  }
  const apply = (path: string, data: Record<string, unknown>, replace: boolean) => {
    const current = replace ? {} : { ...(documents.get(path) ?? {}) };
    for (const [key, value] of Object.entries(data)) {
      const transform = value as { constructor?: { name?: string }; elements?: unknown[] };
      if (transform?.constructor?.name === "ArrayUnionTransform" && Array.isArray(transform.elements)) {
        const existing = Array.isArray(current[key]) ? (current[key] as unknown[]) : [];
        current[key] = [...existing, ...transform.elements.filter((element) => !existing.includes(element))];
      } else current[key] = value;
    }
    documents.set(path, current);
  };
  const writer = {
    update(ref: DocumentReference, data: Record<string, unknown>) {
      if (!documents.has(ref.path)) throw new Error(`NOT_FOUND ${ref.path}`);
      writes.push({ kind: "update", path: ref.path, data });
      apply(ref.path, data, false);
    },
    create(ref: DocumentReference, data: Record<string, unknown>) {
      if (documents.has(ref.path)) throw new Error(`ALREADY_EXISTS ${ref.path}`);
      writes.push({ kind: "create", path: ref.path, data });
      apply(ref.path, data, true);
    },
    set(ref: DocumentReference, data: Record<string, unknown>) {
      writes.push({ kind: "set", path: ref.path, data });
      apply(ref.path, data, false);
    },
  };
  const db = {
    doc: (path: string) => reference(path),
    collection: (name: string) => ({
      doc: (id?: string) => reference(`${name}/${id ?? `auto_${(autoId += 1)}`}`),
    }),
    runTransaction: async <T>(work: (transaction: unknown) => Promise<T>) =>
      work({ get: async (ref: DocumentReference) => snapshot(ref.path), ...writer }),
  } as unknown as Firestore;
  return { db, writes, reads, documents, writer };
}

/** Priya Shah: a contact with a portal account, a client of the studio for her wedding. */
const priya = (membership: Record<string, unknown> | null = {}) => ({
  "contacts/c_priya": { tenantId: TENANT, email: "priya@example.com", displayName: "Priya Shah", portalUserId: "u_priya" },
  ...(membership === null
    ? {}
    : {
        "memberships/tenant_jess_u_priya": {
          id: "tenant_jess_u_priya",
          tenantId: TENANT,
          userId: "u_priya",
          role: "client",
          status: "active",
          projectIds: [WEDDING],
          ...membership,
        },
      }),
});

const grant = { actorId: "studio_owner_1", now: "2026-10-12T15:00:00.000Z", reason: "agreement_sent" };

// ── The rule ──────────────────────────────────────────────────────────────

test("the rule: an active client membership in this studio that lacks the job is given it", () => {
  const contact = { exists: true, tenantId: TENANT, portalUserId: "u_priya" };
  const membership = { exists: true, tenantId: TENANT, userId: "u_priya", role: "client", status: "active", projectIds: [WEDDING] };
  const plan = (overrides: Partial<Parameters<typeof returningClientAccessPlan>[0]>) =>
    returningClientAccessPlan({ tenantId: TENANT, projectId: SANGEET, contact, membership, ...overrides });

  assert.equal(plan({}), "grant");
  assert.equal(plan({ projectId: WEDDING }), "already");
  // No account: the invitation path, exactly as for a new client.
  assert.equal(plan({ contact: { ...contact, portalUserId: "" } }), "no_account");
  assert.equal(plan({ contact: { ...contact, portalUserId: null } }), "no_account");
  // An account with no membership here, or one that is not active, is never
  // created or re-activated by a send.
  assert.equal(plan({ membership: null }), "no_membership");
  assert.equal(plan({ membership: { ...membership, exists: false } }), "no_membership");
  for (const status of ["revoked", "suspended", "invited", undefined])
    assert.equal(plan({ membership: { ...membership, status } }), "inactive", String(status));
  // Someone else's membership, or a studio seat, is never widened.
  assert.equal(plan({ membership: { ...membership, role: "studio_owner" } }), "not_client");
  assert.equal(plan({ membership: { ...membership, userId: "u_someone_else" } }), "not_client");
  assert.equal(plan({ membership: { ...membership, tenantId: "tenant_other" } }), "not_client");
  // Another studio's contact, or none.
  assert.equal(plan({ contact: { ...contact, tenantId: "tenant_other" } }), "not_this_studio");
  assert.equal(plan({ contact: null }), "not_this_studio");
  assert.equal(plan({ contact: { ...contact, exists: false } }), "not_this_studio");
  assert.equal(plan({ tenantId: "" }), "not_this_studio");
  assert.equal(plan({ projectId: "" }), "not_this_studio");

  assert.deepEqual(
    (["already", "grant", "no_account", "no_membership", "inactive", "not_client", "not_this_studio"] as const).filter(
      accessOpensJob,
    ),
    ["already", "grant"],
  );
});

test("a job's clients are its own list, de-duplicated and capped", () => {
  assert.deepEqual(jobClientContactIds(["a", "b", "a", "", 7, null, " "]), ["a", "b"]);
  assert.deepEqual(jobClientContactIds("a"), []);
  assert.deepEqual(jobClientContactIds(undefined), []);
  assert.equal(
    jobClientContactIds(Array.from({ length: 20 }, (_, index) => `c${index}`)).length,
    MAX_CLIENT_CONTACTS,
  );
});

// ── Grant on send ─────────────────────────────────────────────────────────

test("on send: Priya's Sangeet is added to the account she already has, and audited once", async () => {
  const store = fakeFirestore(priya());
  const access = await ensureReturningClientAccess(store.db, {
    tenantId: TENANT,
    projectId: SANGEET,
    clientContactIds: ["c_priya"],
    ...grant,
  });
  assert.equal(access.opens("c_priya"), true);
  assert.equal(access.opens("c_stranger"), false);

  const updates = store.writes.filter((write) => write.kind === "update");
  assert.equal(updates.length, 1);
  // Her own membership in this studio, and only the job added — nothing about
  // her role, status or anything else.
  assert.equal(updates[0]!.path, "memberships/tenant_jess_u_priya");
  assert.deepEqual(Object.keys(updates[0]!.data).sort(), ["projectIds", "updatedAt", "updatedBy"]);
  assert.ok(FieldValue.arrayUnion(SANGEET).isEqual(updates[0]!.data.projectIds as never), "arrayUnion, never a rewrite");
  assert.deepEqual(store.documents.get("memberships/tenant_jess_u_priya")!.projectIds, [WEDDING, SANGEET]);
  assert.equal(store.documents.get("memberships/tenant_jess_u_priya")!.status, "active");

  const audits = store.writes.filter((write) => write.kind === "create");
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.data.action, "client.project_access_granted");
  assert.equal(audits[0]!.data.tenantId, TENANT);
  assert.equal(audits[0]!.data.projectId, SANGEET);
  assert.equal(audits[0]!.data.entityId, "tenant_jess_u_priya");
  assert.deepEqual(audits[0]!.data.after, { projectId: SANGEET, contactId: "c_priya", reason: "agreement_sent" });
  assert.equal(audits[0]!.data.correlationId, accessGrantKey(TENANT, "u_priya", SANGEET));

  // A second send finds it there: no write, no second audit.
  const again = await ensureReturningClientAccess(store.db, {
    tenantId: TENANT,
    projectId: SANGEET,
    clientContactIds: ["c_priya"],
    ...grant,
  });
  assert.equal(again.opens("c_priya"), true);
  assert.equal(store.writes.length, 2);
});

test("on send: a revoked, suspended or missing membership is left exactly as it is", async () => {
  for (const membership of [{ status: "revoked" }, { status: "suspended" }, null]) {
    const store = fakeFirestore(priya(membership));
    const before = structuredClone(store.documents.get("memberships/tenant_jess_u_priya") ?? null);
    const access = await ensureReturningClientAccess(store.db, {
      tenantId: TENANT,
      projectId: SANGEET,
      clientContactIds: ["c_priya"],
      ...grant,
    });
    // Not opened, so the caller sends the invitation it always did.
    assert.equal(access.opens("c_priya"), false, JSON.stringify(membership));
    assert.deepEqual(store.writes, [], JSON.stringify(membership));
    assert.deepEqual(store.documents.get("memberships/tenant_jess_u_priya") ?? null, before);
  }
});

test("on send: only this studio's contacts, and each account once", async () => {
  // A contact that names another studio is never followed to a membership.
  const other = fakeFirestore({
    "contacts/c_other": { tenantId: "tenant_other", portalUserId: "u_priya" },
    "memberships/tenant_jess_u_priya": { tenantId: TENANT, userId: "u_priya", role: "client", status: "active", projectIds: [] },
  });
  const otherAccess = await ensureReturningClientAccess(other.db, {
    tenantId: TENANT,
    projectId: SANGEET,
    clientContactIds: ["c_other"],
    ...grant,
  });
  assert.equal(otherAccess.opens("c_other"), false);
  assert.deepEqual(other.writes, []);
  assert.ok(!other.reads.includes("memberships/tenant_jess_u_priya"));

  // Two contacts on the job linked to one account: one grant, one audit.
  const twice = fakeFirestore({
    ...priya(),
    "contacts/c_priya_dup": { tenantId: TENANT, email: "priya@example.com", portalUserId: "u_priya" },
  });
  await ensureReturningClientAccess(twice.db, {
    tenantId: TENANT,
    projectId: SANGEET,
    clientContactIds: ["c_priya", "c_priya_dup"],
    ...grant,
  });
  assert.equal(twice.writes.filter((write) => write.kind === "update").length, 1);
  assert.equal(twice.writes.filter((write) => write.kind === "create").length, 1);

  // Nothing to read for a job with no clients.
  const empty = fakeFirestore({});
  const none = await ensureReturningClientAccess(empty.db, { tenantId: TENANT, projectId: SANGEET, clientContactIds: [], ...grant });
  assert.deepEqual(none.entries, []);
  assert.deepEqual(empty.reads, []);
});

test("on send inside a caller's transaction: read first, then written beside the email", async () => {
  // The shape every send command uses: read with transaction.get before any
  // write, decide the link, then write the grant with the rest.
  const store = fakeFirestore(priya());
  const read = (reference: DocumentReference) => reference.get();
  const access = await readReturningClientAccess(store.db, read, {
    tenantId: TENANT,
    projectId: SANGEET,
    clientContactIds: ["c_priya"],
  });
  assert.deepEqual(store.writes, [], "a read writes nothing");
  assert.deepEqual(access.entries, [{ contactId: "c_priya", uid: "u_priya", plan: "grant" }]);
  assert.equal(writeReturningClientAccess(store.db, store.writer, access, grant), 1);
  assert.deepEqual(store.documents.get("memberships/tenant_jess_u_priya")!.projectIds, [WEDDING, SANGEET]);
});

test("the questionnaire send: Priya gets the plain portal link, not an invitation she doesn't need", async () => {
  const store = fakeFirestore(priya());
  const link = await questionnaireLinkFor(store.db, {
    tenantId: TENANT,
    projectId: SANGEET,
    clientContactIds: ["c_priya"],
    emailJobId: "questionnaire_k1",
    actorId: "studio_owner_1",
    now: "2026-10-12T15:00:00.000Z",
  });
  assert.equal(link.invitationWrite, null);
  assert.match(link.actionUrl, /\/client\/questionnaire$/);
  assert.deepEqual(store.documents.get("memberships/tenant_jess_u_priya")!.projectIds, [WEDDING, SANGEET]);

  // Revoked: no grant, and the invitation she must accept herself.
  const revoked = fakeFirestore(priya({ status: "revoked" }));
  const invited = await questionnaireLinkFor(revoked.db, {
    tenantId: TENANT,
    projectId: SANGEET,
    clientContactIds: ["c_priya"],
    emailJobId: "questionnaire_k2",
    actorId: "studio_owner_1",
    now: "2026-10-12T15:00:00.000Z",
  });
  assert.ok(invited.invitationWrite, "an invitation");
  assert.match(invited.actionUrl, /\/auth\/client-invite\?token=/);
  assert.equal(revoked.documents.get("memberships/tenant_jess_u_priya")!.status, "revoked");
  assert.deepEqual(revoked.documents.get("memberships/tenant_jess_u_priya")!.projectIds, [WEDDING]);
});

test("every send path decides the invitation by access to this job, not by having an account", () => {
  const paths = [
    "functions/src/booking/proposals.ts",
    "functions/src/contracts/commands.ts",
    "functions/src/contracts/combined-commands.ts",
    "functions/src/contracts/follow-ups.ts",
    "functions/src/contracts/amendments.ts",
  ];
  for (const path of paths) {
    const file = source(path);
    assert.match(file, /readReturningClientAccess\(/, `${path} reads the client's access`);
    assert.match(file, /writeReturningClientAccess\(/, `${path} writes the grant beside the send`);
    assert.match(file, /access\.opens\(clientContactId\)/, `${path} decides the link by access to this job`);
    // An account alone used to count as access: never again.
    assert.doesNotMatch(file, /get\("portalUserId"\)/, `${path} still treats an account as access`);
    // Partners are decided the same way.
    const partnerCalls = file.split("preparePartnerSends(").slice(1);
    assert.ok(partnerCalls.length > 0, path);
    for (const call of partnerCalls) assert.match(call.slice(0, 900), /\baccess,/, `${path} passes access to partners`);
  }
  // The questionnaire, shot-list and other form links grant first.
  assert.match(source("functions/src/planning/questionnaire-link.ts"), /await ensureReturningClientAccess\(db,/);
  // Whatever else the studio sends a client about a job — a booking
  // confirmation, a schedule, a delivery — grants as it goes.
  const worker = source("functions/src/operations/jobs.ts");
  assert.match(worker, /projectId && recipientIsClient && project\?\.exists && project\.get\("tenantId"\) === tenantId\s*\? await ensureReturningClientAccess\(db,/);
});

// ── Grant on create / assignment ─────────────────────────────────────────

test("on create or assignment: only the clients a write newly put on the job", () => {
  const job = { tenantId: TENANT, clientContactIds: ["c_priya"] };
  // Made: everyone on it.
  assert.deepEqual(clientsAddedToJob(null, job), ["c_priya"]);
  // A partner added: only them.
  assert.deepEqual(
    clientsAddedToJob(job, { ...job, clientContactIds: ["c_priya", "c_partner"] }),
    ["c_partner"],
  );
  // Any other write the job sees: nothing to read, nothing to grant.
  assert.deepEqual(clientsAddedToJob(job, { ...job, state: "BOOKED" } as typeof job), []);
  assert.deepEqual(clientsAddedToJob(job, { ...job, clientContactIds: [] }), []);
  // Put away or deleted: nothing.
  assert.deepEqual(clientsAddedToJob(null, { ...job, archivedAt: "2026-10-12" }), []);
  assert.deepEqual(clientsAddedToJob(null, { ...job, deletedAt: "2026-10-12" }), []);
  assert.deepEqual(clientsAddedToJob(job, null), []);
  // No tenant, no grant.
  assert.deepEqual(clientsAddedToJob(null, { clientContactIds: ["c_priya"] }), []);
});

test("on create: the trigger is exported, grants only what a write added, and as the system", async () => {
  const trigger = source("functions/src/client/returning-client-access-trigger.ts");
  assert.match(trigger, /onDocumentWritten\(\s*\{ document: "projects\/\{projectId\}"/);
  assert.match(trigger, /const added = clientsAddedToJob\(/);
  assert.match(trigger, /if \(!added\.length\) return;/);
  assert.match(trigger, /clientContactIds: added,/);
  assert.match(trigger, /reason: before\?\.exists \? "client_added_to_job" : "job_created"/);
  assert.match(source("functions/src/index.ts"), /export \{ clientAccessOnProjectWrite \} from "\.\/client\/returning-client-access-trigger\.js";/);

  // What it does with a new job: the same grant as a send.
  const store = fakeFirestore(priya());
  await ensureReturningClientAccess(store.db, {
    tenantId: TENANT,
    projectId: SANGEET,
    clientContactIds: clientsAddedToJob(null, { tenantId: TENANT, clientContactIds: ["c_priya"] }),
    actorId: "system:client-access",
    now: "2026-10-12T14:00:00.000Z",
    reason: "job_created",
  });
  assert.deepEqual(store.documents.get("memberships/tenant_jess_u_priya")!.projectIds, [WEDDING, SANGEET]);
  const audit = store.writes.find((write) => write.kind === "create")!;
  assert.equal(audit.data.actorType, "system");
  assert.equal((audit.data.after as { reason: string }).reason, "job_created");
});

// ── The backfill ─────────────────────────────────────────────────────────

test("the backfill is dry by default, one named studio at a time, and uses the server's rule", () => {
  const script = source("scripts/backfill-returning-client-access.mts");
  assert.match(script, /const apply = args\.includes\("--apply"\);/);
  assert.match(script, /if \(apply && \(await grant\(/);
  assert.match(script, /There is no --all/);
  assert.match(script, /\.where\("tenantId", "==", tenantId\)/);
  assert.match(script, /returningClientAccessPlan\(/);
  assert.match(script, /FieldValue\.arrayUnion\(projectId\)/);
  // Never touches a membership's status.
  assert.doesNotMatch(script, /status:\s*"active"/);
});
