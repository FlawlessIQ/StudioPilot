/**
 * QuickBooks sandbox walk for an imported booking: the final bill, end to
 * end, on a job that came in from a spreadsheet.
 *
 * quickbooks-sandbox-walk.mts proves a booking made in StudioCue: its
 * retainer was raised in QuickBooks, so QuickBooks already knows the couple.
 * An imported booking is the other shape — GR's real ones: the deposit was
 * paid before StudioCue and recorded by hand, part of it may still be owed,
 * the couple has no billing address and no QuickBooks customer. On prod the
 * walk of 2026-10-28 couldn't reach QuickBooks (FlawlessIQ's subscription
 * had ended), so this proves it against Intuit's sandbox instead.
 *
 * Same environment as quickbooks-sandbox-walk.mts (read its header); a
 * rotated refresh token is written back to QUICKBOOKS_SANDBOX_TOKEN_FILE.
 *
 *   npx tsx scripts/uat/quickbooks-sandbox-import-walk.mts
 *
 * Nothing between the steps is written by hand: the import command makes
 * the job, bring-in makes it live, "Send the final bill" (sendFinalBalance)
 * raises it, the provider worker finds or makes the couple and the invoice in
 * QuickBooks, the studio sends the held bill, and a signed Payment webhook
 * settles it. The sandbox is tidied at the end.
 */
import { createRequire } from "node:module";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const SANDBOX = "https://sandbox-quickbooks.api.intuit.com";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

