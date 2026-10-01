import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { DocumentReference, DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import {
  MAX_PARTNER_SENDS,
  partnerEmailJobId,
  partnerEmailJobs,
  partnerHasPortalAccess,
  partnerRecipientsFor,
  preparePartnerSends,
  queuePartnerSends,
  sendSeparately,
} from "../functions/src/client/partner-invitations.ts";
import { hashToken, invitationIdFor } from "../functions/src/client/invitation-mint.ts";

/**
 * A partner copied on a proposal, agreement, booking change or questionnaire
 * was handed the first client's invitation link — which only ever accepts the
 * first client's address — and was refused when they signed in as themselves.
 * Each partner now gets their own invitation and their own email.
 */

const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

const contacts = [
  { id: "c1", tenantId: "t1", email: "Alex@Example.com", displayName: "Alex Smith" },
  { id: "c2", tenantId: "t1", email: "jordan@example.com", firstName: "Jordan", lastName: "Lee" },
  { id: "c3", tenantId: "t2", email: "other-studio@example.com" },
  { id: "c4", tenantId: "t1", email: "not-an-email" },
  { id: "c5", tenantId: "t1", email: "ALEX@example.com" },
];

test("partners are the job's other clients in this studio, with their own distinct address", () => {
  const partners = partnerRecipientsFor({
    tenantId: "t1",
    clientContactIds: ["c1", "c2", "c3", "c4", "c5", "missing"],
    primaryContactId: "c1",
    primaryEmail: "alex@example.com",
    contacts,
  });
  // c3 is another studio's; c4 has no usable address; c5 repeats the
  // addressed client's; "missing" doesn't exist.
  assert.deepEqual(partners, [{ contactId: "c2", email: "jordan@example.com", name: "Jordan Lee", portalUserId: "" }]);
  assert.deepEqual(
    partnerRecipientsFor({ tenantId: "t1", clientContactIds: "c1", primaryContactId: "c1", primaryEmail: "", contacts }),
    [],
  );
  // At most as many as the worker would have copied onto one email.
  const many = Array.from({ length: 6 }, (_, index) => ({ id: `p${index}`, tenantId: "t1", email: `p${index}@example.com` }));
  assert.equal(
    partnerRecipientsFor({
      tenantId: "t1",
      clientContactIds: ["c1", ...many.map((item) => item.id)],
      primaryContactId: "c1",
      primaryEmail: "alex@example.com",
      contacts: many,
    }).length,
    MAX_PARTNER_SENDS,
  );
});

test("a partner is already in only if their portal membership opens this job", () => {
  const membership = { exists: true, status: "active", role: "client", projectIds: ["job1"] };
  assert.equal(partnerHasPortalAccess({ portalUserId: "u2", membership, projectId: "job1" }), true);
  // An account from an earlier wedding with this studio doesn't open this one.
  assert.equal(partnerHasPortalAccess({ portalUserId: "u2", membership, projectId: "job2" }), false);
  assert.equal(partnerHasPortalAccess({ portalUserId: "", membership, projectId: "job1" }), false);
  assert.equal(partnerHasPortalAccess({ portalUserId: "u2", membership: { ...membership, status: "revoked" }, projectId: "job1" }), false);
  assert.equal(partnerHasPortalAccess({ portalUserId: "u2", membership: { ...membership, role: "studio_owner" }, projectId: "job1" }), false);
  assert.equal(partnerHasPortalAccess({ portalUserId: "u2", membership: null, projectId: "job1" }), false);
});

test("one email each only when someone's link is an invitation", () => {
  assert.equal(sendSeparately({ primaryNeedsInvite: true, partners: [] }), false);
  assert.equal(sendSeparately({ primaryNeedsInvite: true, partners: [{ needsInvite: false }] }), true);
  assert.equal(sendSeparately({ primaryNeedsInvite: false, partners: [{ needsInvite: true }] }), true);
  // Everyone already in: one shared email with the plain portal link, as before.
  assert.equal(sendSeparately({ primaryNeedsInvite: false, partners: [{ needsInvite: false }] }), false);
});

test("each person's invitation is their own, so one partner's new link never retires another's", () => {
  const primary = invitationIdFor("t1", "job1", "alex@example.com");
  const partner = invitationIdFor("t1", "job1", "jordan@example.com");
  assert.notEqual(primary, partner);
  // And per job: the same partner on another wedding is another invitation.
  assert.notEqual(partner, invitationIdFor("t1", "job2", "jordan@example.com"));
});

/** A Firestore stand-in: just enough for preparePartnerSends' reads. */
function fakeDb(documents: Record<string, Record<string, unknown>>) {
  const reference = (path: string) => ({ path, id: path.split("/").pop() }) as unknown as DocumentReference;
  const db = { doc: reference } as unknown as Firestore;
  const read = async (ref: DocumentReference) => {
    const data = documents[ref.path];
    return {
      id: ref.id,
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
    } as unknown as DocumentSnapshot;
  };
  return { db, read };
}

const job = (overrides: Partial<Parameters<typeof preparePartnerSends>[2]> = {}) => ({
  tenantId: "t1",
  projectId: "job1",
  clientContactIds: ["c1", "c2"],
  primaryContactId: "c1",
  primaryEmail: "alex@example.com",
  primaryNeedsInvite: true,
  primaryEmailJobId: "proposal_email_1",
  appUrl: "https://studio-cue.com",
  path: "/client/proposal",
  actorId: "owner",
  now: "2026-10-01T12:00:00.000Z",
  ...overrides,
});

test("the partner gets their own invitation, bound to their own address and contact", async () => {
  const { db, read } = fakeDb({
    "contacts/c1": { tenantId: "t1", email: "alex@example.com" },
    "contacts/c2": { tenantId: "t1", email: "Jordan@Example.com", displayName: "Jordan Lee" },
    [`clientInvitations/${invitationIdFor("t1", "job1", "jordan@example.com")}`]: {
      sendCount: 2,
      createdAt: "2026-09-01T00:00:00.000Z",
      createdBy: "admin",
    },
  });
  const sends = await preparePartnerSends(db, read, job());
  assert.equal(sends.length, 1);
  const [send] = sends;
  assert.equal(send!.contactId, "c2");
  assert.equal(send!.email, "jordan@example.com");
  const token = new URL(send!.actionUrl).searchParams.get("token")!;
  assert.ok(send!.actionUrl.startsWith("https://studio-cue.com/auth/client-invite?"));
  assert.equal(new URL(send!.actionUrl).searchParams.get("next"), "/client/proposal");
  const write = send!.invitationWrite!;
  assert.equal(write.reference.id, invitationIdFor("t1", "job1", "jordan@example.com"));
  assert.equal(write.data.contactId, "c2");
  // Acceptance compares the signed-in address with this one: the partner's.
  assert.equal(write.data.normalizedEmail, "jordan@example.com");
  assert.equal(write.data.tokenHash, hashToken(token));
  assert.equal(write.data.status, "pending");
  assert.equal(write.data.latestEmailJobId, partnerEmailJobId("proposal_email_1", 0));
  // A resend counts on from what was there, and keeps who first invited them.
  assert.equal(write.data.sendCount, 3);
  assert.equal(write.data.createdAt, "2026-09-01T00:00:00.000Z");
  assert.equal(write.data.createdBy, "admin");
});

test("a partner already in the portal gets their own copy with the plain link", async () => {
  const { db, read } = fakeDb({
    "contacts/c2": { tenantId: "t1", email: "jordan@example.com", portalUserId: "u2" },
    "memberships/t1_u2": { status: "active", role: "client", projectIds: ["job1"] },
  });
  const sends = await preparePartnerSends(db, read, job());
  assert.equal(sends.length, 1);
  assert.equal(sends[0]!.actionUrl, "https://studio-cue.com/client/proposal");
  assert.equal(sends[0]!.invitationWrite, null);
  // Nobody needs an invitation: nothing separate, the shared email stands.
  assert.deepEqual(await preparePartnerSends(db, read, job({ primaryNeedsInvite: false })), []);
});

test("another studio's contact on the list is never invited", async () => {
  const { db, read } = fakeDb({ "contacts/c2": { tenantId: "t2", email: "jordan@example.com" } });
  assert.deepEqual(await preparePartnerSends(db, read, job()), []);
});

test("the partner's email job is the same email, to them, with their link, copied to nobody", () => {
  const primary = {
    id: "contract_ready_k1",
    tenantId: "t1",
    projectId: "job1",
    contractId: "k1",
    proposalId: "p1",
    invoiceId: "i1",
    type: "contract_ready",
    recipient: "alex@example.com",
    recipientName: "Alex",
    actionUrl: "https://studio-cue.com/auth/client-invite?token=alex",
    soleRecipient: true,
    status: "queued",
  };
  const [copy] = partnerEmailJobs(primary, [
    {
      contactId: "c2",
      email: "jordan@example.com",
      name: "Jordan Lee",
      actionUrl: "https://studio-cue.com/auth/client-invite?token=jordan",
      invitationWrite: null,
    },
  ]);
  assert.equal(copy!.id, "contract_ready_k1_partner_1");
  assert.equal(copy!.data.recipient, "jordan@example.com");
  assert.equal(copy!.data.recipientName, "Jordan Lee");
  assert.equal(copy!.data.contactId, "c2");
  assert.equal(copy!.data.actionUrl, "https://studio-cue.com/auth/client-invite?token=jordan");
  assert.equal(copy!.data.soleRecipient, true);
  assert.equal(copy!.data.partnerOfEmailJobId, "contract_ready_k1");
  // Still about the same contract (the worker re-reads it before sending)...
  assert.equal(copy!.data.contractId, "k1");
  assert.equal(copy!.data.type, "contract_ready");
  // ...but the proposal's and bill's delivery status follow the addressed client's email only.
  assert.equal("proposalId" in copy!.data, false);
  assert.equal("invoiceId" in copy!.data, false);
});

test("the copies and invitations are written beside the addressed client's", () => {
  const writes: Array<[string, string]> = [];
  const db = { doc: (path: string) => ({ path }) } as unknown as Firestore;
  queuePartnerSends(
    db,
    {
      create: (reference) => writes.push(["create", (reference as unknown as { path: string }).path]),
      set: (reference, _data, options) => {
        assert.deepEqual(options, { merge: true });
        writes.push(["set", (reference as unknown as { path: string }).path]);
      },
    },
    { id: "job_email" },
    [
      {
        contactId: "c2",
        email: "jordan@example.com",
        name: "",
        actionUrl: "x",
        invitationWrite: { reference: { path: "clientInvitations/inv2" } as unknown as DocumentReference, data: {} },
      },
    ],
  );
  assert.deepEqual(writes, [
    ["create", "emailJobs/job_email_partner_1"],
    ["set", "clientInvitations/inv2"],
  ]);
});

const SEND_PATHS = [
  "functions/src/booking/proposals.ts",
  "functions/src/contracts/commands.ts",
  "functions/src/contracts/combined-commands.ts",
  "functions/src/contracts/follow-ups.ts",
  "functions/src/contracts/amendments.ts",
  "functions/src/planning/questionnaire-link.ts",
];

test("every send path that mints an invitation also gives the partner theirs", () => {
  for (const path of SEND_PATHS) {
    const text = source(path);
    const mints = (text.match(/mintClientInvitation\(/g) ?? []).length;
    const prepares = (text.match(/preparePartnerSends\(/g) ?? []).length;
    assert.ok(mints > 0, `${path} no longer mints an invitation`);
    assert.equal(prepares, mints, `${path}: ${mints} invitation(s) minted, ${prepares} partner send(s) prepared`);
  }
  // The questionnaire's four senders write what questionnaireLinkFor prepared.
  for (const path of [
    "functions/src/planning/commands.ts",
    "functions/src/planning/questionnaire-reminder-scheduler.ts",
  ]) {
    const text = source(path);
    const links = (text.match(/questionnaireLinkFor\(db/g) ?? []).length;
    assert.equal((text.match(/queuePartnerSends\(db, /g) ?? []).length, links, path);
    assert.equal((text.match(/soleRecipient: link\.partnerSends\.length > 0/g) ?? []).length, links, path);
  }
  for (const path of SEND_PATHS.filter((path) => !path.includes("questionnaire-link"))) {
    const text = source(path);
    const prepares = (text.match(/preparePartnerSends\(/g) ?? []).length;
    assert.equal((text.match(/queuePartnerSends\(db, /g) ?? []).length, prepares, path);
    assert.equal((text.match(/soleRecipient: partnerSends\.length > 0/g) ?? []).length, prepares, path);
  }
});

test("the worker doesn't copy anyone onto a one-each email", () => {
  const jobs = source("functions/src/operations/jobs.ts");
  assert.match(
    jobs,
    /const partnerRecipients = context\.recipientIsClient && document\.get\("soleRecipient"\) !== true/,
  );
});

test("acceptance still binds the invitation to one address and one job", () => {
  const accept = source("functions/src/client/invitations.ts");
  const block = accept.slice(accept.indexOf('if (parsed.type === "accept")'), accept.indexOf("const membership = await db"));
  // The signed-in address must be the invitation's, and the contact's.
  assert.match(block, /normalizeEmail\(identity\.email as string\) !==\s+String\(invitation\.get\("normalizedEmail"\)\)/);
  assert.match(block, /normalizeEmail\(String\(contact\.get\("email"\)\)\) !==\s+normalizeEmail\(identity\.email as string\)/);
  assert.match(block, /INVITED_EMAIL_MISMATCH/);
  // The membership opens the invitation's job, added to any they already had.
  assert.match(block, /role: "client"/);
  assert.match(block, /\.\.\.\(Array\.isArray\(priorProjects\)[\s\S]*projectId,\s+\]\)/);
});
