import assert from "node:assert/strict";
import { test } from "node:test";
import {
  autopayChargeDue,
  autopayConsentText,
  lastFour,
  paymentsAmount,
  paymentsFailureCode,
  quickBooksPaymentsBaseUrl,
} from "../functions/src/billing/autopay-core.ts";
import { autopayStudioState, QUICKBOOKS_PAYMENTS_SCOPE } from "@/features/billing/autopay";
import { QUICKBOOKS_PAYMENTS_SCOPE as FUNCTIONS_SCOPE } from "../functions/src/billing/autopay-core.ts";

const invoice = { kind: "final", status: "sent", balanceCents: 250000, dueDate: "2026-10-01", provider: "quickbooks" };

test("the final balance is charged on or after its due date, once", () => {
  assert.deepEqual(autopayChargeDue({ invoice, attempts: [], today: "2026-09-30" }), { due: false, reason: "not_yet_due" });
  assert.deepEqual(autopayChargeDue({ invoice, attempts: [], today: "2026-10-01" }), { due: true, attempt: 1 });
  assert.equal(
    autopayChargeDue({ invoice, attempts: [{ attempt: 1, status: "succeeded", createdAt: "2026-10-01T15:00:00Z" }], today: "2026-10-02" }).due,
    false,
  );
});

test("a declined card is retried once, three days later, and never again", () => {
  const failed = { attempt: 1, status: "failed" as const, createdAt: "2026-10-01T15:00:00Z" };
  assert.deepEqual(autopayChargeDue({ invoice, attempts: [failed], today: "2026-10-03" }), { due: false, reason: "waiting_to_retry" });
  assert.deepEqual(autopayChargeDue({ invoice, attempts: [failed], today: "2026-10-04" }), { due: true, attempt: 2 });
  assert.deepEqual(
    autopayChargeDue({ invoice, attempts: [failed, { attempt: 2, status: "failed", createdAt: "2026-10-04T15:00:00Z" }], today: "2026-10-20" }),
    { due: false, reason: "attempts_exhausted" },
  );
});

test("only unpaid QuickBooks final balances are charged", () => {
  assert.equal(autopayChargeDue({ invoice: { ...invoice, kind: "retainer" }, attempts: [], today: "2026-11-01" }).due, false);
  assert.equal(autopayChargeDue({ invoice: { ...invoice, status: "paid" }, attempts: [], today: "2026-11-01" }).due, false);
  assert.equal(autopayChargeDue({ invoice: { ...invoice, balanceCents: 0 }, attempts: [], today: "2026-11-01" }).due, false);
  assert.equal(autopayChargeDue({ invoice: { ...invoice, provider: "stripe" }, attempts: [], today: "2026-11-01" }).due, false);
  assert.equal(autopayChargeDue({ invoice: { ...invoice, status: "overdue" }, attempts: [], today: "2026-11-01" }).due, true);
});

test("Payments API details", () => {
  assert.equal(quickBooksPaymentsBaseUrl("https://sandbox-quickbooks.api.intuit.com"), "https://sandbox.api.intuit.com");
  assert.equal(quickBooksPaymentsBaseUrl(undefined), "https://api.intuit.com");
  assert.equal(paymentsAmount(250050), "2500.50");
  assert.equal(lastFour("xxxxxxxxxxxx4242"), "4242");
  assert.equal(paymentsFailureCode(403, "{}"), "QUICKBOOKS_PAYMENTS_NOT_ACTIVE");
  assert.equal(paymentsFailureCode(400, "card declined"), "CARD_DECLINED");
  assert.match(autopayConsentText({ studioName: "Alder & Muse", amount: "$2,500.00", dueDate: "October 1, 2026" }), /Alder & Muse to charge this card \$2,500\.00 for my final balance on October 1, 2026/);
});

test("the studio card walks connect → grant payments → offer", () => {
  assert.equal(FUNCTIONS_SCOPE, QUICKBOOKS_PAYMENTS_SCOPE);
  assert.equal(autopayStudioState({ connection: null, tenant: null, methods: [] }).step, 1);
  const accounting = { status: "connected", scopes: ["com.intuit.quickbooks.accounting"], connectedAt: "2026-09-01" };
  assert.equal(autopayStudioState({ connection: accounting, tenant: { autopay: { enabled: true } }, methods: [] }).step, 2);
  // Enabled on the tenant means nothing without the permission.
  assert.equal(autopayStudioState({ connection: accounting, tenant: { autopay: { enabled: true } }, methods: [] }).enabled, false);
  const payments = { ...accounting, scopes: [...accounting.scopes, QUICKBOOKS_PAYMENTS_SCOPE] };
  const ready = autopayStudioState({
    connection: payments,
    tenant: { autopay: { enabled: true } },
    methods: [
      { status: "active" },
      { status: "failed", failureCode: "QUICKBOOKS_PAYMENTS_NOT_ACTIVE", updatedAt: "2026-08-01" },
    ],
  });
  assert.deepEqual(ready, { step: 3, enabled: true, activeCards: 1, paymentsRefused: false });
});