// --- guards (as quickbooks-sandbox-walk.mts) -----------------------------------
const env = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required (see the header of quickbooks-sandbox-walk.mts).`);
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
const tokenFile = process.env.QUICKBOOKS_SANDBOX_TOKEN_FILE ?? "/tmp/studiocue-qbo-sandbox-refresh-token";
const runKey = `imp_${Date.now().toString(36)}`;
const tenantId = process.env.SANDBOX_TENANT_ID?.trim() || `qbo-import-walk-${runKey}`;

const { quickBooksCompany, ensureStudioCueItems } = await import(`${REPO}/functions/src/integrations/quickbooks-items.ts`);

const results: Array<{ step: string; ok: boolean | null; detail: string }> = [];
const record = (step: string, ok: boolean | null, detail: string) => {
  results.push({ step, ok, detail });
  console.log(`${ok === true ? "PASS" : ok === false ? "FAIL" : "NOTE"}  ${step} — ${detail}`);
};

// --- 1. connect -------------------------------------------------------------------
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
// Written before anything else can fail: Intuit invalidates the old token.
if (token.refresh_token) writeFileSync(tokenFile, token.refresh_token, { mode: 0o600 });
record("1 connect", true, `sandbox company ${realmId}`);

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

// --- 2. a studio on QuickBooks, in the emulator -------------------------------------
const functionsRequire = createRequire(`${REPO}/functions/package.json`);
const { initializeApp } = functionsRequire("firebase-admin/app");
const { getFirestore } = functionsRequire("firebase-admin/firestore");
initializeApp({ projectId });
const db = getFirestore();
const items = await ensureStudioCueItems(company, `${runKey}-items`);

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
const { importExistingBooking, bringImportedBookingLive } = await import(`${REPO}/functions/src/imports/commands.ts`);
const { sendFinalBalance } = await import(`${REPO}/functions/src/booking/send-final-balance.ts`);
const { processJobDocument } = await import(`${REPO}/functions/src/operations/jobs.ts`);
const { quickbooksWebhook } = await import(`${REPO}/functions/src/booking/webhooks.ts`);
const { sendHeldInvoiceIn, heldInvoiceConfirmFigure } = await import(`${REPO}/functions/src/booking/held-invoice-send.ts`);

const now = () => new Date().toISOString();
const ownerId = `owner-${runKey}`;
const membership = { tenantId, userId: ownerId, role: "studio_owner", status: "active", explicitPermissions: [], permittedProjectIds: [] };
const setup = db.batch();
setup.set(db.doc(`tenants/${tenantId}`), {
  id: tenantId, tenantId, businessName: "Sandbox Import Studio", currency: "USD", timezone: "America/New_York", status: "active", trade: "photographer",
});
setup.set(db.doc(`memberships/${tenantId}_${ownerId}`), { id: `${tenantId}_${ownerId}`, ...membership });
// A paying studio: a lapsed one's QuickBooks work is parked as held_billing.
setup.set(db.doc(`subscriptions/${tenantId}`), { tenantId, status: "active", comped: true, plan: "studio", archivedAt: null });
setup.set(db.doc(`tenantFeatures/${tenantId}`), { tenantId, quickbooksItemisedInvoices: true });
setup.set(db.doc(`billingSettings/${tenantId}`), {
  tenantId, salesTax: { mode: "quickbooks", estimateRateBasisPoints: 825 }, holdRetainerForReview: false, quickbooksItems: items.ids,
  updatedAt: now(), updatedBy: "quickbooks-sandbox-import-walk",
});
setup.set(db.doc(`integrationConnections/${tenantId}_quickbooks`), {
  id: `${tenantId}_quickbooks`, tenantId, provider: "quickbooks", status: "connected", mockMode: false,
  providerAccountId: realmId, encryptedCredentialRef: "local:qbo-sandbox", scopes: ["com.intuit.quickbooks.accounting"],
});
await setup.commit();
// One studio per QuickBooks company, as in production: a webhook finds its
// studio by the company id, so an earlier run's studio left connected to the
// same sandbox would take this run's payments.
const stale = await db.collection("integrationConnections").where("provider", "==", "quickbooks").where("providerAccountId", "==", realmId).get();
for (const connection of stale.docs)
  if (connection.id !== `${tenantId}_quickbooks`) await connection.ref.update({ status: "disconnected" });
record("2 studio", true, `${tenantId}: QuickBooks connected, items ${items.ids.retainerItemId} / ${items.ids.packageItemId}`);

// --- 3. the import: GR's shape -------------------------------------------------------
// $4,200 wedding three weeks out. The contract's retainer is $1,500: $1,000
// paid before StudioCue, $500 still owed. No billing address, no QuickBooks
// customer — the studio's spreadsheet knows neither.
const coupleEmail = `ivy+${runKey}@studiohub.test`;
const eventDate = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
const imported = await importExistingBooking({
  tenantId, membership, actorId: ownerId, timestamp: now(), userAgent: null, source: "spreadsheet", batchId: null,
  booking: {
    clients: [
      { firstName: "Ivy", lastName: `Sandbox ${runKey}`, email: coupleEmail, phone: null },
      { firstName: "Sam", lastName: "Reed", email: null, phone: null },
    ],
    projectName: null, eventTypeId: "wedding", eventType: "Wedding", eventDate, timezone: "America/New_York",
    venueName: "Harborview Hall", city: "Newport", state: "BOOKED",
    packageName: "Silver Photo Package", coverageMinutes: 480, photographers: 2,
    currency: "USD", totalCents: 420000, taxCents: 0,
    signedOn: "2026-04-15", signerName: `Ivy Sandbox ${runKey}`, hasSignedCopy: false,
    payments: [{ amountCents: 100000, paidOn: "2026-04-16", method: "Check" }],
    retainerOwedCents: 50000,
    notes: null,
  },
});
const P = String((imported as { projectId?: string }).projectId ?? "");
const invoicesOf = async (): Promise<Array<Record<string, unknown>>> =>
  (await db.collection("invoiceReferences").where("tenantId", "==", tenantId).where("projectId", "==", P).get()).docs.map(
    (doc: { id: string; data(): Record<string, unknown> }) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown>,
  );
const before = await invoicesOf();
record(
  "3 imported",
  Boolean(P) && before.some((invoice) => invoice.kind === "retainer" && invoice.status === "paid" && invoice.amountCents === 100000) &&
    before.some((invoice) => invoice.kind === "retainer" && invoice.status !== "paid" && invoice.amountCents === 50000),
  `${P}: ${before.map((invoice) => `${invoice.kind} ${invoice.amountCents} ${invoice.status} provider ${invoice.provider ?? "none"}`).join("; ")}`,
);

await bringImportedBookingLive({
  tenantId, membership, actorId: ownerId, timestamp: now(), userAgent: null, idempotencyKey: `${runKey}-live`, projectId: P, calendarAndFolders: false,
});
record("3 brought in", !(await db.doc(`projects/${P}`).get()).get("clientAutomationsPausedAt"), "client automations on");

// --- 4. "Send the final bill" --------------------------------------------------------
const drain = async () => {
  const outcomes: string[] = [];
  for (let round = 0; round < 6; round++) {
    const queued = await db.collection("providerJobs").where("tenantId", "==", tenantId).where("status", "==", "queued").get();
    if (queued.empty) break;
    for (const job of queued.docs) {
      await processJobDocument("providerJobs", job.id);
      const after = (await job.ref.get()).data() ?? {};
      outcomes.push(`${after.type}:${after.status}${after.lastError ? `(${JSON.stringify(after.lastError).slice(0, 200)})` : ""}`);
    }
  }
  return outcomes;
};
const invoiceDoc = async (id: string) => (await db.doc(`invoiceReferences/${id}`).get()).data() ?? {};
const qbInvoice = async (id: string) =>
  (await company.get(`invoice/${id}?include=invoiceLink`, "QUICKBOOKS_INVOICE_READ_FAILED")).Invoice as Record<string, unknown>;

const raised = await sendFinalBalance(db, { tenantId, projectId: P, role: "studio_owner", actorId: ownerId, mockMode: false });
const finalId = String((raised as { invoiceId?: string }).invoiceId ?? `final_${P}`);
record("4 final raised", (raised as { raised?: boolean }).raised === true, JSON.stringify(raised).slice(0, 300));

const made = await drain();
let final = await invoiceDoc(finalId);
const review = (final.sendReview ?? {}) as Record<string, unknown>;
record(
  "5 made in QuickBooks",
  Boolean(final.providerInvoiceId) && !String(final.providerInvoiceId).startsWith("pending_"),
  `${made.join(", ")} → ${final.status}${review.state ? `/${review.state}` : ""}, QuickBooks invoice ${final.providerInvoiceId}, customer ${final.providerCustomerId}`,
);

// A final held for the studio's look at QuickBooks' tax goes out the way the
// studio sends it from Invoices.
if (final.status === "review_required" && review.state === "awaiting_studio") {
  const action = Number(review.taxCents ?? 0) > 0 ? "send_with_tax" : "send_without_tax";
  await db.runTransaction((transaction: unknown) =>
    sendHeldInvoiceIn(
      db,
      transaction,
      { tenantId, role: "studio_owner", actorId: ownerId, now: now(), idempotencyKey: `${runKey}-send`, ipAddress: null, userAgent: null },
      { projectId: P, invoiceId: finalId, action, confirmAmountCents: heldInvoiceConfirmFigure(final, action) },
    ),
  );
  const sendJobs = await drain();
  final = await invoiceDoc(finalId);
  record("5 studio sent the held bill", null, `${action}: ${sendJobs.join(", ")} → ${final.status}`);
}

const qb = final.providerInvoiceId && !String(final.providerInvoiceId).startsWith("pending_") ? await qbInvoice(String(final.providerInvoiceId)) : {};
const qbTotalCents = Math.round(Number(qb.TotalAmt ?? 0) * 100);
const qbTaxCents = Math.round(Number((qb.TxnTaxDetail as { TotalTax?: number } | undefined)?.TotalTax ?? 0) * 100);
const lines = ((qb.Line as Array<Record<string, unknown>> | undefined) ?? [])
  .filter((line) => line.DetailType !== "SubTotalLineDetail")
  .map((line) => `${line.Description ?? line.DetailType}: ${line.Amount}`);
// $4,200 less the $1,000 paid and the $500 billed separately: $2,700 before tax.
record(
  "6 the bill is the balance",
  qbTotalCents - qbTaxCents === 270000 && Number(final.amountCents) === qbTotalCents,
  `QuickBooks total ${qb.TotalAmt} (tax ${qbTaxCents / 100}); StudioCue ${final.amountCents}; lines: ${lines.join(" | ")}`,
);
record(
  "6 to the couple, from StudioCue",
  (qb.BillEmail as { Address?: string } | undefined)?.Address === coupleEmail && ["sent", "awaiting_delivery"].includes(String(final.status)),
  `BillEmail ${(qb.BillEmail as { Address?: string } | undefined)?.Address ?? "none"}, EmailStatus ${qb.EmailStatus}, StudioCue ${final.status}`,
);
const customerId = String((qb.CustomerRef as { value?: string } | undefined)?.value ?? "");
const customer = customerId
  ? ((await company.get(`customer/${customerId}`, "QUICKBOOKS_CUSTOMER_READ_FAILED")).Customer as Record<string, unknown>)
  : {};
record(
  "6 the couple made in QuickBooks",
  (customer.PrimaryEmailAddr as { Address?: string } | undefined)?.Address === coupleEmail,
  `customer ${customerId}: ${customer.DisplayName ?? "none"}, ${(customer.PrimaryEmailAddr as { Address?: string } | undefined)?.Address ?? "no email"}, address ${JSON.stringify(customer.BillAddr ?? null)}`,
);

// --- 7. the couple pays it in QuickBooks: a signed Payment webhook ------------------
let webhookCount = 0;
const webhook = async (entity: string, id: string, operation: string) => {
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
let paymentId = "";
if (customerId && final.providerInvoiceId) {
  const payment = (await company.post(
    "payment",
    { CustomerRef: { value: customerId }, TotalAmt: qbTotalCents / 100, Line: [{ Amount: qbTotalCents / 100, LinkedTxn: [{ TxnId: String(final.providerInvoiceId), TxnType: "Invoice" }] }] },
    "QUICKBOOKS_PAYMENT_FAILED",
    `${runKey}-pay`,
  )).Payment as { Id: string };
  paymentId = payment.Id;
  const hook = await webhook("Payment", payment.Id, "Create");
  const paidJobs = await drain();
  const paid = await invoiceDoc(finalId);
  record("7 paid in QuickBooks → paid in StudioCue", hook.statusCode === 200 && paid.status === "paid" && Number(paid.balanceCents) === 0, `webhook ${hook.statusCode}; ${paidJobs.join(", ")} → ${paid.status}, balance ${paid.balanceCents}`);
  const checks = (await db.collection("checkpoints").where("tenantId", "==", tenantId).where("projectId", "==", P).get()).docs.map(
    (doc: { data(): Record<string, unknown> }) => doc.data(),
  );
  const balanceCheck = checks.find((check: Record<string, unknown>) => check.templateKey === "final-balance");
  record("7 the job's balance step", null, balanceCheck ? `final-balance ${balanceCheck.status}` : "no workflow on the walk's studio (no starter templates seeded)");
}
const owed = (await invoicesOf()).find((invoice) => invoice.kind === "retainer" && invoice.status !== "paid");
record("7 the $500 still owed stays its own bill", Number(owed?.balanceCents ?? owed?.amountCents ?? 0) === 50000, owed ? `${owed.id}: ${owed.status}, ${owed.balanceCents ?? owed.amountCents}` : "none");

// --- 8. tidy the sandbox ----------------------------------------------------------------
const tidy: string[] = [];
const attempt = async (label: string, work: () => Promise<unknown>) => {
  try { await work(); tidy.push(label); } catch (caught) { tidy.push(`${label} (left: ${String((caught as Error).message).slice(0, 80)})`); }
};
if (paymentId)
  await attempt(`payment ${paymentId} deleted`, async () => {
    const current = (await company.get(`payment/${paymentId}`, "QUICKBOOKS_PAYMENT_READ_FAILED")).Payment as { SyncToken: string };
    await company.post("payment?operation=delete", { Id: paymentId, SyncToken: current.SyncToken }, "QUICKBOOKS_PAYMENT_DELETE_FAILED", `${runKey}-delete`);
  });
if (final.providerInvoiceId && !String(final.providerInvoiceId).startsWith("pending_"))
  await attempt(`invoice ${final.providerInvoiceId} voided`, async () => {
    const current = await qbInvoice(String(final.providerInvoiceId));
    await company.post("invoice?operation=void", { Id: String(final.providerInvoiceId), SyncToken: current.SyncToken }, "QUICKBOOKS_VOID_FAILED", `${runKey}-void`);
  });
record("8 sandbox tidied", null, tidy.join("; ") || "nothing to tidy");

const rotated = JSON.parse(readFileSync(credentialFile, "utf8")) as { refreshToken?: string };
if (rotated.refreshToken && rotated.refreshToken !== (token.refresh_token || refreshToken))
  writeFileSync(tokenFile, rotated.refreshToken, { mode: 0o600 });
rmSync(credentialDir, { recursive: true, force: true });

const failed = results.filter((result) => result.ok === false).length;
const notes = results.filter((result) => result.ok === null).length;
console.log(`TALLY ${results.length - failed - notes} passed, ${failed} failed, ${notes} notes`);
process.exit(failed ? 1 : 0);
