/**
 * Billing-address request walk: the scheduler, the email, the studio's "Ask
 * them", the couple's answer and the held final reworked — StudioCue's own
 * code, in-process against the Firestore emulator. Nothing between the steps
 * is written by hand.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx scripts/uat/billing-address-request-walk.mts
 *
 * Email is the sender's mock mode: the rendered message lands in `messages`.
 */
import { createRequire } from "node:module";

const REPO = process.cwd();
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Refusing to run without FIRESTORE_EMULATOR_HOST (the emulator).");
const projectId = process.env.GCLOUD_PROJECT ?? "studiohub-dev";
if (/prod/i.test(projectId)) throw new Error(`Refusing to run against project "${projectId}".`);
process.env.EMAIL_DELIVERY_MODE = "mock";

const functionsRequire = createRequire(`${REPO}/functions/package.json`);
const { initializeApp } = functionsRequire("firebase-admin/app");
const { getFirestore } = functionsRequire("firebase-admin/firestore");
initializeApp({ projectId });
const db = getFirestore();

const { billingAddressRequestScheduler, requestBillingAddressIn } = await import(`${REPO}/functions/src/billing/billing-address-request.ts`);
const { processJobDocument } = await import(`${REPO}/functions/src/operations/jobs.ts`);
const { confirmRequestedBillingAddress } = await import(`${REPO}/server/billing/billing-address-request.ts`);

