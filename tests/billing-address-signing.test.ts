import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import {
  billingAddressRequirement,
  billingAddressStepFor,
  coupleConfirmed,
  formatBillingAddress,
  parseSigningBillingAddress,
  planSigningBillingAddress,
  sameBillingAddress,
  usStateCode,
} from "@/features/contacts/billing-address-signing";
import { billingAddressSchema } from "@/features/contacts/schema";
import { signingRefusalCopy } from "@/features/contracts/signing-policy";
import { currentEsignConsent } from "@/features/contracts/esign-consent";
import type { ContractDocument } from "@/features/contracts/document";
import { contractDocumentHash } from "@/server/contracts/document-hash";
import { signContract, SigningRefused } from "@/server/contracts/client-signing";
import { signCombinedAgreement } from "@/server/contracts/combined-signing";
import { signAmendment } from "@/server/contracts/amendment-signing";
import { signingBillingAddressStep } from "@/server/contracts/signing-billing-address";
import { sameBillingAddress as functionsSameBillingAddress } from "../functions/src/contacts/billing-address.ts";

/**
 * The couple's billing address, collected as they sign.
 *
 * QuickBooks taxes from the customer's address. A studio that has it charge
 * sales tax needs one before the retainer is raised; the signing sheet asks
 * for it once, just before the signature. These hold: what is asked follows
 * the studio's settings (never the page), it lands on the signer's own
 * contact only, a retried signature writes nothing twice, and the signed
 * document and its hash are exactly what they were.
 */

const read = (path: string) => readFileSync(path, "utf8");

// ---------- A small in-memory Firestore: enough for the three signing transactions ----------

type Data = Record<string, unknown>;

function getPath(data: Data | undefined, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (value, key) => (value && typeof value === "object" ? (value as Data)[key] : undefined),
    data,
  );
}

function setPath(data: Data, path: string, value: unknown) {
  const keys = path.split(".");
  let target = data;
  for (const key of keys.slice(0, -1)) {
    if (typeof target[key] !== "object" || target[key] === null) target[key] = {};
    target = target[key] as Data;
  }
  target[keys[keys.length - 1]!] = value;
}

class FakeDb {
  store = new Map<string, Data>();
  writes: string[] = [];

