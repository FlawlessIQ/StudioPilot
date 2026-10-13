/**
 * Payment-plan invoices against the QuickBooks sandbox
 * (docs/planner-journey-plan.md, Phase 4): an installment, and a final
 * balance that nets billed installments off on its own line — built by the
 * worker's own line code (quickbooks-invoice-plan.ts, quickbooks-final-tax.ts,
 * quickbooks-invoice-lines.ts) and sent to a real (sandbox) company. It proves
 * QuickBooks takes the bodies, that an installment carries no sales tax, and
 * that the final's negative "Installments" line adds up. Never production:
 * it refuses any other API base. Every invoice it makes is voided.
 *
 *   QUICKBOOKS_API_BASE_URL=https://sandbox-quickbooks.api.intuit.com
 *   QUICKBOOKS_SANDBOX_CLIENT_ID / _CLIENT_SECRET / _REALM_ID / _REFRESH_TOKEN
 *   QUICKBOOKS_SANDBOX_TOKEN_FILE   where a rotated refresh token is written
 *
 *   npx tsx scripts/uat/quickbooks-installment-sandbox.mts
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

const { quickBooksLinePayload, quickBooksTaxMode } = await import(`${REPO}/functions/src/operations/quickbooks-invoice-lines.ts`);
const { gatedFinalLines, quickBooksGatedPayload } = await import(`${REPO}/functions/src/operations/quickbooks-final-tax.ts`);
const { installmentName } = await import(`${REPO}/functions/src/billing/payment-plan.ts`);

let failed = 0;
const record = (step: string, ok: boolean, detail: string) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${step} — ${detail}`);
};

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
  const file = process.env.QUICKBOOKS_SANDBOX_TOKEN_FILE ?? "/tmp/studiocue-qbo-sandbox-refresh-token";
  writeFileSync(file, token.refresh_token, { mode: 0o600 });
  console.log(`NOTE  Intuit issued a new refresh token; written to ${file}.`);
}
const company = `${apiBase}/v3/company/${encodeURIComponent(realmId)}`;
async function qbo(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${company}${path}${path.includes("?") ? "&" : "?"}minorversion=75`, {
    ...init,
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}
record("connect", true, `sandbox company ${realmId}`);

const preferences = ((await qbo("/preferences")).Preferences ?? {}) as Record<string, unknown>;
const mode = quickBooksTaxMode(preferences);
const items = (((await qbo(`/query?query=${encodeURIComponent("select * from Item where Type = 'Service' maxresults 1")}`)).QueryResponse as Record<string, unknown>)?.Item ?? []) as Array<Record<string, unknown>>;
const itemRef = { value: String(items[0]?.Id ?? "1"), name: String(items[0]?.Name ?? "Services") };
const customer = ((await qbo("/customer", { method: "POST", body: JSON.stringify({ DisplayName: `Plan Walk ${runKey}`, PrimaryEmailAddr: { Address: `plan-${runKey}@example.com` } }) })).Customer ?? {}) as Record<string, unknown>;
record("customer", Boolean(customer.Id), `id ${customer.Id}; company tax mode ${mode}`);

const made: Array<{ Id: string; SyncToken: string }> = [];
async function create(name: string, payload: { Line: unknown[]; TxnTaxDetail?: unknown }, expectedCents: number) {
  const created = ((await qbo("/invoice", {
    method: "POST",
    body: JSON.stringify({ CustomerRef: { value: String(customer.Id) }, PrivateNote: `StudioCue sandbox ${runKey} ${name}`, Line: payload.Line, ...(payload.TxnTaxDetail ? { TxnTaxDetail: payload.TxnTaxDetail } : {}) }),
  })).Invoice ?? {}) as Record<string, unknown>;
  made.push({ Id: String(created.Id), SyncToken: String(created.SyncToken) });
  const total = Math.round(Number(created.TotalAmt) * 100);
  const tax = Math.round(Number((created.TxnTaxDetail as { TotalTax?: number } | undefined)?.TotalTax ?? 0) * 100);
  record(`${name}: made, ${expectedCents}¢ and no sales tax`, total === expectedCents && tax === 0, `id ${created.Id}, total ${total}¢, tax ${tax}¢`);
  return created;
}

// An installment, as a studio not switched to itemised invoices sends it (one line, no codes)…
const installmentLine = {
  kind: "amount",
  title: installmentName(2, 3),
  description: installmentName(2, 3),
  quantity: 1,
  unitPriceCents: 147_083,
  amountCents: 147_083,
  taxable: false,
};
const plain = await create("installment (plain)", quickBooksLinePayload({ lines: [installmentLine], taxCents: 0, mode: "none", itemRef }), 147_083);
const description = String(((plain.Line as Array<Record<string, unknown>>) ?? [])[0]?.Description ?? "");
record("installment (plain): named", description === "Installment 2 of 3", description);
// …and as a switched-on studio's gated worker sends it: untaxed, every line NON.
await create(
  "installment (itemised studio)",
  quickBooksGatedPayload({ lines: [installmentLine], strategy: { kind: "none" }, companyMode: mode, itemRef }),
  147_083,
);

// A final balance on a $7,500 plan: $1,950 deposit paid, $2,608.33 in two installments billed, $2,941.67 left.
const final = gatedFinalLines({
  amountCents: 294_167,
  preTaxTotalCents: 750_000,
  discountCents: 0,
  items: [{ kind: "package", name: "The Signature Collection", summary: null, inclusions: [], quantity: 1, unitPriceCents: 750_000, amountCents: 750_000, taxable: true }],
  retainerPaidCents: 195_000,
  taxApplies: false,
  installmentsCents: 260_833,
});
record(
  "final: the lines net the installments off on their own line",
  final.lines.some((line: { title: string; amountCents: number }) => line.title === "Installments" && line.amountCents === -260_833),
  final.lines.map((line: { title: string; amountCents: number }) => `${line.title} ${line.amountCents}`).join(" | "),
);
await create("final (itemised studio)", quickBooksGatedPayload({ lines: final.lines, strategy: { kind: "none" }, companyMode: mode, itemRef }), 294_167);

// Withdrawn.
for (const invoice of made) {
  const voided = await qbo("/invoice?operation=void", { method: "POST", body: JSON.stringify({ Id: invoice.Id, SyncToken: invoice.SyncToken }) }).catch((caught: unknown) => ({ error: String(caught) }));
  record(`void ${invoice.Id}`, !("error" in voided), "error" in voided ? String(voided.error).slice(0, 160) : "voided");
}
console.log(failed ? `\n${failed} step(s) failed.` : "\nEvery step passed.");
process.exit(failed ? 1 : 0);
