import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  BILLING_ADDRESS_REQUEST_EMAIL,
  billingAddressEmailJob,
  billingAddressNeeded,
  requestBillingAddressIn,
  scheduledRequestStatus,
} from "../functions/src/billing/billing-address-request.ts";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { confirmRequestedBillingAddress } from "@/server/billing/billing-address-request";
import { todayInbox } from "@/features/today/inbox";
import { coupleBillingAddressProvenance } from "@/features/contacts/billing-address-signing";

/**
 * QuickBooks taxes the final from the couple's billing address. Signing asks
 * for it, but couples who signed before the studio charged tax, imported
 * bookings and contracts signed elsewhere never reach that step — so
 * StudioCue asks them, eight weeks out, and never emails a quiet booking on
 * its own.
 */

const read = (path: string) => readFileSync(path, "utf8");

// ---------- A small in-memory Firestore ----------

type Data = Record<string, unknown>;
const getPath = (data: Data | undefined, path: string): unknown =>
  path.split(".").reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Data)[key] : undefined), data);

class FakeDb {
  store = new Map<string, Data>();
  doc(path: string) {
    return new FakeRef(this, path);
  }
  collection(name: string) {
    return new FakeQuery(this, name, []);
  }
  snapshot(path: string) {
    const data = this.store.get(path);
    const ref = this.doc(path);
    return {
      exists: data !== undefined,
      id: ref.id,
      ref,
      get: (field: string) => getPath(data, field),
      data: () => (data ? structuredClone(data) : undefined),
    };
  }
  async runTransaction<T>(fn: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
    const transaction = new FakeTransaction(this);
    const result = await fn(transaction);
    for (const apply of transaction.pending) apply();
    return result;
  }
}
class FakeRef {
  constructor(readonly db: FakeDb, readonly path: string) {}
  get id() {
    return this.path.split("/").pop()!;
  }
  async get() {
    return this.db.snapshot(this.path);
  }
}
class FakeQuery {
  constructor(readonly db: FakeDb, readonly name: string, readonly filters: Array<[string, unknown]>) {}
  where(field: string, _op: string, value: unknown) {
    return new FakeQuery(this.db, this.name, [...this.filters, [field, value]]);
  }
  limit() {
    return this;
  }
  run() {
    const docs = [...this.db.store.keys()]
      .filter((path) => path.startsWith(`${this.name}/`))
      .map((path) => this.db.snapshot(path))
      .filter((snapshot) => this.filters.every(([field, value]) => snapshot.get(field) === value));
    return { docs, empty: docs.length === 0 };
  }
}
class FakeTransaction {
  pending: Array<() => void> = [];
  constructor(readonly db: FakeDb) {}
  async get(target: FakeRef | FakeQuery) {
    assert.equal(this.pending.length, 0, "a read after a write in the transaction");
    return target instanceof FakeQuery ? target.run() : this.db.snapshot(target.path);
  }
  create(ref: FakeRef, data: Data) {
    this.pending.push(() => {
      assert.ok(!this.db.store.has(ref.path), `create of existing ${ref.path}`);
      this.db.store.set(ref.path, structuredClone(data));
    });
  }
  set(ref: FakeRef, data: Data, options?: { merge?: boolean }) {
    this.pending.push(() => this.db.store.set(ref.path, { ...(options?.merge ? this.db.store.get(ref.path) : {}), ...structuredClone(data) }));
  }
  update(ref: FakeRef, changes: Data) {
    this.pending.push(() => {
      const current = this.db.store.get(ref.path);
      assert.ok(current, `update of missing ${ref.path}`);
      for (const [key, value] of Object.entries(changes)) {
        const keys = key.split(".");
        let target = current;
        for (const part of keys.slice(0, -1)) target = (target[part] ??= {}) as Data;
        target[keys[keys.length - 1]!] = structuredClone(value);
      }
    });
  }
}

const T = "tenant_a";
const P = "project_1";
const ADDRESS = { line1: "2600 Marine Way", line2: null, city: "Mountain View", region: "CA", postalCode: "94043", country: "US" };