  doc(path: string) {
    return new FakeRef(this, path);
  }
  collection(name: string) {
    return new FakeQuery(this, name, [], null, null);
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
  constructor(
    readonly db: FakeDb,
    readonly path: string,
  ) {}
  get id() {
    return this.path.split("/").pop()!;
  }
  async get() {
    return this.db.snapshot(this.path);
  }
}

class FakeQuery {
  constructor(
    readonly db: FakeDb,
    readonly name: string,
    readonly filters: Array<[string, unknown]>,
    readonly order: [string, "asc" | "desc"] | null,
    readonly max: number | null,
  ) {}
  where(field: string, op: string, value: unknown) {
    assert.equal(op, "==");
    return new FakeQuery(this.db, this.name, [...this.filters, [field, value]], this.order, this.max);
  }
  orderBy(field: string, direction: "asc" | "desc" = "asc") {
    return new FakeQuery(this.db, this.name, this.filters, [field, direction], this.max);
  }
  limit(count: number) {
    return new FakeQuery(this.db, this.name, this.filters, this.order, count);
  }
  run() {
    let docs = [...this.db.store.keys()]
      .filter((path) => path.startsWith(`${this.name}/`) && path.split("/").length === 2)
      .map((path) => this.db.snapshot(path))
      .filter((snapshot) => this.filters.every(([field, value]) => snapshot.get(field) === value));
    if (this.order) {
      const [field, direction] = this.order;
      docs.sort((a, b) => {
        const left = Number(a.get(field));
        const right = Number(b.get(field));
        return direction === "desc" ? right - left : left - right;
      });
    }
    if (this.max !== null) docs = docs.slice(0, this.max);
    return { docs, empty: docs.length === 0 };
  }
}

class FakeTransaction {
  pending: Array<() => void> = [];
  constructor(readonly db: FakeDb) {}
  async get(target: FakeRef | FakeQuery) {
    // Firestore's own rule: every read before any write.
    assert.equal(this.pending.length, 0, "a read after a write in the transaction");
    return target instanceof FakeQuery ? target.run() : this.db.snapshot(target.path);
  }
  create(ref: FakeRef, data: Data) {
    this.pending.push(() => {
      assert.ok(!this.db.store.has(ref.path), `create of existing ${ref.path}`);
      this.db.store.set(ref.path, structuredClone(data));
      this.db.writes.push(`create ${ref.path}`);
    });
  }
  set(ref: FakeRef, data: Data) {
    this.pending.push(() => {
      this.db.store.set(ref.path, structuredClone(data));
      this.db.writes.push(`set ${ref.path}`);
    });
  }
  update(ref: FakeRef, changes: Data) {
    this.pending.push(() => {
      const current = this.db.store.get(ref.path);
      assert.ok(current, `update of missing ${ref.path}`);
      for (const [key, value] of Object.entries(changes)) setPath(current, key, structuredClone(value));
      this.db.writes.push(`update ${ref.path}`);
    });
  }
}

// ---------- The studio, the job, the couple ----------

const T = "tenant_a";
const P = "project_1";
const COUPLE_EMAIL = "avery@example.com";
const SIGNER = { uid: "uid_avery", email: COUPLE_EMAIL, emailVerified: true, authMethod: "password" };
const EVIDENCE = { ipAddress: "203.0.113.9", userAgent: "iPhone" };
const ADDRESS = {
  line1: "12 Main Street",
  line2: null,
  city: "Madison",
  region: "New Jersey",
  postalCode: "07940",
  country: "US",
};

const document: ContractDocument = {
  format: 1,
  title: "Photography agreement",
  blocks: [
    { type: "heading", level: 1, content: [{ text: "Terms" }] },
    { type: "paragraph", content: [{ text: "We photograph your wedding." }] },
    { type: "heading", level: 1, content: [{ text: "Coverage" }] },
    { type: "paragraph", content: [{ text: "Eight hours, two photographers." }] },
  ],
};
const HASH = contractDocumentHash(document);

function world(options: {
  salesTax?: "quickbooks" | "none" | null;
  quickBooks?: boolean;
  exempt?: boolean;
  onFile?: Data | null;
  projectState?: string;
  combined?: boolean;
}) {
  const db = new FakeDb();
  const put = (path: string, data: Data) => db.store.set(path, structuredClone(data));
  if (options.salesTax) put(`billingSettings/${T}`, { tenantId: T, salesTax: { mode: options.salesTax } });
  if (options.quickBooks !== false)
    put(`integrationConnections/${T}_quickbooks`, { tenantId: T, provider: "quickbooks", status: "connected" });
  put(`projects/${P}`, {
    tenantId: T,
    state: options.projectState ?? "CONTRACT_PENDING",
    stateVersion: 3,
    clientContactIds: ["contact_partner", "contact_avery"],
    ...(options.exempt ? { salesTaxExempt: true } : {}),
    packageSnapshotId: "snap_1",
  });
  put(`memberships/${T}_${SIGNER.uid}`, { tenantId: T, userId: SIGNER.uid, role: "client", status: "active" });
  // The partner on the same job, and someone with the couple's email in
  // another studio: neither is the signer's own contact here.
  put("contacts/contact_partner", {
    tenantId: T,
    email: "sam@example.com",
    normalizedEmail: "sam@example.com",
    billingAddress: null,
  });
  put("contacts/contact_avery", {
    tenantId: T,
    email: "Avery@Example.com",
    normalizedEmail: COUPLE_EMAIL,
    billingAddress: options.onFile ?? null,
  });
  put("contacts/contact_other_studio", {
    tenantId: "tenant_b",
    email: COUPLE_EMAIL,
    normalizedEmail: COUPLE_EMAIL,
    billingAddress: null,
  });
  put("contracts/contract_1", {
    tenantId: T,
    projectId: P,
    provider: "studiocue",
    status: "sent",
    document,
    documentHash: HASH,
    proposalId: "proposal_1",
    signers: [
      { role: "studio", email: "studio@example.com", status: "completed" },
      { role: "primary_client", email: COUPLE_EMAIL, status: "sent" },
    ],
    signatures: [{ id: "contract_1_studio", role: "studio", typedName: "Studio", signedAt: "2026-09-30T00:00:00Z" }],
    ...(options.combined
      ? {
          mode: "combined",
          sections: [
            { key: "terms", title: "Terms", start: 0, end: 2 },
            { key: "coverage", title: "Coverage", start: 2, end: 4 },
          ].map((section) => ({
            ...section,
            hash: contractDocumentHash({ format: 1, title: section.title, blocks: document.blocks.slice(section.start, section.end) }),
          })),
        }
      : {}),
  });
  if (options.combined)
    put("proposals/proposal_1", {
      tenantId: T,
      projectId: P,
      version: 1,
      status: "sent",
      expiresAt: "2099-01-01T00:00:00Z",
      packageSnapshotId: "snap_1",
    });
  put("bookingAmendments/amend_1", {
    tenantId: T,
    projectId: P,
    signingMode: "studiocue",
    status: "sent",
    clientEmail: COUPLE_EMAIL,
    document,
    documentHash: HASH,
  });
  return db;
}

const asDb = (db: FakeDb) => db as unknown as Firestore;

function sign(db: FakeDb, extra: { billingAddress?: unknown; idempotencyKey?: string } = {}) {
  return signContract(asDb(db), {
    tenantId: T,
    projectId: P,
    contractId: "contract_1",
    documentHash: HASH,
    typedName: "Avery Stone",
    consent: true,
    consentVersion: currentEsignConsent.id,
    idempotencyKey: extra.idempotencyKey ?? "key-00000001",
    signer: SIGNER,
    evidence: EVIDENCE,
    studioAddress: null,
    appUrl: "https://studio-cue.test",
    billingAddress: extra.billingAddress,
  });
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof SigningRefused) return caught.refusal;
    throw caught;
  }
  return "SIGNED";
}