const results: Array<{ step: string; ok: boolean }> = [];
const record = (step: string, ok: boolean, detail: string) => {
  results.push({ step, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step} — ${detail}`);
};

const run = Date.now().toString(36);
const T = `addr-walk-${run}`;
const now = new Date().toISOString();
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const setup = db.batch();
setup.set(db.doc(`tenants/${T}`), { id: T, tenantId: T, businessName: "Walk Studio", brandName: "Walk Studio", currency: "USD", timezone: "America/New_York", status: "active" });
setup.set(db.doc(`billingSettings/${T}`), { tenantId: T, salesTax: { mode: "quickbooks", estimateRateBasisPoints: 825 } });
setup.set(db.doc(`integrationConnections/${T}_quickbooks`), { tenantId: T, provider: "quickbooks", status: "connected", mockMode: true });
setup.set(db.doc(`tenantFeatures/${T}`), { tenantId: T, quickbooksItemisedInvoices: true });
const job = (id: string, name: string, eventDate: string, extra: Record<string, unknown> = {}) => {
  setup.set(db.doc(`projects/${id}`), { id, tenantId: T, projectId: id, name, state: "BOOKED", eventDate, timezone: "America/New_York", clientContactIds: [`${id}-c`], archivedAt: null, ...extra });
  setup.set(db.doc(`contacts/${id}-c`), { id: `${id}-c`, tenantId: T, firstName: name.split(" ")[0], lastName: "Walk", displayName: name, email: `${id}@studiohub.test`, normalizedEmail: `${id}@studiohub.test`, projectIds: [id], archivedAt: null });
};
const A = `${T}-asked`, B = `${T}-quiet`, C = `${T}-later`, D = `${T}-has`;
job(A, "Avery & Sam", inDays(40));
job(B, "Quinn & Rivers", inDays(40), { importedAt: now, clientAutomationsPausedAt: now });
job(C, "Blake & Lane", inDays(90));
job(D, "Rowan & Ellis", inDays(40));
setup.set(db.doc(`contacts/${D}-c`), { billingAddress: { line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" } }, { merge: true });
// Avery & Sam's final, already held because QuickBooks had no address.
setup.set(db.doc(`invoiceReferences/${A}-final`), {
  id: `${A}-final`, tenantId: T, projectId: A, kind: "final", provider: "quickbooks", status: "review_required", providerInvoiceId: "mock_qbo_final",
  amountCents: 300000, balanceCents: 300000, currency: "USD",
  sendReview: { state: "awaiting_studio", reason: "final_tax", strategy: "automated", taxStrategy: { kind: "automated" }, subtotalCents: 300000, taxCents: 0, totalCents: 300000, billingAddressMissing: true, sendWithTaxBlocked: true, note: "Add the couple's billing address so QuickBooks can work out the tax.", heldAt: now },
  providerLines: { expectedSubtotalCents: 300000 },
});
await setup.commit();

const request = async (id: string) => (await db.doc(`billingAddressRequests/${T}_${id}`).get()).data() ?? null;
const emailsFor = async (id: string) => (await db.collection("emailJobs").where("tenantId", "==", T).where("projectId", "==", id).get()).docs;

// --- 1. the scheduler ------------------------------------------------------------
await billingAddressRequestScheduler.run({} as never);
const a = await request(A), b = await request(B), c = await request(C), d = await request(D);
const aEmails = await emailsFor(A);
record("1 a booked job with no address is emailed", a?.status === "requested" && aEmails.length === 1 && aEmails[0]!.get("clientOutreachGuard") === true, `${a?.status}, ${aEmails.length} email, guard ${aEmails[0]?.get("clientOutreachGuard")}`);
record("1 a quiet (imported) job is left to the studio", b?.status === "needs_studio" && (await emailsFor(B)).length === 0, `${b?.status}, reason ${b?.reason}, ${(await emailsFor(B)).length} emails`);
record("1 not yet, and not when an address is on file", c === null && d === null, `later: ${c?.status ?? "none"}, has address: ${d?.status ?? "none"}`);

// --- 2. the email, through the real sender ----------------------------------------
await processJobDocument("emailJobs", aEmails[0]!.id);
const sentA = (await db.collection("messages").where("tenantId", "==", T).where("projectId", "==", A).get()).docs.map((doc: { data(): Record<string, unknown> }) => doc.data());
const body = String(sentA[0]?.body ?? sentA[0]?.bodyText ?? sentA[0]?.text ?? "");
record("2 the couple's email has the link", sentA.length === 1 && /billing-address=1/.test(JSON.stringify(sentA[0])), `"${sentA[0]?.subject}" → ${sentA[0]?.to ?? sentA[0]?.recipient}; ${body.slice(0, 90).replace(/\s+/g, " ")}…`);

// --- 3. the studio asks the quiet couple itself ------------------------------------
await db.runTransaction((transaction: unknown) =>
  requestBillingAddressIn(db, transaction as never, { tenantId: T, role: "studio_owner", actorId: "walk-owner", now: new Date().toISOString() }, { projectId: B }),
);
const bEmails = await emailsFor(B);
await processJobDocument("emailJobs", bEmails[0]!.id);
const bJob = (await bEmails[0]!.ref.get()).data() ?? {};
record("3 Ask them goes, quiet or not — it's the studio's own press", (await request(B))?.status === "requested" && bJob.status !== "queued" && !String(bJob.status).includes("held"), `request ${(await request(B))?.status}; email ${bJob.status}${bJob.lastError ? ` (${bJob.lastError})` : ""}`);

// --- 4. the couple answers on their portal -----------------------------------------
const answer = await confirmRequestedBillingAddress(db as never, {
  tenantId: T,
  projectId: A,
  address: { line1: "2600 Marine Way", line2: null, city: "Mountain View", region: "CA", postalCode: "94043", country: "US" },
  signer: { uid: "walk-couple", email: `${A}@studiohub.test`, emailVerified: true, authMethod: "password" },
  evidence: { ipAddress: null, userAgent: "walk" },
});
const contact = (await db.doc(`contacts/${A}-c`).get()).data() ?? {};
record("4 saved to their own contact, marked theirs", contact.billingAddress?.city === "Mountain View" && contact.fieldProvenance?.billingAddress?.source === "couple", `${contact.fieldProvenance?.billingAddress?.label}; request ${(await request(A))?.status}`);
const jobs = (await db.collection("providerJobs").where("tenantId", "==", T).where("status", "==", "queued").get()).docs;
for (const queued of jobs) await processJobDocument("providerJobs", queued.id);
const final = (await db.doc(`invoiceReferences/${A}-final`).get()).data() ?? {};
record(
  "4 the held final's tax is worked out again, nobody pressing anything",
  answer.recalculating.length === 1 && final.sendReview?.state === "awaiting_studio" && final.sendReview?.billingAddressMissing === false && final.sendReview?.sendWithTaxBlocked === false,
  `${jobs.map((queued: { get(field: string): unknown }) => queued.get("type")).join(", ")} → ${final.sendReview?.state}, address missing ${final.sendReview?.billingAddressMissing}, send with tax blocked ${final.sendReview?.sendWithTaxBlocked}`,
);

// --- 5. the scheduler again: nobody asked twice ------------------------------------
await billingAddressRequestScheduler.run({} as never);
record("5 next morning: no second email", (await emailsFor(A)).length === 1 && (await emailsFor(B)).length === 1, `Avery & Sam ${(await emailsFor(A)).length} email, Quinn & Rivers ${(await emailsFor(B)).length}`);

const failed = results.filter((result) => !result.ok).length;
console.log(`TALLY ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
