import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bookingSteps } from "@/features/client/booking-steps";
import {
  QUICKBOOKS_NO_PAY_LINK_NOTE,
  invoicePayNote,
  invoicePayRoute,
  invoiceRaisedAtProvider,
  quickBooksInvoiceWithoutPayLink,
} from "@/features/client/invoice-pay-route";

/**
 * "Retainer looks frozen" (GR Productions, 2026-10-01): QuickBooks made the
 * retainer, gave no pay link (no online payments on the company), and the
 * couple portal said "being prepared" / "still syncing" forever.
 */

// The record as it stood on prod.
const grRetainer = {
  kind: "retainer",
  provider: "quickbooks",
  providerState: "completed",
  status: "sent",
  providerInvoiceId: "19239",
  hostedUrl: null,
  balanceCents: 500,
  amountCents: 500,
};

test("an invoice QuickBooks made is in the studio's books; a placeholder is not", () => {
  assert.equal(invoiceRaisedAtProvider(grRetainer), true);
  for (const providerInvoiceId of ["qbo_invoice_invoice_auto_x", "stripe_invoice_x", "pending_x", "", null])
    assert.equal(invoiceRaisedAtProvider({ providerState: "completed", providerInvoiceId }), false);
  assert.equal(invoiceRaisedAtProvider({ providerState: "queued", providerInvoiceId: "19239" }), false);
});

test("pay route: online with a link, direct when raised without one, preparing otherwise", () => {
  assert.equal(invoicePayRoute({ hostedUrl: "https://pay.example", atProvider: true }), "online");
  assert.equal(invoicePayRoute({ hostedUrl: null, atProvider: true }), "direct");
  assert.equal(invoicePayRoute({ hostedUrl: null, atProvider: false }), "preparing");
  // A portal response from before the field existed reads as still being made.
  assert.equal(invoicePayRoute({ hostedUrl: null }), "preparing");
});

test("home: a raised retainer with no pay link is ready, not being prepared", () => {
  const view = bookingSteps({
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainer: { status: "sent", balanceCents: 500, hostedUrl: null, atProvider: true },
  });
  assert.equal(view.next.title, "Your deposit invoice is ready");
  assert.doesNotMatch(view.next.detail, /prepared|shortly|syncing|in a moment/);
  assert.match(view.next.detail, /directly/);
  assert.equal(view.next.href, "/client/payments");
  assert.equal(view.steps[2]?.state, "current");
  assert.equal(view.booked, false);
});

test("home: a retainer still being created keeps its waiting wording", () => {
  const view = bookingSteps({
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainer: { status: "sent", balanceCents: 500, hostedUrl: null, atProvider: false },
  });
  assert.match(view.next.title, /being prepared/);
  assert.equal(view.next.href, null);
  assert.equal(view.steps[2]?.state, "waiting");
});

test("home: a pay link still means pay online", () => {
  const view = bookingSteps({
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainer: { status: "sent", balanceCents: 500, hostedUrl: "https://pay.example", atProvider: true },
  });
  assert.equal(view.next.actionLabel, "Pay deposit");
});

test("payments: the direct note says ready, names the studio, and never says syncing", () => {
  const note = invoicePayNote("direct", { studioName: "GR Productions", invoiceName: "Retainer", providerName: "QuickBooks" });
  assert.equal(
    note,
    "Your retainer invoice is ready. GR Productions takes this payment directly — by check, cash or bank transfer. Message GR Productions to arrange it.",
  );
  assert.doesNotMatch(note, /sync|prepar|QuickBooks|provider/i);
  const unnamed = invoicePayNote("direct", { studioName: null, invoiceName: "Final balance", providerName: null });
  assert.match(unnamed, /^Your final balance invoice is ready\. Your studio takes this payment directly/);
  assert.match(invoicePayNote("preparing", { studioName: null, invoiceName: "Retainer", providerName: null }), /syncing/);
});

test("studio: a QuickBooks invoice without a pay link is flagged, with the way through", () => {
  assert.equal(quickBooksInvoiceWithoutPayLink(grRetainer), true);
  assert.equal(quickBooksInvoiceWithoutPayLink({ ...grRetainer, hostedUrl: "https://pay.example" }), false);
  assert.equal(quickBooksInvoiceWithoutPayLink({ ...grRetainer, balanceCents: 0 }), false);
  assert.equal(quickBooksInvoiceWithoutPayLink({ ...grRetainer, providerState: "queued" }), false);
  assert.equal(quickBooksInvoiceWithoutPayLink({ ...grRetainer, provider: "stripe" }), false);
  assert.match(QUICKBOOKS_NO_PAY_LINK_NOTE, /QuickBooks Payments/);
  assert.match(QUICKBOOKS_NO_PAY_LINK_NOTE, /record a check or cash payment/);
});

test("the portal tells the couple whether the invoice exists, as a yes/no", () => {
  const route = readFileSync("app/api/client/portal/route.ts", "utf8");
  assert.match(route, /sanitized\.atProvider = invoiceRaisedAtProvider\(value\)/);
  const fields = route.slice(route.indexOf("  invoiceReferences: ["), route.indexOf("  questionnaireResponses: ["));
  assert.doesNotMatch(fields, /"providerState"|"providerInvoiceId"/);
});

test("the payments page and the studio page use the shared decision", () => {
  const payments = readFileSync("components/client/kit/client-payments.tsx", "utf8");
  assert.match(payments, /invoicePayRoute\(/);
  assert.match(payments, /invoicePayNote\(/);
  assert.doesNotMatch(payments, /Secure payment link is still syncing/);
  const studio = readFileSync("components/booking/project-booking-workspace.tsx", "utf8");
  assert.match(studio, /quickBooksInvoiceWithoutPayLink\(invoice\)/);
  assert.match(studio, /QUICKBOOKS_NO_PAY_LINK_NOTE/);
});

test("QuickBooks invoices are created with online card and bank payment allowed", () => {
  const runtime = readFileSync("functions/src/operations/provider-runtime.ts", "utf8");
  assert.match(runtime, /AllowOnlineCreditCardPayment:\s*true/);
  assert.match(runtime, /AllowOnlineACHPayment:\s*true/);
  const create = runtime.slice(runtime.indexOf("export async function createQuickBooksInvoice"));
  const body = create.slice(create.indexOf('"QUICKBOOKS_CREATE_FAILED"') - 2000, create.indexOf('"QUICKBOOKS_CREATE_FAILED"'));
  assert.match(body, /\.\.\.\(online\?QUICKBOOKS_ONLINE_PAYMENT_FLAGS:\{\}\)/);
  // A company that refused the flags still gets its invoice: a 400 created
  // nothing, so it is asked once more without them, under its own request id
  // (and, after that, without tax codes — quickbooks-invoice-lines.test.ts).
  assert.match(create, /const refused=\(error:unknown\)=>String\(\(error as Error\)\?\.message\?\?""\)\.startsWith\("QUICKBOOKS_CREATE_FAILED:400:"\)/);
  assert.match(create, /createInvoice\(true,taxMode,""\)\.catch\(\(error:unknown\)=>\{if\(refused\(error\)\)return createInvoice\(false,taxMode,":offline"\);throw error;\}\)/);
  assert.match(create, /"request-id":`\$\{requestId\}\$\{suffix\}`/);
});