const contact = (db: FakeDb, id: string) => db.store.get(`contacts/${id}`)!;

// ---------- Validation ----------

test("a US address needs a street, city, real state and 5-digit ZIP; the rest is tidied", () => {
  const ok = parseSigningBillingAddress({ ...ADDRESS, line1: "  12   Main Street ", postalCode: "079401234" });
  assert.ok(ok.ok);
  assert.equal(ok.address.line1, "12 Main Street");
  assert.equal(ok.address.region, "NJ", "a state written out becomes its code");
  assert.equal(ok.address.postalCode, "07940-1234");
  // Whatever passes here is a valid stored address.
  assert.ok(billingAddressSchema.safeParse(ok.address).success);

  assert.deepEqual(parseSigningBillingAddress({ ...ADDRESS, line1: " " }), { ok: false, problem: "line1" });
  assert.deepEqual(parseSigningBillingAddress({ ...ADDRESS, city: "" }), { ok: false, problem: "city" });
  assert.deepEqual(parseSigningBillingAddress({ ...ADDRESS, region: "Narnia" }), { ok: false, problem: "region" });
  assert.deepEqual(parseSigningBillingAddress({ ...ADDRESS, region: null }), { ok: false, problem: "region" });
  assert.deepEqual(parseSigningBillingAddress({ ...ADDRESS, postalCode: "7940" }), { ok: false, problem: "postalCode" });
  assert.deepEqual(parseSigningBillingAddress({ ...ADDRESS, country: "U" }), { ok: false, problem: "country" });
  assert.equal(usStateCode("n.j."), "NJ");
  assert.equal(usStateCode("District of Columbia"), "DC");
});

test("country defaults to US, and outside the US state and postcode are the couple's own words", () => {
  const defaulted = parseSigningBillingAddress({ ...ADDRESS, country: undefined });
  assert.ok(defaulted.ok && defaulted.address.country === "US");
  const abroad = parseSigningBillingAddress({ line1: "1 Rue de Rivoli", city: "Paris", country: "fr", region: null, postalCode: "75001" });
  assert.ok(abroad.ok);
  assert.equal(abroad.address.country, "FR");
  assert.equal(abroad.address.region, null);
  assert.equal(formatBillingAddress(abroad.address), "1 Rue de Rivoli, Paris, 75001, FR");
  assert.equal(formatBillingAddress({ ...ADDRESS, region: "NJ" }), "12 Main Street, Madison, NJ 07940");
});

// ---------- Required / optional / hidden ----------

test("what is asked comes from the studio's settings, and a missing billingSettings reads as none", () => {
  const rule = (salesTaxMode: unknown, quickBooksConnected: boolean, salesTaxExempt?: unknown) =>
    billingAddressRequirement({ salesTaxMode, quickBooksConnected, salesTaxExempt });
  assert.equal(rule("quickbooks", true), "required");
  assert.equal(rule("quickbooks", true, true), "optional", "an exempt job never blocks on it");
  assert.equal(rule("none", true), "optional", "QuickBooks connected, no tax: offered, not demanded");
  assert.equal(rule(undefined, true), "optional", "no billingSettings doc is mode none");
  assert.equal(rule("quickbooks", false), "hidden", "nothing would use it");
  assert.equal(rule(undefined, false), "hidden");
});

