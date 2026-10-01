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
 * Steps 1–4 and 6–8 run today. Steps marked TODO need the invoice tax flow
 * (another agent's work) and say what is stubbed. The sandbox company should
 * be US, with Automated Sales Tax and QuickBooks Payments switched on — see
 * docs/booking-integrations.md, "Not yet verified against a real company".
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const REPO = process.cwd();
const require = createRequire(`${REPO}/package.json`);
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
const { quickBooksCompanyStatus, itemKeyForLine } = await import(`${REPO}/functions/src/integrations/quickbooks-setup-core.ts`);
const { normaliseBillingSettings } = await import(`${REPO}/functions/src/billing/sales-tax-settings.ts`);
const lines = await import(`${REPO}/functions/src/operations/quickbooks-invoice-lines.ts`);

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
  status.salesTax === "automatic" ? true : false,
  `${status.companyName ?? "unnamed"} (${status.country ?? "?"}) — sales tax ${status.salesTax}, payments ${status.payments.state}` +
    (status.salesTax === "automatic" ? "" : ". Turn on Automated Sales Tax in the sandbox company for the tax steps."),
);

// --- 3. billing settings, in the emulator ---------------------------------------
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
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

// --- 5. job → signed agreement (StudioCue side) ----------------------------------
// TODO(agent: invoice tax flow) — create the project, accepted proposal and a
// signed contract in the emulator (scripts/uat/fixture.mts shows the shapes),
// then let createRetainerInvoice queue create_quickbooks_invoice and run it
// through the job worker. Until then steps 6–8 build the same lines directly.
record("5 job + signed agreement", null, "stubbed: the retainer and final below are built from StudioCue's line rules directly");

// A couple with an address, so Automated Sales Tax has somewhere to work.
const coupleName = `Sandbox Couple ${runKey}`;
const couple = await company.post(
  "customer",
  lines.quickBooksCustomerCreateBody(
    {
      firstName: "Sandbox",
      lastName: `Couple ${runKey}`,
      displayName: coupleName,
      email: "couple@studiohub.test",
      billingAddress: { line1: "2600 Marine Way", city: "Mountain View", region: "CA", postalCode: "94043", country: "USA" },
    },
    coupleName,
  ),
  "QUICKBOOKS_CUSTOMER_CREATE_FAILED",
  `${runKey}-couple`,
);
const coupleId = String((couple.Customer as { Id?: string }).Id);
const itemRef = (line: { kind: string }) =>
  itemKeyForLine(line.kind) === "retainer"
    ? { value: settings.quickbooksItems.retainerItemId!, name: "Retainer" }
    : { value: settings.quickbooksItems.packageItemId!, name: "Photography package" };

// --- 6. retainer invoice + a simulated payment ------------------------------------
const packageItem = { kind: "package" as const, name: "Gold Photo Package", summary: "2 photographers, 8 hours", inclusions: ["Online gallery"], quantity: 1, unitPriceCents: 500000, amountCents: 500000, taxable: true };
const retainerLines = lines.quickBooksRetainerLines({
  amountCents: 200000,
  items: [packageItem],
  parts: [{ packageName: packageItem.name, retainerCents: 200000, perCrew: { amountPerCrewCents: 100000, crew: 2 } }],
  taxApplies: true,
});
const retainerPayload = lines.quickBooksLinePayload({ lines: retainerLines, taxCents: 0, mode: "automated", itemRef });
const retainer = await company.post(
  "invoice",
  { CustomerRef: { value: coupleId }, AllowOnlineCreditCardPayment: true, AllowOnlineACHPayment: true, Line: retainerPayload.Line },
  "QUICKBOOKS_CREATE_FAILED",
  `${runKey}-retainer`,
);
const retainerInvoice = retainer.Invoice as { Id: string; TotalAmt: number };
record("6 retainer invoice", Math.round(retainerInvoice.TotalAmt * 100) === 200000, `invoice ${retainerInvoice.Id}, total ${retainerInvoice.TotalAmt}`);
// Sandbox only: a Payment record standing in for the couple paying online.
const payment = await company.post(
  "payment",
  { CustomerRef: { value: coupleId }, TotalAmt: 2000, Line: [{ Amount: 2000, LinkedTxn: [{ TxnId: retainerInvoice.Id, TxnType: "Invoice" }] }] },
  "QUICKBOOKS_PAYMENT_FAILED",
  `${runKey}-payment`,
);
const paymentRecord = payment.Payment as { Id: string; SyncToken: string };
record("6 retainer paid (simulated)", true, `payment ${paymentRecord.Id} applied to ${retainerInvoice.Id}`);

