/**
 * QuickBooks sandbox walk: StudioCue's QuickBooks code against Intuit's
 * sandbox, with the emulator holding StudioCue's side.
 *
 *   QUICKBOOKS_SANDBOX_CLIENT_ID       the sandbox app's client id (Intuit Developer → Keys)
 *   QUICKBOOKS_SANDBOX_CLIENT_SECRET   its client secret
 *   QUICKBOOKS_SANDBOX_REALM_ID        the sandbox company id
 *   QUICKBOOKS_SANDBOX_REFRESH_TOKEN   a refresh token for that company (OAuth Playground)
 *   QUICKBOOKS_API_BASE_URL            must be https://sandbox-quickbooks.api.intuit.com
 *   FIRESTORE_EMULATOR_HOST            the emulator; nothing runs without it
 *   SANDBOX_TENANT_ID                  optional; the emulator tenant to write settings to
 *   QUICKBOOKS_SANDBOX_TOKEN_FILE      optional; where a rotated refresh token is written
 *                                      (default /tmp/studiocue-qbo-sandbox-refresh-token)
 *
 * Never committed: every value comes from the environment. Refuses any
 * production project id and any base URL that isn't Intuit's sandbox.
 *
 *   npx tsx scripts/uat/quickbooks-sandbox-walk.mts
 *
 * Steps 1–4 are the Settings → QuickBooks screen. Steps 5–11 are StudioCue's
 * own chain, run in-process against the emulator: the contract trigger
 * raises the retainer, the provider worker makes it in QuickBooks, Payment /
 * CreditMemo / RefundReceipt webhooks (Intuit's classic shape, signed with a
 * local verifier) move money back, and the held final goes out through the
 * studio's "Send without tax". Nothing between those steps is written by hand.
 * Intuit's default sandbox (Sandbox Company_US_1) uses older manual tax; an
 * Automated Sales Tax company exercises the by-address path instead.
 *
 * Walked 2026-10-01 against Sandbox Company_US_1. It found "Send without tax"
 * refused on manual-tax companies (fixed: quickBooksUntaxChanges), the test
 * invoice failing them, and — on GR's real company — no pay link on any
 * StudioCue invoice (fixed: quickBooksBillEmail).
 */
import { createRequire } from "node:module";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const SANDBOX = "https://sandbox-quickbooks.api.intuit.com";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