test("a booking change asks only when nothing is on file", () => {
  assert.equal(billingAddressStepFor({ requirement: "required", onFile: ADDRESS, kind: "amendment" }), "hidden");
  assert.equal(billingAddressStepFor({ requirement: "required", onFile: null, kind: "amendment" }), "required");
  assert.equal(billingAddressStepFor({ requirement: "optional", onFile: null, kind: "amendment" }), "optional");
  // A first signature confirms even an address already on file.
  assert.equal(billingAddressStepFor({ requirement: "required", onFile: ADDRESS, kind: "contract" }), "required");
});

test("required refuses without an address or with a bad one; optional and hidden never refuse", () => {
  assert.deepEqual(planSigningBillingAddress({ step: "required", submitted: null }), { refusal: "BILLING_ADDRESS_REQUIRED" });
  assert.deepEqual(planSigningBillingAddress({ step: "required", submitted: undefined }), { refusal: "BILLING_ADDRESS_REQUIRED" });
  assert.deepEqual(planSigningBillingAddress({ step: "required", submitted: { ...ADDRESS, postalCode: "1" } }), {
    refusal: "BILLING_ADDRESS_INVALID",
  });
  assert.deepEqual(planSigningBillingAddress({ step: "optional", submitted: null }), { save: null });
  assert.deepEqual(planSigningBillingAddress({ step: "hidden", submitted: ADDRESS }), { save: null });
  for (const code of ["BILLING_ADDRESS_REQUIRED", "BILLING_ADDRESS_INVALID"] as const) {
    assert.ok(signingRefusalCopy[code].length > 10);
    assert.doesNotMatch(signingRefusalCopy[code], /[A-Z]{4,}_/);
  }
});

// ---------- The contract signature ----------

test("required: no signature without the address, and nothing is written when refused", async () => {
  const db = world({ salesTax: "quickbooks" });
  assert.equal(await refusal(sign(db)), "BILLING_ADDRESS_REQUIRED");
  assert.equal(await refusal(sign(db, { billingAddress: { ...ADDRESS, region: "XX" } })), "BILLING_ADDRESS_INVALID");
  assert.deepEqual(db.writes, []);
  assert.equal(db.store.get("contracts/contract_1")!.status, "sent");
});

test("required: the address lands on the signer's own contact, marked as the couple's — and nowhere else", async () => {
  const db = world({ salesTax: "quickbooks" });
  const result = await sign(db, { billingAddress: ADDRESS });
  assert.equal(result.status, "completed");
  const own = contact(db, "contact_avery");
  assert.deepEqual(own.billingAddress, { ...ADDRESS, region: "NJ" });
  const provenance = (own.fieldProvenance as Data).billingAddress as Data;
  assert.equal(provenance.source, "couple");
  assert.equal(provenance.via, "contract_signing");
  assert.equal(provenance.recordId, "contract_1");
  assert.ok(coupleConfirmed(own));
  // The partner on the job and the same email at another studio: untouched.
  assert.equal(contact(db, "contact_partner").billingAddress, null);
  assert.equal(contact(db, "contact_other_studio").billingAddress, null);
  assert.equal(contact(db, "contact_partner").fieldProvenance, undefined);
  const audit = [...db.store.entries()].find(([, value]) => value.action === "contact.billing_address_confirmed_by_client");
  assert.ok(audit, "the address has its own audit event");
  assert.equal(audit![1].entityId, "contact_avery");
});

test("the signed document, its hash and the signature evidence are unchanged by the address", async () => {
  const db = world({ salesTax: "quickbooks" });
  await sign(db, { billingAddress: ADDRESS });
  const contract = db.store.get("contracts/contract_1")!;
  assert.equal(contract.documentHash, HASH);
  assert.equal(contractDocumentHash(contract.document as ContractDocument), HASH);
  const signature = db.store.get("contractSignatures/contract_1_client")!;
  assert.equal(signature.documentHash, HASH);
  const evidence = JSON.stringify([signature, contract.completionEvidence, contract.signatures]);
  assert.doesNotMatch(evidence, /Main Street|07940|billing/i, "the address is not part of what was signed");
  // And the hash function's inputs are the document alone.
  assert.doesNotMatch(read("server/contracts/document-hash.ts"), /billing|address/i);
});