function studio(db: FakeDb, options: { address?: boolean } = {}) {
  db.store.set(`billingSettings/${T}`, { tenantId: T, salesTax: { mode: "quickbooks", estimateRateBasisPoints: 825 } });
  db.store.set(`integrationConnections/${T}_quickbooks`, { tenantId: T, provider: "quickbooks", status: "connected" });
  db.store.set(`tenantFeatures/${T}`, { tenantId: T, quickbooksItemisedInvoices: true });
  db.store.set(`projects/${P}`, { tenantId: T, name: "Avery & Sam", state: "BOOKED", eventDate: "2026-11-20", clientContactIds: ["c1"] });
  db.store.set("contacts/c1", {
    tenantId: T,
    email: "avery@example.com",
    normalizedEmail: "avery@example.com",
    ...(options.address ? { billingAddress: ADDRESS } : {}),
  });
}

// ---------- Who needs asking ----------

test("only a job QuickBooks will tax, with no address on any contact, needs one", () => {
  const base = {
    project: { tenantId: T, state: "BOOKED" },
    billingSettings: { tenantId: T, salesTax: { mode: "quickbooks" } },
    tenantId: T,
    quickBooksConnected: true,
    itemisedInvoices: true,
    contacts: [{ email: "a@example.com" }],
  };
  assert.equal(billingAddressNeeded(base), true);
  assert.equal(billingAddressNeeded({ ...base, contacts: [{ email: "a@example.com" }, { billingAddress: ADDRESS }] }), false, "the partner's address is enough");
  assert.equal(billingAddressNeeded({ ...base, quickBooksConnected: false }), false);
  assert.equal(billingAddressNeeded({ ...base, itemisedInvoices: false }), false, "not switched on: QuickBooks adds no tax");
  assert.equal(billingAddressNeeded({ ...base, billingSettings: { tenantId: T, salesTax: { mode: "none" } } }), false);
  assert.equal(billingAddressNeeded({ ...base, billingSettings: null }), false, "never saved: no tax");
  assert.equal(billingAddressNeeded({ ...base, project: { tenantId: T, salesTaxExempt: true } }), false);
  assert.equal(billingAddressNeeded({ ...base, contacts: [{ billingAddress: { line1: "1 Main St" } }] }), true, "a street with no city isn't an address");
});

test("the scheduler emails eight weeks out, and never a quiet booking on its own", () => {
  const today = "2026-10-01";
  const horizon = "2026-11-26";
  const job = (fields: Data) => ({ state: "BOOKED", eventDate: "2026-11-20", ...fields });
  assert.equal(scheduledRequestStatus(job({}), today, horizon), "requested");
  assert.equal(scheduledRequestStatus(job({ state: "PLANNING" }), today, horizon), "requested");
  assert.equal(scheduledRequestStatus(job({ eventDate: "2026-12-20" }), today, horizon), null, "not yet");
  assert.equal(scheduledRequestStatus(job({ eventDate: "2026-09-20" }), today, horizon), null, "over");
  assert.equal(scheduledRequestStatus(job({ state: "INQUIRY" }), today, horizon), null, "not booked");
  // Imported quiet / paused / on hold: the studio decides, from Today.
  assert.equal(scheduledRequestStatus(job({ clientAutomationsPausedAt: "2026-09-17T00:00:00Z" }), today, horizon), "needs_studio");
  assert.equal(scheduledRequestStatus(job({ archivedAt: "2026-09-30T00:00:00Z" }), today, horizon), null);
  assert.equal(scheduledRequestStatus(job({ state: "CANCELLED" }), today, horizon), null);
});

test("the email carries the link, and only the scheduler's is checked again as it goes", () => {
  const automated = billingAddressEmailJob({ tenantId: T, projectId: P, count: 1, now: "2026-10-01T07:00:00Z", automated: true });
  const studioPress = billingAddressEmailJob({ tenantId: T, projectId: P, count: 2, now: "2026-10-06T07:00:00Z", automated: false });
  assert.equal(automated.type, BILLING_ADDRESS_REQUEST_EMAIL);
  assert.equal(automated.clientOutreachGuard, true);
  assert.equal(studioPress.clientOutreachGuard, false, "the studio's own press goes, as any message they send");
  assert.notEqual(automated.id, studioPress.id, "each ask its own email");
  assert.match(automated.portalUrl, /\/client\?billing-address=1$/);
  const rendered = renderEmailTemplate({
    key: "billing_address_request",
    brand: { studioName: "GR Productions", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: "hello@example.com" } as never,
    values: { portalUrl: "https://studio-cue.com/client?billing-address=1" },
    recipientName: "Avery Lane",
    projectName: "Avery & Sam",
  } as never) as { subject: string; html: string; text: string };
  assert.match(rendered.subject, /billing address/i);
  assert.match(rendered.html, /client\?billing-address=1/);
  assert.match(rendered.text, /sales tax/);
});