// --- guards ------------------------------------------------------------------
const env = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required (see the header of this script).`);
  return value;
};
const projectId =
  process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "studiohub-dev";
if (/prod/i.test(projectId)) throw new Error(`Refusing to run against project "${projectId}".`);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Refusing to run without FIRESTORE_EMULATOR_HOST (the emulator).");
const apiBase = env("QUICKBOOKS_API_BASE_URL").replace(/\/$/, "");
if (apiBase !== SANDBOX) throw new Error(`Refusing: QUICKBOOKS_API_BASE_URL must be ${SANDBOX}, not ${apiBase}.`);
const clientId = env("QUICKBOOKS_SANDBOX_CLIENT_ID");
const clientSecret = env("QUICKBOOKS_SANDBOX_CLIENT_SECRET");
const realmId = env("QUICKBOOKS_SANDBOX_REALM_ID");
const refreshToken = env("QUICKBOOKS_SANDBOX_REFRESH_TOKEN");
const tenantId = process.env.SANDBOX_TENANT_ID?.trim() || "qbo-sandbox-walk";
const runKey = `walk_${Date.now().toString(36)}`;

// StudioCue's own code, the same modules the Functions run.
const { quickBooksCompany, ensureStudioCueItems } = await import(`${REPO}/functions/src/integrations/quickbooks-items.ts`);
const { runQuickBooksTestInvoice, readQuickBooksCompany } = await import(`${REPO}/functions/src/integrations/quickbooks-test-invoice.ts`);
const { quickBooksCompanyStatus } = await import(`${REPO}/functions/src/integrations/quickbooks-setup-core.ts`);
const { normaliseBillingSettings } = await import(`${REPO}/functions/src/billing/sales-tax-settings.ts`);

const results: Array<{ step: string; ok: boolean | null; detail: string }> = [];
const record = (step: string, ok: boolean | null, detail: string) => {
  results.push({ step, ok, detail });
  console.log(`${ok === true ? "PASS" : ok === false ? "FAIL" : "TODO"}  ${step} — ${detail}`);
};

// --- 1. connect: the stored refresh token, exchanged for an access token ------
const tokenResponse = await fetch(TOKEN_URL, {
  method: "POST",
  headers: {
    authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
});
const token = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string };
if (!tokenResponse.ok || !token.access_token) throw new Error(`Token refresh failed: ${tokenResponse.status} ${token.error ?? ""}`);
if (token.refresh_token && token.refresh_token !== refreshToken) {
  // Intuit rotates refresh tokens; the old one stops working within a day.
  const file = process.env.QUICKBOOKS_SANDBOX_TOKEN_FILE ?? "/tmp/studiocue-qbo-sandbox-refresh-token";
  writeFileSync(file, token.refresh_token, { mode: 0o600 });
  console.log(`NOTE  Intuit issued a new refresh token; written to ${file}. Use it next time.`);
}
record("1 connect", true, `access token for sandbox company ${realmId}`);

const request = async (url: string, init: RequestInit, code: string) => {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const fault = (body.Fault as { Error?: Array<{ Detail?: string; Message?: string }> } | undefined)?.Error?.[0];
    throw new Error(`${code}:${response.status}:${fault?.Detail ?? fault?.Message ?? "PROVIDER_ERROR"}`);
  }
  return body;
};
const company = quickBooksCompany({ apiBaseUrl: apiBase, realmId, accessToken: token.access_token, request });

// --- 2. what the company does ---------------------------------------------------
const { companyInfo, preferences } = await readQuickBooksCompany(company, realmId);
const status = quickBooksCompanyStatus({ companyInfo, preferences, taxRates: null, lastTest: null });
record(
  "2 company",
  status.salesTax !== "off",
  `${status.companyName ?? "unnamed"} (${status.country ?? "?"}) — sales tax ${status.salesTax}, payments ${status.payments.state}` +
    (status.salesTax === "automatic"
      ? ""
      : status.salesTax === "manual"
        ? ". Older manual tax: finals use the company's default code (step 11); Automated Sales Tax is the by-address path."
        : ". Turn on sales tax in the sandbox company for the tax steps."),
);

// --- 3. billing settings, in the emulator ---------------------------------------
// The functions package's own firebase-admin: the workers call its getFirestore().
const functionsRequire = createRequire(`${REPO}/functions/package.json`);
const { initializeApp } = functionsRequire("firebase-admin/app");
const { getFirestore } = functionsRequire("firebase-admin/firestore");
initializeApp({ projectId });
const db = getFirestore();
const items = await ensureStudioCueItems(company, `${runKey}-items`);
// TODO(agent: settings via command) — written straight to the emulator here.
// Going through integrationsCommand setBillingSettings needs a signed-in
// owner and the Functions emulator; the shape is the same either way.
await db.doc(`billingSettings/${tenantId}`).set({
  tenantId,
  salesTax: { mode: "quickbooks", estimateRateBasisPoints: 825 },
  holdRetainerForReview: true,
  quickbooksItems: items.ids,
  updatedAt: new Date().toISOString(),
  updatedBy: "quickbooks-sandbox-walk",
});
const settings = normaliseBillingSettings((await db.doc(`billingSettings/${tenantId}`).get()).data(), tenantId);
record("3 settings", true, `billingSettings/${tenantId}: QuickBooks tax, items ${items.ids.retainerItemId} / ${items.ids.packageItemId} (made: ${items.created.join(", ") || "none"})`);

// --- 4. the test invoice: the same run as Settings → QuickBooks -------------------
const test = await runQuickBooksTestInvoice({
  company,
  realmId,
  salesTax: settings.salesTax.mode,
  storedItems: settings.quickbooksItems,
  email: process.env.SANDBOX_STUDIO_EMAIL ?? "owner@studiohub.test",
  idempotencyKey: `${runKey}-test`,
});
for (const check of test.result.checks) record(`4 test invoice · ${check.label}`, check.ok, check.detail);

// --- 5. StudioCue's own chain, in-process: the real trigger, workers and webhook ----
// From here nothing is built by hand: the contract trigger raises the
// retainer, the provider worker makes it in QuickBooks, Intuit-shaped
// webhooks (signed with a local verifier) move money back, and the held
// final goes through the studio's "Send without tax". The workers load
// the sandbox credential from a local file (provider-runtime
// localCredentialPath: emulator + STUDIOCUE_LOCAL_CREDENTIALS_DIR + a
// `local:` reference) because Secret Manager needs Google's metadata server.
const credentialDir = mkdtempSync(join(tmpdir(), "studiocue-qbo-"));
const credentialFile = join(credentialDir, "qbo-sandbox.json");
writeFileSync(
  credentialFile,
  JSON.stringify({
    accessToken: token.access_token,
    refreshToken: token.refresh_token || refreshToken,
    expiresAt: new Date(Date.now() + 50 * 60_000).toISOString(),
    realmId,
    baseUrl: SANDBOX,
  }),
  { mode: 0o600 },
);
const verifier = randomBytes(24).toString("hex");
Object.assign(process.env, {
  STUDIOCUE_LOCAL_CREDENTIALS_DIR: credentialDir,
  QUICKBOOKS_CLIENT_ID: clientId,
  QUICKBOOKS_CLIENT_SECRET: clientSecret,
  QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN: verifier,
});
const { bookingContractCompleted } = await import(`${REPO}/functions/src/booking/orchestration.ts`);
const { processJobDocument } = await import(`${REPO}/functions/src/operations/jobs.ts`);
const { quickbooksWebhook } = await import(`${REPO}/functions/src/booking/webhooks.ts`);
const { raiseFinalInvoice } = await import(`${REPO}/functions/src/booking/final-invoice.ts`);
const { sendHeldInvoiceIn, heldInvoiceConfirmFigure } = await import(`${REPO}/functions/src/booking/held-invoice-send.ts`);

const P = `walk-job-${runKey}`;
const C = `walk-contract-${runKey}`;
const S = `walk-snap-${runKey}`;
const contactId = `walk-contact-${runKey}`;
const coupleEmail = `couple+${runKey}@studiohub.test`;
const now = () => new Date().toISOString();
const eventDate = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
const setup = db.batch();
setup.set(db.doc(`tenants/${tenantId}`), { id: tenantId, tenantId, businessName: "Sandbox Walk Studio", currency: "USD", timezone: "America/New_York", status: "active" }, { merge: true });
setup.set(db.doc(`tenantFeatures/${tenantId}`), { tenantId, quickbooksItemisedInvoices: true }, { merge: true });
setup.set(db.doc(`billingSettings/${tenantId}`), { holdRetainerForReview: false }, { merge: true });
setup.set(db.doc(`integrationConnections/${tenantId}_quickbooks`), {
  id: `${tenantId}_quickbooks`, tenantId, provider: "quickbooks", status: "connected", mockMode: false,
  providerAccountId: realmId, encryptedCredentialRef: "local:qbo-sandbox", scopes: ["com.intuit.quickbooks.accounting"],
});
setup.set(db.doc(`contacts/${contactId}`), {
  id: contactId, tenantId, firstName: "Sandbox", lastName: `Couple ${runKey}`, displayName: `Sandbox Couple ${runKey}`,
  email: coupleEmail, normalizedEmail: coupleEmail, contactTypes: ["client"], projectIds: [P], archivedAt: null,
  billingAddress: { line1: "2600 Marine Way", city: "Mountain View", region: "CA", postalCode: "94043", country: "USA" },
});
setup.set(db.doc(`projects/${P}`), {
  id: P, tenantId, projectId: P, name: `Sandbox Couple ${runKey}`, eventType: "Wedding", eventTypeId: "wedding", eventDate,
  timezone: "America/New_York", state: "RETAINER_PENDING", stateVersion: 0, clientContactIds: [contactId], packageSnapshotId: S, archivedAt: null,
});
setup.set(db.doc(`packageSnapshots/${S}`), {
  id: S, tenantId, projectId: P, packageId: "gold", packageVersion: 1, packageName: "Gold Photo Package", description: "2 photographers, 8 hours",
  currency: "USD", basePriceCents: 500000, addOns: [], discountCents: 0, subtotalCents: 500000, taxCents: 0, retainerCents: 200000, totalCents: 500000,
  includedCoverageMinutes: 480, includedCoverage: [{ role: "photographer", count: 2 }], includedDeliverables: ["Online gallery"],
  salesTax: { mode: "quickbooks", exempt: false, estimatedCents: 41250, rateBasisPoints: 825 }, immutable: true, createdAt: now(),
});
setup.set(db.doc(`proposals/walk-proposal-${runKey}`), {
  id: `walk-proposal-${runKey}`, tenantId, projectId: P, packageSnapshotId: S, version: 1, status: "accepted",
  pricingSnapshot: { currency: "USD", packageName: "Gold Photo Package", subtotalCents: 500000, discountCents: 0, taxCents: 0, retainerCents: 200000, totalCents: 500000,
    lineItems: [{ description: "Gold Photo Package", quantity: 1, unitPriceCents: 500000, totalCents: 500000 }] },
  paymentSchedule: [{ label: "Retainer", amountCents: 200000, dueDate: eventDate }, { label: "Final balance", amountCents: 300000, dueDate: eventDate }],
});
setup.set(db.doc(`bookingOrchestrations/${P}`), {
  tenantId, projectId: P, status: "active", contractId: C, currentStep: "wait_for_signature",
  policy: { createRetainerAfterSignature: true, retainerDueDays: 7 }, createdAt: now(), updatedAt: now(),
});
setup.set(db.doc(`contracts/${C}`), { id: C, tenantId, projectId: P, status: "completed", completedAt: now(), provider: "studiocue" });
await setup.commit();

const drain = async () => {
  const outcomes: string[] = [];
  for (let round = 0; round < 6; round++) {
    const queued = await db.collection("providerJobs").where("tenantId", "==", tenantId).where("status", "==", "queued").get();
    if (queued.empty) break;
    for (const job of queued.docs) {
      await processJobDocument("providerJobs", job.id);
      const after = (await job.ref.get()).data() ?? {};
      outcomes.push(`${after.type}:${after.status}${after.lastError ? `(${String(after.lastError).slice(0, 160)})` : ""}`);
    }
  }
  return outcomes;
};
const invoiceDoc = async (id: string) => (await db.doc(`invoiceReferences/${id}`).get()).data() ?? {};
const qbInvoice = async (id: string) => (await company.get(`invoice/${id}?include=invoiceLink`, "QUICKBOOKS_INVOICE_READ_FAILED")).Invoice as Record<string, unknown>;
let webhookCount = 0;
const webhook = async (entity: string, id: string, operation: string) => {
  // Intuit's classic shape: what studio-cue.com receives today.
  const body = { eventNotifications: [{ realmId, dataChangeEvent: { entities: [{ name: entity, id, operation, lastUpdated: new Date(Date.now() + webhookCount++).toISOString() }] } }] };
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = createHmac("sha256", verifier).update(rawBody).digest("base64");
  const headers: Record<string, string> = { "intuit-signature": signature, "content-type": "application/json" };
  const response = { statusCode: 200, payload: null as unknown };
  const res = {
    status(code: number) { response.statusCode = code; return res; },
    json(value: unknown) { response.payload = value; return res; },
    send(value: unknown) { response.payload = value; return res; },
    set() { return res; }, setHeader() { return res; }, getHeader() { return undefined; }, end() { return res; }, on() { return res; },
  };
  const req = { method: "POST", rawBody, body, headers, header: (name: string) => headers[name.toLowerCase()], get: (name: string) => headers[name.toLowerCase()], url: "/", path: "/" };
  await (quickbooksWebhook as unknown as (q: unknown, r: unknown) => Promise<void>)(req, res);
  return response;
};

// The couple signs: the real trigger raises the retainer.
const contractAfter = await db.doc(`contracts/${C}`).get();
const contractBefore = await db.doc(`contracts/${C}__before`).get();
await bookingContractCompleted.run({ data: { before: contractBefore, after: contractAfter }, params: { contractId: C } } as never);
const retainerRows = await db.collection("invoiceReferences").where("tenantId", "==", tenantId).where("projectId", "==", P).where("kind", "==", "retainer").get();
const retainerId = retainerRows.docs[0]?.id ?? "";
record("5 signed → retainer raised", Boolean(retainerId), retainerId ? `invoiceReferences/${retainerId}: ${(await invoiceDoc(retainerId)).amountCents} cents, provider ${(await invoiceDoc(retainerId)).provider}` : "the contract trigger raised nothing");

// --- 6. the provider worker makes it in QuickBooks ----------------------------------
const made = await drain();
const retainer = await invoiceDoc(retainerId);
// "awaiting_delivery": made in QuickBooks, StudioCue's email queued (emailJobs
// aren't sent here); the delivery worker moves it to "sent".
const outToTheCouple = (status: unknown) => status === "sent" || status === "awaiting_delivery";
const retainerQb = retainer.providerInvoiceId && !String(retainer.providerInvoiceId).startsWith("qbo_") ? await qbInvoice(String(retainer.providerInvoiceId)) : {};
record(
  "6 retainer made in QuickBooks",
  outToTheCouple(retainer.status) && Math.round(Number(retainerQb.TotalAmt) * 100) === 200000,
  `${made.join(", ")} → ${retainer.status}, QuickBooks invoice ${retainer.providerInvoiceId}, total ${retainerQb.TotalAmt}`,
);
record(
  "6 couple's email on it, QuickBooks told not to send",
  (retainerQb.BillEmail as { Address?: string } | undefined)?.Address === coupleEmail && retainerQb.EmailStatus === "NotSet",
  `BillEmail ${(retainerQb.BillEmail as { Address?: string } | undefined)?.Address ?? "none"}, EmailStatus ${retainerQb.EmailStatus}; pay link ${retainerQb.InvoiceLink ? "yes" : "none (sandbox has no Payments)"}`,
);
const customerId = String((retainerQb.CustomerRef as { value?: string } | undefined)?.value ?? "");
const customerRow = customerId ? ((await company.get(`customer/${customerId}`, "QUICKBOOKS_CUSTOMER_READ_FAILED")).Customer as Record<string, unknown>) : {};
record("6 couple made with their billing address", (customerRow.BillAddr as { City?: string } | undefined)?.City === "Mountain View", `customer ${customerId}: ${JSON.stringify(customerRow.BillAddr ?? null)}`);

// --- 7. the couple pays: Payment webhook → paid in StudioCue -------------------------
const pay = async (key: string) =>
  (await company.post("payment", { CustomerRef: { value: customerId }, TotalAmt: 2000, Line: [{ Amount: 2000, LinkedTxn: [{ TxnId: String(retainer.providerInvoiceId), TxnType: "Invoice" }] }] }, "QUICKBOOKS_PAYMENT_FAILED", `${runKey}-${key}`)).Payment as { Id: string; SyncToken: string };
const payment = await pay("pay-1");
const paidHook = await webhook("Payment", payment.Id, "Create");
const paidJobs = await drain();
const paid = await invoiceDoc(retainerId);
record("7 Payment webhook → retainer paid", paidHook.statusCode === 200 && paid.status === "paid" && Number(paid.balanceCents) === 0, `webhook ${paidHook.statusCode}; ${paidJobs.join(", ")} → ${paid.status}, balance ${paid.balanceCents}`);

// --- 8. the payment is deleted in QuickBooks: reopened, and the studio told ----------
const paymentNow = (await company.get(`payment/${payment.Id}`, "QUICKBOOKS_PAYMENT_READ_FAILED")).Payment as { SyncToken: string };
await company.post("payment?operation=delete", { Id: payment.Id, SyncToken: paymentNow.SyncToken }, "QUICKBOOKS_PAYMENT_DELETE_FAILED", `${runKey}-delete-1`);
const deletedHook = await webhook("Payment", payment.Id, "Delete");
const deletedJobs = await drain();
const reopened = await invoiceDoc(retainerId);
const reopenTasks = (await db.collection("tasks").where("tenantId", "==", tenantId).where("projectId", "==", P).get()).docs.map((d) => d.data());
record(
  "8 Payment deleted → retainer owing again",
  reopened.status !== "paid" && Number(reopened.balanceCents) === 200000,
  `webhook ${deletedHook.statusCode}; ${deletedJobs.join(", ")} → ${reopened.status}, balance ${reopened.balanceCents}`,
);
record("8 the studio gets a task", reopenTasks.length > 0, reopenTasks.map((task) => `"${task.title}"`).join("; ") || "no task");

// --- 9. a credit memo: StudioCue's balance follows QuickBooks' ----------------------
const memo = (await company.post(
  "creditmemo",
  { CustomerRef: { value: customerId }, Line: [{ Amount: 500, DetailType: "SalesItemLineDetail", Description: "Goodwill credit", SalesItemLineDetail: { ItemRef: { value: settings.quickbooksItems.retainerItemId! }, Qty: 1, UnitPrice: 500, TaxCodeRef: { value: "NON" } } }] },
  "QUICKBOOKS_CREDITMEMO_FAILED",
  `${runKey}-memo`,
)).CreditMemo as { Id: string };
const memoHook = await webhook("CreditMemo", memo.Id, "Create");
const memoJobs = await drain();
const afterMemo = await invoiceDoc(retainerId);
const qbAfterMemo = await qbInvoice(String(retainer.providerInvoiceId));
record(
  "9 CreditMemo webhook → balance matches QuickBooks",
  memoHook.statusCode === 200 && Number(afterMemo.balanceCents) === Math.round(Number(qbAfterMemo.Balance) * 100),
  `${memoJobs.join(", ") || "no jobs"}; StudioCue ${afterMemo.balanceCents}, QuickBooks ${qbAfterMemo.Balance} (credits apply automatically only if the company says so)`,
);

// --- 10. a refund receipt: a Today task, since the invoice stays paid -----------------
const bank = ((await company.query("select * from Account where AccountType = 'Bank' maxresults 1", "QUICKBOOKS_ACCOUNT_SEARCH_FAILED")).QueryResponse as { Account?: Array<{ Id: string }> }).Account?.[0];
const refund = (await company.post(
  "refundreceipt",
  { CustomerRef: { value: customerId }, DepositToAccountRef: { value: bank?.Id ?? "35" }, Line: [{ Amount: 100, DetailType: "SalesItemLineDetail", Description: "Refund", SalesItemLineDetail: { ItemRef: { value: settings.quickbooksItems.retainerItemId! }, Qty: 1, UnitPrice: 100, TaxCodeRef: { value: "NON" } } }] },
  "QUICKBOOKS_REFUND_FAILED",
  `${runKey}-refund`,
)).RefundReceipt as { Id: string };
const refundHook = await webhook("RefundReceipt", refund.Id, "Create");
const refundJobs = await drain();
const refundTask = (await db.doc(`tasks/quickbooks_refund_${refund.Id}`).get()).data();
record("10 RefundReceipt webhook → task for the studio", refundHook.statusCode === 200 && Boolean(refundTask), `${refundJobs.join(", ")}; ${refundTask ? `"${refundTask.title}"` : "no task"}`);

// --- 11. the final: held with QuickBooks' tax, then "Send without tax" ---------------
const payment2 = await pay("pay-2");
await webhook("Payment", payment2.Id, "Create");
await drain();
const finalId = `walk-final-${runKey}`;
const projectSnapshot = await db.doc(`projects/${P}`).get();
const raised = await db.runTransaction((transaction) => raiseFinalInvoice(db, transaction, projectSnapshot, { invoiceId: finalId, actor: "quickbooks-sandbox-walk", now: now() }));
const finalJobs = await drain();
const held = await invoiceDoc(finalId);
const review = (held.sendReview ?? {}) as Record<string, unknown>;
const heldQb = held.providerInvoiceId && !String(held.providerInvoiceId).startsWith("pending_") ? await qbInvoice(String(held.providerInvoiceId)) : {};
record(
  "11 final held for the studio, taxed by QuickBooks",
  held.status === "review_required" && review.state === "awaiting_studio" && Number(review.taxCents) > 0 && heldQb.EmailStatus === "NotSet",
  `${JSON.stringify(raised)}; ${finalJobs.join(", ")} → ${held.status}/${review.state}, ${review.strategy}: pre-tax ${review.subtotalCents}, tax ${review.taxCents}, total ${review.totalCents}; QuickBooks ${heldQb.TotalAmt}, EmailStatus ${heldQb.EmailStatus}, BillEmail ${(heldQb.BillEmail as { Address?: string } | undefined)?.Address ?? "none"}`,
);
const confirm = heldInvoiceConfirmFigure(held, "send_without_tax");
await db.runTransaction((transaction) =>
  sendHeldInvoiceIn(db, transaction, { tenantId, role: "studio_owner", actorId: "walk-owner", now: now(), idempotencyKey: `${runKey}-send`, ipAddress: null, userAgent: null }, { projectId: P, invoiceId: finalId, action: "send_without_tax", confirmAmountCents: confirm }),
);
const sendJobs = await drain();
const sent = await invoiceDoc(finalId);
const sentQb = held.providerInvoiceId ? await qbInvoice(String(held.providerInvoiceId)) : {};
const finalEmails = (await db.collection("emailJobs").where("tenantId", "==", tenantId).where("projectId", "==", P).get()).docs.map((d) => String(d.get("type") ?? d.get("template") ?? ""));
record(
  "11 Send without tax → sent at the pre-tax total",
  outToTheCouple(sent.status) && Number(sentQb.TotalAmt) * 100 === Number(review.subtotalCents) && Math.round(Number((sentQb.TxnTaxDetail as { TotalTax?: number } | undefined)?.TotalTax ?? 0) * 100) === 0,
  `${sendJobs.join(", ")} → ${sent.status}, amount ${sent.amountCents}; QuickBooks total ${sentQb.TotalAmt}, tax ${(sentQb.TxnTaxDetail as { TotalTax?: number } | undefined)?.TotalTax ?? 0}; emails queued: ${finalEmails.join(", ") || "none"}`,
);

// --- 12. tidy the sandbox --------------------------------------------------------------
const tidy: string[] = [];
const attempt = async (label: string, work: () => Promise<unknown>) => { try { await work(); tidy.push(label); } catch (caught) { tidy.push(`${label} (left: ${String((caught as Error).message).slice(0, 60)})`); } };
await attempt("payment deleted", async () => {
  const current = (await company.get(`payment/${payment2.Id}`, "QUICKBOOKS_PAYMENT_READ_FAILED")).Payment as { SyncToken: string };
  await company.post("payment?operation=delete", { Id: payment2.Id, SyncToken: current.SyncToken }, "QUICKBOOKS_PAYMENT_DELETE_FAILED", `${runKey}-delete-2`);
});
for (const id of [String(retainer.providerInvoiceId), String(held.providerInvoiceId)])
  await attempt(`invoice ${id} voided`, async () => {
    const current = await qbInvoice(id);
    await company.post("invoice?operation=void", { Id: id, SyncToken: current.SyncToken }, "QUICKBOOKS_VOID_FAILED", `${runKey}-void-${id}`);
  });
record("12 sandbox tidied", null, tidy.join("; "));

// Intuit rotates refresh tokens; the workers may have refreshed this one.
const rotated = JSON.parse(readFileSync(credentialFile, "utf8")) as { refreshToken?: string };
if (rotated.refreshToken && rotated.refreshToken !== refreshToken)
  writeFileSync(process.env.QUICKBOOKS_SANDBOX_TOKEN_FILE ?? "/tmp/studiocue-qbo-sandbox-refresh-token", rotated.refreshToken, { mode: 0o600 });
rmSync(credentialDir, { recursive: true, force: true });

const failed = results.filter((result) => result.ok === false).length;
const todo = results.filter((result) => result.ok === null).length;
console.log(`TALLY ${results.length - failed - todo} passed, ${failed} failed, ${todo} to do`);
process.exit(failed ? 1 : 0);