test("a retried signature writes the address once: same key replays, a new key is already signed", async () => {
  const db = world({ salesTax: "quickbooks" });
  const first = await sign(db, { billingAddress: ADDRESS });
  const writes = db.writes.length;
  const updatedAt = contact(db, "contact_avery").updatedAt;
  assert.deepEqual(await sign(db, { billingAddress: ADDRESS }), first);
  assert.equal(db.writes.length, writes, "the replay wrote nothing");
  const again = await sign(db, { billingAddress: { ...ADDRESS, line1: "99 Other Road" }, idempotencyKey: "key-00000002" });
  assert.equal((again as { alreadySigned: boolean }).alreadySigned, true);
  assert.equal(db.writes.length, writes);
  assert.equal(contact(db, "contact_avery").updatedAt, updatedAt);
  assert.equal((contact(db, "contact_avery").billingAddress as Data).line1, "12 Main Street");
});

test("confirming the address already on file marks it as the couple's", async () => {
  const onFile = { ...ADDRESS, region: "NJ" };
  const db = world({ salesTax: "quickbooks", onFile });
  const step = await signingBillingAddressStep(asDb(db), { tenantId: T, projectId: P, signerEmail: COUPLE_EMAIL, kind: "contract" });
  // On file, so nothing from the forms is offered (billing-address-from-forms.test.ts).
  assert.deepEqual(step, { step: "required", onFile, suggested: null });
  await sign(db, { billingAddress: step.onFile });
  assert.deepEqual(contact(db, "contact_avery").billingAddress, onFile);
  assert.ok(coupleConfirmed(contact(db, "contact_avery")));
});

test("the sheet is only ever shown the signer's own address", async () => {
  const db = world({ salesTax: "quickbooks", onFile: { ...ADDRESS, region: "NJ" } });
  db.store.get("contacts/contact_partner")!.billingAddress = { ...ADDRESS, line1: "1 Partner Lane", region: "NY" };
  const partner = await signingBillingAddressStep(asDb(db), {
    tenantId: T,
    projectId: P,
    signerEmail: "stranger@example.com",
    kind: "contract",
  });
  assert.equal(partner.onFile, null, "an email that is no contact on the job sees no one's address");
  assert.equal(partner.suggested, null, "…nor one offered from the job's forms");
  const own = await signingBillingAddressStep(asDb(db), { tenantId: T, projectId: P, signerEmail: COUPLE_EMAIL, kind: "contract" });
  assert.equal(own.onFile?.line1, "12 Main Street");
});

test("optional: signing without an address saves nothing; with one, it is saved", async () => {
  const db = world({ salesTax: "none" });
  assert.equal((await sign(db)).status, "completed");
  assert.equal(contact(db, "contact_avery").billingAddress, null);
  assert.equal(contact(db, "contact_avery").fieldProvenance, undefined);

  const withOne = world({ salesTax: null });
  await sign(withOne, { billingAddress: ADDRESS });
  assert.equal((contact(withOne, "contact_avery").billingAddress as Data).city, "Madison");
});

test("an exempt job and a studio without QuickBooks never block a signature", async () => {
  assert.equal((await sign(world({ salesTax: "quickbooks", exempt: true }))).status, "completed");
  const noQuickBooks = world({ salesTax: "quickbooks", quickBooks: false });
  assert.equal((await sign(noQuickBooks, { billingAddress: ADDRESS })).status, "completed");
  assert.equal(contact(noQuickBooks, "contact_avery").billingAddress, null, "hidden: whatever arrived is ignored");
});

// ---------- The booking agreement (proposal + agreement in one) ----------

function signCombined(db: FakeDb, billingAddress?: unknown) {
  return signCombinedAgreement(asDb(db), {
    tenantId: T,
    projectId: P,
    contractId: "contract_1",
    documentHash: HASH,
    typedNameTerms: "Avery Stone",
    typedNameCoverage: "Avery Stone",
    consent: true,
    consentVersion: currentEsignConsent.id,
    idempotencyKey: "key-combined-1",
    signer: SIGNER,
    evidence: EVIDENCE,
    studioAddress: null,
    appUrl: "https://studio-cue.test",
    billingAddress,
  });
}

test("the booking agreement asks the same, in the same transaction", async () => {
  const db = world({ salesTax: "quickbooks", combined: true, projectState: "PROPOSAL" });
  assert.equal(await refusal(signCombined(db)), "BILLING_ADDRESS_REQUIRED");
  assert.deepEqual(db.writes, []);
  const result = await signCombined(db, ADDRESS);
  assert.equal(result.status, "completed");
  assert.equal((contact(db, "contact_avery").billingAddress as Data).region, "NJ");
  assert.equal(db.store.get("contracts/contract_1")!.documentHash, HASH);
});

// ---------- A booking change ----------