test("the studio's Ask them: owner or admin, an email, and never for an address on file", async () => {
  const db = new FakeDb();
  studio(db);
  const context = { tenantId: T, role: "studio_owner", actorId: "uid_owner", now: "2026-10-01T12:00:00Z" };
  await assert.rejects(
    db.runTransaction((tx) => requestBillingAddressIn(db as never, tx as never, { ...context, role: "studio_staff" }, { projectId: P })),
    /BILLING_ADDRESS_REQUEST_PERMISSION_REQUIRED/,
  );
  const first = await db.runTransaction((tx) => requestBillingAddressIn(db as never, tx as never, context, { projectId: P }));
  assert.equal(first.requestCount, 1);
  const second = await db.runTransaction((tx) => requestBillingAddressIn(db as never, tx as never, context, { projectId: P }));
  assert.equal(second.requestCount, 2, "Ask again sends again");
  const request = db.store.get(`billingAddressRequests/${T}_${P}`)!;
  assert.equal(request.status, "requested");
  assert.equal(request.firstRequestedAt, "2026-10-01T12:00:00Z");
  const emails = [...db.store.keys()].filter((path) => path.startsWith("emailJobs/"));
  assert.equal(emails.length, 2);
  // A quiet booking still goes when the studio presses it; an archived one never.
  db.store.set(`projects/${P}`, { ...db.store.get(`projects/${P}`)!, clientAutomationsPausedAt: "2026-09-17T00:00:00Z" });
  await db.runTransaction((tx) => requestBillingAddressIn(db as never, tx as never, context, { projectId: P }));
  db.store.set(`projects/${P}`, { ...db.store.get(`projects/${P}`)!, archivedAt: "2026-10-01T00:00:00Z" });
  await assert.rejects(db.runTransaction((tx) => requestBillingAddressIn(db as never, tx as never, context, { projectId: P })), /PROJECT_ARCHIVED/);

  const filled = new FakeDb();
  studio(filled, { address: true });
  filled.store.set(`billingAddressRequests/${T}_${P}`, { tenantId: T, projectId: P, status: "requested" });
  await assert.rejects(filled.runTransaction((tx) => requestBillingAddressIn(filled as never, tx as never, context, { projectId: P })), /BILLING_ADDRESS_ON_FILE/);
});

// ---------- The couple answers ----------

test("the couple's address lands on their own contact, closes the request and reworks a held final", async () => {
  const db = new FakeDb();
  studio(db);
  db.store.set(`billingAddressRequests/${T}_${P}`, { tenantId: T, projectId: P, status: "requested" });
  db.store.set("invoiceReferences/final_1", {
    tenantId: T,
    projectId: P,
    kind: "final",
    status: "review_required",
    providerInvoiceId: "148",
    sendReview: { state: "awaiting_studio", billingAddressMissing: true, sendWithTaxBlocked: true, subtotalCents: 300000 },
  });
  const signer = { uid: "uid_avery", email: "Avery@Example.com", emailVerified: true, authMethod: "password" };
  const result = await confirmRequestedBillingAddress(db as never, {
    tenantId: T,
    projectId: P,
    address: ADDRESS as never,
    signer,
    evidence: { ipAddress: null, userAgent: "iPhone" },
    now: "2026-10-02T09:00:00Z",
  });
  assert.equal(result.saved, true);
  assert.deepEqual(result.recalculating, ["final_1"]);
  const contact = db.store.get("contacts/c1")!;
  assert.deepEqual(contact.billingAddress, ADDRESS);
  assert.equal(getPath(contact, "fieldProvenance.billingAddress.label"), "Confirmed by the couple");
  assert.equal(db.store.get(`billingAddressRequests/${T}_${P}`)!.status, "received");
  const invoice = db.store.get("invoiceReferences/final_1")!;
  const review = invoice.sendReview as Data;
  assert.equal(review.state, "recalculating");
  const job = db.store.get(`providerJobs/${(review.request as Data).jobId}`)!;
  assert.equal(job.type, "release_quickbooks_invoice");
  assert.equal(job.action, "recalculate", "the studio's own 'Work the tax out again', done for them");

  // Somebody signed in who isn't on the job's contacts: nothing to save to.
  const stranger = new FakeDb();
  studio(stranger);
  await assert.rejects(
    confirmRequestedBillingAddress(stranger as never, { tenantId: T, projectId: P, address: ADDRESS as never, signer: { ...signer, email: "someone@else.com" }, evidence: { ipAddress: null, userAgent: null } }),
    /BILLING_ADDRESS_CONTACT_NOT_FOUND/,
  );
});

