import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TENANT_DELETION_DEFERRED,
  TENANT_DELETION_KEPT,
  keptDocument,
  tenantDeletionMaySweep,
  tenantDeletionRefusal,
  type TenantDeletionState,
} from "../functions/src/saas/tenant-deletion-policy.js";

/**
 * A whole studio is never deleted while it is paying, comped or otherwise
 * live, at any stage, and never takes another studio's records with it
 * (audit 2026-10-22; functions/src/saas/tenant-deletion-policy.ts). The
 * emulator half is tests/tenant-deletion-sweep.test.ts.
 */

const TENANT = "tenant-closing";
const state = (subscription: TenantDeletionState["subscription"]): TenantDeletionState => ({ tenantId: TENANT, subscription });
const sub = (fields: Record<string, unknown>) => state({ tenantId: TENANT, comped: false, compMode: null, stripeSubscriptionId: "sub_1", ...fields });
const code = (input: TenantDeletionState) => tenantDeletionRefusal(input)?.code ?? null;

test("comped in any mode is refused, whatever its status says", () => {
  // The reference studio's shape (saas/onboarding.ts): active, no Stripe ids.
  assert.equal(code(sub({ status: "active", comped: true, compMode: "local", stripeSubscriptionId: null })), "STUDIO_COMPED");
  // A comp at onboarding before compMode existed.
  assert.equal(code(sub({ status: "active", comped: true, compMode: undefined, stripeSubscriptionId: null })), "STUDIO_COMPED");
  // A 100%-off Stripe coupon (console/handlers/billing.ts).
  assert.equal(code(sub({ status: "active", comped: true, compMode: "stripe_coupon" })), "STUDIO_COMPED");
  // A comp outranks an ended status: ending the comp is a decision of its own.
  assert.equal(code(sub({ status: "cancelled", comped: true, compMode: "local" })), "STUDIO_COMPED");
});

test("every status Stripe still bills, retries or can resume is refused", () => {
  for (const status of ["trialing", "active", "past_due", "unpaid", "paused"])
    assert.equal(code(sub({ status })), "SUBSCRIPTION_LIVE", status);
  // Cancelling at period end is still paying until then.
  assert.equal(code(sub({ status: "active", cancelAtPeriodEnd: true })), "SUBSCRIPTION_LIVE");
  // Stripe waiting on a first payment.
  assert.equal(code(sub({ status: "incomplete" })), "SUBSCRIPTION_LIVE");
  // Live with no Stripe id at all (the gap the old check had) is still live.
  assert.equal(code(sub({ status: "active", stripeSubscriptionId: null })), "SUBSCRIPTION_LIVE");
});

test("an ended subscription is allowed", () => {
  for (const status of ["cancelled", "canceled", "incomplete_expired"]) assert.equal(code(sub({ status })), null, status);
  // A comp that was ended (no Stripe subscription behind it), or a Checkout never finished.
  assert.equal(code(sub({ status: "incomplete", stripeSubscriptionId: null })), null);
  assert.equal(tenantDeletionRefusal(sub({ status: "canceled" })), null);
});

test("unreadable, missing or self-contradicting records are refused", () => {
  assert.equal(code(state("unreadable")), "SUBSCRIPTION_UNREADABLE");
  assert.equal(code(state(null)), "SUBSCRIPTION_MISSING");
  assert.equal(code(state({ status: "cancelled" })), "SUBSCRIPTION_INCONSISTENT", "no tenantId");
  assert.equal(code(sub({ status: "cancelled", tenantId: "someone-else" })), "SUBSCRIPTION_INCONSISTENT");
  assert.equal(code({ tenantId: "", subscription: { tenantId: "", status: "cancelled" } }), "SUBSCRIPTION_INCONSISTENT");
  assert.equal(code(sub({ status: "cancelled", comped: "yes" })), "SUBSCRIPTION_INCONSISTENT");
  assert.equal(code(sub({ status: "cancelled", comped: false, compMode: "local" })), "SUBSCRIPTION_INCONSISTENT");
  for (const status of ["", "deleted", 3, null]) assert.equal(code(sub({ status })), "SUBSCRIPTION_INCONSISTENT", String(status));
  // Every refusal says why, in words.
  assert.match(tenantDeletionRefusal(sub({ status: "past_due" }))!.reason, /past due/);
});