// --- 7. final invoice with tax ----------------------------------------------------
// TODO(agent: invoice tax flow) — the real final lets QuickBooks calculate the
// tax for the couple's address and the studio confirms it. Here: the package
// lines with TAX codes and no override, and the figure QuickBooks returns.
const finalLines = lines.quickBooksFinalLines({
  amountCents: 300000,
  packageTotalCents: 500000,
  taxCents: 0,
  discountCents: 0,
  items: [packageItem],
  retainerPaidCents: 200000,
});
const finalPayload = lines.quickBooksLinePayload({ lines: finalLines.lines, taxCents: 0, mode: "manual", itemRef });
const taxedLines = finalPayload.Line.map((line: Record<string, unknown>, index: number) => ({
  ...line,
  SalesItemLineDetail: {
    ...(line.SalesItemLineDetail as Record<string, unknown>),
    TaxCodeRef: { value: finalLines.lines[index]?.taxable ? "TAX" : "NON" },
  },
}));
const finalCreated = await company.post(
  "invoice",
  { CustomerRef: { value: coupleId }, AllowOnlineCreditCardPayment: true, AllowOnlineACHPayment: true, Line: taxedLines },
  "QUICKBOOKS_CREATE_FAILED",
  `${runKey}-final`,
);
const finalInvoice = finalCreated.Invoice as { Id: string; SyncToken: string; TotalAmt: number; TxnTaxDetail?: { TotalTax?: number } };
const finalTax = Math.round(Number(finalInvoice.TxnTaxDetail?.TotalTax ?? 0) * 100);
record(
  "7 final invoice with tax",
  finalTax > 0,
  `invoice ${finalInvoice.Id}: lines ${finalLines.lines.map((line: { title: string }) => line.title).join(" / ")}; QuickBooks tax ${finalTax / 100}, total ${finalInvoice.TotalAmt}`,
);

// --- 8. void, and money moving back ----------------------------------------------
await company.post("invoice?operation=void", { Id: finalInvoice.Id, SyncToken: finalInvoice.SyncToken }, "QUICKBOOKS_VOID_FAILED", `${runKey}-void-final`);
record("8 void final", true, `voided ${finalInvoice.Id}`);
await company.post("payment?operation=delete", { Id: paymentRecord.Id, SyncToken: paymentRecord.SyncToken }, "QUICKBOOKS_PAYMENT_DELETE_FAILED", `${runKey}-delete-payment`);
const reread = (await company.get(`invoice/${retainerInvoice.Id}`, "QUICKBOOKS_INVOICE_READ_FAILED")).Invoice as { Balance: number; SyncToken: string };
record("8 payment deleted → retainer owing again", Math.round(reread.Balance * 100) === 200000, `retainer balance ${reread.Balance}`);
// TODO(agent: webhooks) — Intuit's sandbox webhooks can't reach the emulator.
// Point the sandbox app's webhook at a tunnel to quickbooksWebhook to see the
// Payment Delete event reopen the retainer and raise the Today task.
record("8 webhook reopens the invoice in StudioCue", null, "needs a tunnel from Intuit to the Functions emulator");
await company.post("invoice?operation=void", { Id: retainerInvoice.Id, SyncToken: reread.SyncToken }, "QUICKBOOKS_VOID_FAILED", `${runKey}-void-retainer`);
record("8 void retainer", true, `voided ${retainerInvoice.Id}`);

const failed = results.filter((result) => result.ok === false).length;
const todo = results.filter((result) => result.ok === null).length;
console.log(`TALLY ${results.length - failed - todo} passed, ${failed} failed, ${todo} to do`);
process.exit(failed ? 1 : 0);