function signChange(db: FakeDb, billingAddress?: unknown) {
  return signAmendment(asDb(db), {
    tenantId: T,
    projectId: P,
    amendmentId: "amend_1",
    documentHash: HASH,
    typedName: "Avery Stone",
    consent: true,
    consentVersion: currentEsignConsent.id,
    idempotencyKey: "key-amend-1",
    signer: SIGNER,
    evidence: EVIDENCE,
    billingAddress,
  });
}

test("a booking change asks only when none is on file", async () => {
  const onFile = world({ salesTax: "quickbooks", onFile: { ...ADDRESS, region: "NJ" }, projectState: "BOOKED" });
  assert.equal((await signChange(onFile)).status, "signed", "on file: not asked again");
  assert.equal(
    (await signingBillingAddressStep(asDb(onFile), { tenantId: T, projectId: P, signerEmail: COUPLE_EMAIL, kind: "amendment" })).step,
    "hidden",
  );

  const missing = world({ salesTax: "quickbooks", projectState: "BOOKED" });
  assert.equal(await refusal(signChange(missing)), "BILLING_ADDRESS_REQUIRED");
  assert.equal((await signChange(missing, ADDRESS)).status, "signed");
  const provenance = (contact(missing, "contact_avery").fieldProvenance as Data).billingAddress as Data;
  assert.equal(provenance.via, "amendment_signing");
  assert.equal(provenance.recordId, "amend_1");
});

// ---------- The wiring ----------

test("the portal passes the address to every signing path and takes no contact id from the page", () => {
  const route = read("app/api/client/portal/route.ts");
  // Three signing paths, and the card that asks for it when the studio needs it
  // (server/billing/billing-address-request.ts) — which takes no contact id either.
  assert.equal(route.match(/billingAddress: signingBillingAddressSchema/g)?.length, 4);
  const asked = route.slice(route.indexOf('z.literal("confirm_billing_address")'), route.indexOf('z.literal("billing_address_step")'));
  assert.doesNotMatch(asked, /contactId/);
  assert.equal(route.match(/billingAddress: parsed\.billingAddress/g)?.length, 3);
  const step = route.slice(route.indexOf('z.literal("billing_address_step")'), route.indexOf('z.literal("booking_change")'));
  assert.doesNotMatch(step, /contactId/);
  assert.match(route, /signerEmail: typeof identity\.email === "string"/);
  // Both signing sheets carry the step, just before the signature.
  for (const path of ["components/client/contract-signing.tsx", "components/client/kit/client-booking-change.tsx"]) {
    const sheet = read(path);
    assert.match(sheet, /<BillingAddressStep billing=\{billing\} \/>/, path);
    assert.ok(sheet.indexOf("<BillingAddressStep") < sheet.indexOf("Type your full name to sign"), path);
  }
});

test("a studio edit takes the couple's mark off a changed address, and only a changed one", () => {
  const stored = { ...ADDRESS, region: "NJ" };
  for (const same of [sameBillingAddress, functionsSameBillingAddress]) {
    assert.equal(same(stored, { ...stored }), true);
    assert.equal(same(stored, { ...stored, line2: "" }), true, "blank and missing are the same");
    assert.equal(same(stored, { ...stored, line1: "13 Main Street" }), false);
    assert.equal(same(null, stored), false);
  }
  const crm = read("functions/src/crm/commands.ts");
  assert.match(crm, /!sameBillingAddress\(before\.billingAddress, command\.input\.billingAddress\)/);
  assert.match(crm, /"fieldProvenance\.billingAddress": command\.input\.billingAddress\s*\?\s*\{ source: "studio"/);
});

test("the studio sees where the address came from", () => {
  const summary = read("components/clients/billing-address-summary.tsx");
  assert.match(summary, /Billing address · confirmed by the client at signing/);
  assert.match(read("components/booking/project-booking-workspace.tsx"), /<BillingAddressSummary/);
  assert.match(read("components/live/tenant-records.tsx"), /confirmed by the couple at signing/);
});

test("QuickBooks gets the address: on a new customer, and filled into an existing one's blank", () => {
  const runtime = read("functions/src/operations/provider-runtime.ts");
  assert.match(runtime, /billingAddress:text\(address\.line1\)&&text\(address\.city\)/);
  assert.match(runtime, /fillQuickBooksCustomerBlanks\(base,realmId,credential,known,details,idempotencyKey\)/);
  assert.match(runtime, /fillQuickBooksCustomerBlanks\(base,realmId,credential,stored,details,idempotencyKey\)/);
});
