import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { jobBilling } from "../features/billing/job-billing";
import { friendlyError } from "../lib/ai/friendly-error";

/**
 * GR Productions, 2026-10-21: Michelle & Kyle signed, their deposit went out
 * as a StudioCue PDF with no way to pay, and switching the job to QuickBooks
 * left it stuck there. One guard per cause.
 */
const read = (path: string) => readFileSync(path, "utf8");

test("an emailed StudioCue invoice must say how to pay", () => {
  const send = read("functions/src/billing/studio-invoice-send.ts");
  assert.match(send, /input\.via === "email" && !invoicePayLink && !settings\.paymentInstructions\)\s*throw new Error\("STUDIO_INVOICE_NO_WAY_TO_PAY"\)/);
  assert.match(friendlyError(new Error("STUDIO_INVOICE_NO_WAY_TO_PAY"), "x"), /how clients pay you/);
  // The button becomes the way to add them, on Today and the booking page.
  const actions = read("components/booking/studio-invoice-actions.tsx");
  assert.match(actions, /Add how clients pay you/);
  assert.equal(actions.match(/addPaymentDetails\n/g)?.length, 2);
});

test("a QuickBooks studio's unchosen job bills through QuickBooks, whatever another job chose", () => {
  for (const lastChoice of ["studio", "quickbooks", undefined]) {
    assert.equal(jobBilling({ project: {}, quickbooksReady: true, lastChoice }).method, "quickbooks");
  }
  assert.equal(jobBilling({ project: { billing: { method: "studio" } }, quickbooksReady: true }).method, "studio");
  assert.equal(jobBilling({ project: {}, quickbooksReady: false, lastChoice: "quickbooks" }).method, "studio");
});

test("moving a job to QuickBooks voids its unpaid StudioCue bills and raises the deposit there", () => {
  const move = read("functions/src/booking/job-billing-method.ts");
  assert.match(move, /invoiceVoidRefusal\(\(bill\.data\(\) \?\? \{\}\) as CorrectableInvoice\) === null/);
  assert.match(move, /writeInvoiceVoid\(db, transaction, \{\s*invoice: bill,\s*reason: "Moved to QuickBooks"/);
  assert.match(move, /project\.get\("state"\) === "RETAINER_PENDING"/);
  assert.match(move, /type: depositProvider === "stripe" \? "create_stripe_invoice" : "create_quickbooks_invoice"/);
  // Says so first, by number.
  assert.match(read("components/booking/job-billing-choice.tsx"), /confirmLabel="Move it to QuickBooks"/);
});