test("given on request, it's still marked the couple's own", () => {
  assert.equal(coupleBillingAddressProvenance({ at: "x", via: "address_request", recordId: "r" }).label, "Confirmed by the couple");
  assert.equal(coupleBillingAddressProvenance({ at: "x", via: "contract_signing", recordId: "r" }).label, "Confirmed by the couple at signing");
});

// ---------- Today ----------

test("Today: a quiet job to ask, a couple to ask again — and nothing while the email is fresh", () => {
  const now = "2026-10-10T12:00:00.000Z";
  const projects = [
    { id: "quiet", name: "Quinn & Rivers", state: "BOOKED", eventDate: "2026-11-20" },
    { id: "asked", name: "Avery & Sam", state: "BOOKED", eventDate: "2026-11-21" },
    { id: "fresh", name: "Blake & Lane", state: "BOOKED", eventDate: "2026-11-22" },
    { id: "gone", name: "Rowan & Ellis", state: "BOOKED", eventDate: "2026-11-23", archivedAt: "2026-10-01" },
  ];
  const billingAddressRequests = [
    { id: "r1", projectId: "quiet", status: "needs_studio", reason: "quiet_job", requestCount: 0 },
    { id: "r2", projectId: "asked", status: "requested", requestCount: 1, lastRequestedAt: "2026-10-03T07:00:00Z" },
    { id: "r3", projectId: "fresh", status: "requested", requestCount: 1, lastRequestedAt: "2026-10-09T07:00:00Z" },
    { id: "r4", projectId: "gone", status: "needs_studio", requestCount: 0 },
    { id: "r5", projectId: "asked", status: "received" },
  ];
  const inbox = todayInbox({ now, projects, billingAddressRequests } as never) as unknown as { act: Array<{ id: string; title: string; action: { kind: string; label: string } }> };
  const cards = inbox.act.filter((item) => item.action.kind === "billing_address");
  // Not "fresh" (emailed yesterday), not "gone" (archived), not "received".
  assert.deepEqual(
    Object.fromEntries(cards.map((card) => [card.id, card.action.label])),
    { "billing-address-quiet": "Ask them", "billing-address-asked": "Ask again" },
  );
  assert.match(cards.find((card) => card.id === "billing-address-quiet")!.title, /Quinn & Rivers's billing address is missing/);
  assert.match(cards.find((card) => card.id === "billing-address-asked")!.title, /Still waiting on Avery & Sam's billing address/);
});

// ---------- Guards in source ----------

test("requests are read by the studio only, and written only server-side", () => {
  assert.match(read("firestore.rules"), /match \/billingAddressRequests\/\{requestId\} \{\s*allow read: if canManageProjects\(resource\.data\.tenantId\);\s*allow write: if false;/);
  assert.match(read("components/live/tenant-records.tsx"), /"billingAddressRequests"/);
  assert.match(read("functions/src/index.ts"), /billingAddressRequestScheduler/);
  assert.match(read("scripts/configure-production-function-invokers.sh"), /billingaddressrequestscheduler/, "a scheduler missing here 403s after the next invoker reset");
});
