/**
 * A parent's QuickBooks invoice at a group event, against the QuickBooks
 * sandbox (docs/group-event-signup-plan-2026-10-10.md, Phase 4b).
 *
 * Runs the worker's own QuickBooks calls
 * (functions/src/group-events/participant-invoices.ts) — the customer
 * match, the invoice, the read-back, the void — with a sandbox token. It
 * proves the request bodies QuickBooks accepts and that no sales tax lands
 * on an event price, which mocks cannot. It never asks QuickBooks to email
 * anyone, and needs no Firestore.
 *
 *   QUICKBOOKS_API_BASE_URL=https://sandbox-quickbooks.api.intuit.com
 *   QUICKBOOKS_SANDBOX_CLIENT_ID / _CLIENT_SECRET / _REALM_ID / _REFRESH_TOKEN
 *   QUICKBOOKS_SANDBOX_TOKEN_FILE   where a rotated refresh token is written
 *
 *   npx tsx scripts/uat/quickbooks-participant-invoice-sandbox.mts
 */
import { writeFileSync } from "node:fs";

const REPO = process.cwd();
const SANDBOX = "https://sandbox-quickbooks.api.intuit.com";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

const env = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required (see the header of this script).`);
  return value;
};
const apiBase = env("QUICKBOOKS_API_BASE_URL").replace(/\/$/, "");
if (apiBase !== SANDBOX) throw new Error(`Refusing: QUICKBOOKS_API_BASE_URL must be ${SANDBOX}, not ${apiBase}.`);
const clientId = env("QUICKBOOKS_SANDBOX_CLIENT_ID");
const clientSecret = env("QUICKBOOKS_SANDBOX_CLIENT_SECRET");
const realmId = env("QUICKBOOKS_SANDBOX_REALM_ID");
const refreshToken = env("QUICKBOOKS_SANDBOX_REFRESH_TOKEN");
const runKey = Date.now().toString(36);

const { parentCustomerId, createParentInvoiceAt, readParentInvoiceAt, voidParentInvoiceAt } = await import(
  `${REPO}/functions/src/group-events/participant-invoices.ts`
);

let failed = 0;
const record = (step: string, ok: boolean, detail: string) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${step} — ${detail}`);
};

// --- connect --------------------------------------------------------------------
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
  console.log(`NOTE  Intuit issued a new refresh token; written to ${file}.`);
}
const company = { base: apiBase, realmId, credential: { accessToken: token.access_token, realmId } };
record("connect", true, `sandbox company ${realmId}`);

// --- the parent as a customer -------------------------------------------------------
const parent = { parentName: `Walk Parent ${runKey}`, email: `parent-${runKey}@example.com`, phone: "555-0100" };
const customerId: string = await parentCustomerId(company, parent, `pinv-walk-${runKey}`);
record("customer: made", Boolean(customerId), `id ${customerId}`);
const again: string = await parentCustomerId(company, parent, `pinv-walk-${runKey}-again`);
record("customer: the same parent again is the same customer", again === customerId, `${again}`);
const namesake: string = await parentCustomerId(
  company,
  { ...parent, email: `other-${runKey}@example.com` },
  `pinv-walk-${runKey}-namesake`,
);
record("customer: same name, other email is someone else", namesake !== customerId, `${namesake}`);

// --- the invoice ------------------------------------------------------------------
const invoice = await createParentInvoiceAt(company, {
  customerId,
  email: parent.email,
  participantId: `walk-${runKey}`,
  amountCents: 4500,
  athleteName: "Mia Walk",
  packageName: "Digital set",
  eventName: "Sandbox Cheer Classic",
  requestId: `pinv-walk-${runKey}-1`,
});
const invoiceId = String(invoice.Id ?? "");
const total = Math.round(Number(invoice.TotalAmt) * 100);
const tax = Math.round(Number((invoice.TxnTaxDetail as { TotalTax?: number } | undefined)?.TotalTax ?? 0) * 100);
record("invoice: made", Boolean(invoiceId), `id ${invoiceId}, doc ${String(invoice.DocNumber ?? "-")}`);
record("invoice: $45 and no sales tax on it", total === 4500 && tax === 0, `total ${total}¢, tax ${tax}¢`);
record("invoice: billed to the parent", String((invoice.BillEmail as { Address?: string } | undefined)?.Address) === parent.email, String((invoice.BillEmail as { Address?: string } | undefined)?.Address));
const line = ((invoice.Line as Array<Record<string, unknown>>) ?? []).find((entry) => entry.DetailType === "SalesItemLineDetail") ?? {};
record("invoice: one line naming the athlete and package", String(line.Description ?? "").includes("Mia Walk — Digital set"), String(line.Description ?? ""));

const read = await readParentInvoiceAt(company, invoiceId);
record("read back: owed in full", Math.round(Number(read.Balance) * 100) === 4500, `balance ${read.Balance}`);

// --- withdrawn ----------------------------------------------------------------------
const voided = await voidParentInvoiceAt(company, invoiceId, `pinv-walk-${runKey}-void`);
const after = await readParentInvoiceAt(company, invoiceId);
record("void: withdrawn", voided === "voided" && Number(after.TotalAmt) === 0 && Number(after.Balance) === 0, `${voided}; total ${after.TotalAmt}, balance ${after.Balance}`);
const twice = await voidParentInvoiceAt(company, invoiceId, `pinv-walk-${runKey}-void2`);
record("void: again is already void, not an error", twice === "already_void", twice);

console.log(failed ? `\n${failed} step(s) failed.` : "\nEvery step passed.");
process.exit(failed ? 1 : 0);
