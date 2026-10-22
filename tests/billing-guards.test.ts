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

test("QuickBooks invoices offer bank transfer only unless the studio turns card on", async () => {
  const settings = await import("../features/billing/sales-tax-settings");
  const flags = (raw: unknown) => settings.quickBooksOnlinePaymentFlags(settings.normaliseBillingSettings(raw, "t").quickbooksPayMethods);
  assert.deepEqual(flags(null), { AllowOnlineCreditCardPayment: false, AllowOnlineACHPayment: true });
  assert.deepEqual(flags({ quickbooksPayMethods: { card: true, bank: true } }), { AllowOnlineCreditCardPayment: true, AllowOnlineACHPayment: true });
  assert.deepEqual(flags({ quickbooksPayMethods: { card: true, bank: false } }), { AllowOnlineCreditCardPayment: true, AllowOnlineACHPayment: false });
  // Never neither: an invoice with no online method has no pay link.
  assert.deepEqual(flags({ quickbooksPayMethods: { card: false, bank: false } }), { AllowOnlineCreditCardPayment: false, AllowOnlineACHPayment: true });
  // Every path that creates one reads the studio's choice.
  for (const path of ["functions/src/operations/provider-runtime.ts", "functions/src/operations/quickbooks-held-invoice.ts", "functions/src/group-events/participant-invoices.ts"])
    assert.doesNotMatch(read(path), /AllowOnlineCreditCardPayment: ?true|QUICKBOOKS_ONLINE_PAYMENT_FLAGS/, path);
});

test("QuickBooks lines use the studio's word, and a job paid in one bill says so", async () => {
  const { quickBooksRetainerLines, wordInvoiceLines, DEFAULT_BILL_WORDS } = await import("../functions/src/operations/quickbooks-invoice-lines.ts");
  const item = { kind: "package" as const, name: "Corporate Photo and Video", summary: null, inclusions: [], quantity: 1, unitPriceCents: 260_000, amountCents: 260_000, taxable: true };
  const lines = quickBooksRetainerLines({ amountCents: 100_000, items: [item], parts: [], taxApplies: false });
  const first = (words: Parameters<typeof wordInvoiceLines>[1]) => wordInvoiceLines(lines, words)[0]!;
  // GR's weddings: unchanged.
  assert.deepEqual(wordInvoiceLines(lines, DEFAULT_BILL_WORDS), lines);
  assert.equal(first(DEFAULT_BILL_WORDS).description, "Retainer");
  // A DJ, a makeup artist, a hair stylist.
  assert.equal(first({ deposit: "Deposit", paidInFull: false }).description, "Deposit");
  // Access Self Storage, 2026-10-21: the whole price in one bill.
  assert.equal(first({ deposit: "Retainer", paidInFull: true }).description, "Payment in full");
  assert.equal(first({ deposit: "Retainer", paidInFull: true }).amountCents, lines[0]!.amountCents);
  // The final's credit follows the word.
  const credit = [{ kind: "retainer_received", title: "Retainer received", description: "Retainer received — thank you", quantity: 1, unitPriceCents: -1, amountCents: -1, taxable: false }] as never;
  assert.equal(wordInvoiceLines(credit, { deposit: "Deposit", paidInFull: false })[0]!.description, "Deposit received — thank you");
  // Every QuickBooks invoice goes through the words.
  assert.match(read("functions/src/operations/quickbooks-invoice-plan.ts"), /lines: wordInvoiceLines\(plan\.lines, await billWords\(db, invoice\)\)/);
});