test("records that are someone else's are never swept", () => {
  for (const collection of [
    "saasReferrals",
    "vendorInvites",
    "saasInvoices",
    "saasAttribution",
    "saasLeads",
    "supportAccess",
    "consoleStudios",
    "consoleNotes",
    "consoleTasks",
    "consoleLifecycleEvents",
    "auditEvents",
    "deletionRequests",
    "webhookEvents",
  ]) {
    assert.ok(TENANT_DELETION_KEPT.includes(collection), collection);
    assert.equal(tenantDeletionMaySweep(collection), false, collection);
  }
  // The handle and the record the refusal reads are deleted by name, last.
  assert.deepEqual([...TENANT_DELETION_DEFERRED].sort(), ["subscriptions", "tenants"]);
  for (const collection of TENANT_DELETION_DEFERRED) assert.equal(tenantDeletionMaySweep(collection), false, collection);
  // The studio's own records go.
  for (const collection of ["projects", "contacts", "memberships", "integrationConnections", "feedback", "saasReferralCodes"])
    assert.equal(tenantDeletionMaySweep(collection), true, collection);
  // A vendor's offer code names the inviting studio but is the vendor's.
  assert.equal(keptDocument("saasReferralCodes", { code: "VENDOR50", kind: "vendor_offer", tenantId: TENANT, offerFor: "hash" }), true);
  assert.equal(keptDocument("saasReferralCodes", { code: "CLOSING", tenantId: TENANT }), false);
  assert.equal(keptDocument("projects", { kind: "vendor_offer" }), false);
});

const worker = readFileSync(new URL("../functions/src/saas/tenant-deletion.ts", import.meta.url), "utf8");
const body = worker.slice(worker.indexOf("export async function deleteTenant"), worker.indexOf("export const tenantDeletionWorker"));

test("the refusal is read before every irreversible step, in the documented order", () => {
  // Each step's destructive call, in the order the header documents.
  const steps: Array<[string, string]> = [
    ["records", "batch.delete(doc.ref)"],
    ["audit", "batch.update(doc.ref, { before: null"],
    ["credentials", "deps.deleteCredential("],
    ["people", "deps.deleteAuthUser("],
    ["files", "deps.deletePrefix("],
    ["handle", "batch.delete(db.doc(`tenants/"],
  ];
  let previous = body.indexOf('await checkpoint("start")');
  assert.ok(previous > 0, "a checkpoint at the run's start");
  assert.ok(previous < body.indexOf('status: "deleting"'), "the start check comes before the run is marked deleting");
  for (const [step, call] of steps) {
    const at = body.indexOf(call);
    assert.ok(at > previous, `${step}: its call comes after the step before it`);
    const check = body.lastIndexOf("await checkpoint(", at);
    assert.ok(check > previous, `${step}: a checkpoint between the step before it and ${call}`);
    previous = at;
  }
  // The checkpoint reads the subscription fresh and refuses through the one rule.
  const checkpoint = body.slice(body.indexOf("const checkpoint = async"), body.indexOf('await checkpoint("start")'));
  assert.match(checkpoint, /await reference\.get\(\)/);
  assert.match(checkpoint, /tenantDeletionRefusal\(await readTenantDeletionState\(db, tenantId\)\)/);
  assert.match(checkpoint, /refuseTenantDeletion\(/);
  // The sweep keeps what is someone else's.
  assert.match(body, /if \(!tenantDeletionMaySweep\(collection\)\) continue;/);
  assert.match(body, /!keptDocument\(collection, doc\.data\(\)\)/);
  // The subscription the checks read goes in the final batch, with the handle.
  assert.ok(body.indexOf("batch.delete(db.doc(`subscriptions/") > body.indexOf('await checkpoint("handle")'));
});

test("a refusal is recorded as refused, logged as an operational error, and not picked up again", () => {
  const refuse = worker.slice(worker.indexOf("export async function refuseTenantDeletion"), worker.indexOf("async function pages"));
  assert.match(refuse, /logger\.error\(/);
  assert.match(refuse, /studiocueOperationalError: true/);
  assert.match(refuse, /code: "TENANT_DELETION_REFUSED"/);
  assert.match(refuse, /tenantId: input\.tenantId/);
  assert.match(refuse, /reason: input\.refusal\.reason/);
  assert.match(refuse, /status: "refused"/);
  // The hourly worker only picks up approved and deleting requests.
  assert.match(worker, /where\("status", "in", \["platform_approved", "deleting"\]\)/);
});

test("the Console's approval refuses through the same rule before approving", () => {
  const operations = readFileSync(new URL("../functions/src/console/handlers/operations.ts", import.meta.url), "utf8");
  const approve = operations.slice(operations.indexOf("approveDeletion: consoleHandler"));
  const check = approve.indexOf("tenantDeletionRefusal(await readTenantDeletionState(db, tenantId))");
  assert.ok(check > 0, "approval reads the refusal");
  assert.ok(check < approve.indexOf('status: "platform_approved"'), "before the request is approved");
  assert.match(approve, /refuseTenantDeletion\(reference, \{[^}]*step: "approval"/);
  assert.match(approve, /fail\("TENANT_DELETION_REFUSED"\)/);
});
