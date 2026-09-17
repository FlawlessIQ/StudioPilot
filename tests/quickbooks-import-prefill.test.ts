import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assessExistingBooking,
  existingBookingSchema,
  type ExistingBooking,
} from "../features/imports/existing-booking";
import {
  applyQuickBooksPayments,
  type QuickBooksClientHistory,
} from "../features/imports/quickbooks-prefill";

/**
 * QuickBooks as the source of what an imported couple has paid.
 *
 * The prefill replaces figures typed from a spreadsheet with the payments
 * QuickBooks recorded. What must never happen is that it quietly imports a
 * returning client's payments for an earlier job as payments for this one —
 * so the caveat is always said, and the import's own check still stands
 * between an over-large total and the books.
 */

const booking = (overrides: Partial<ExistingBooking> = {}) =>
  existingBookingSchema.parse({
    clients: [
      { firstName: "Maya", lastName: "Johnson", email: "maya@example.com", phone: null },
      { firstName: "Theo", lastName: "Johnson", email: "theo@example.com", phone: null },
    ],
    projectName: null,
    eventTypeId: "wedding",
    eventType: "Wedding",
    eventDate: "2027-06-12",
    timezone: "UTC",
    venueName: null,
    city: null,
    state: "BOOKED",
    packageName: "Signature",
    coverageMinutes: 480,
    photographers: 2,
    currency: "USD",
    totalCents: 649_900,
    taxCents: 0,
    signedOn: "2026-03-02",
    signerName: "Maya Johnson",
    hasSignedCopy: false,
    payments: [{ amountCents: 100, paidOn: "2026-03-02", method: "Typed from the sheet" }],
    notes: null,
    ...overrides,
  });

const history = (overrides: Partial<QuickBooksClientHistory> = {}): QuickBooksClientHistory => ({
  email: "maya@example.com",
  customer: { id: "58", name: "Maya Johnson" },
  invoicedCents: 649_900,
  openCents: 399_900,
  invoiceCount: 2,
  payments: [
    { id: "p1", amountCents: 200_000, paidOn: "2026-03-02" },
    { id: "p2", amountCents: 50_000, paidOn: "2026-07-01" },
  ],
  ...overrides,
});

test("QuickBooks payments replace what was typed, and the caveat is always said", () => {
  const result = applyQuickBooksPayments(booking(), [history()]);
  assert.equal(result.applied, true);
  assert.deepEqual(result.booking.payments, [
    { amountCents: 200_000, paidOn: "2026-03-02", method: "QuickBooks payment" },
    { amountCents: 50_000, paidOn: "2026-07-01", method: "QuickBooks payment" },
  ]);
  assert.ok(result.notes[0]!.includes("check these are all for this wedding"));
  assert.ok(result.notes.some((note) => note.includes("still open")));
});

test("the partner's email finds the customer when the primary's doesn't", () => {
  const result = applyQuickBooksPayments(booking(), [
    history({ email: "maya@example.com", customer: null, payments: [] }),
    history({ email: "theo@example.com" }),
  ]);
  assert.equal(result.applied, true);
});

test("no customer, or no payments, leaves what the studio entered untouched", () => {
  for (const histories of [
    [history({ customer: null, payments: [] })],
    [history({ payments: [] })],
    [],
  ]) {
    const result = applyQuickBooksPayments(booking(), histories);
    assert.equal(result.applied, false);
    assert.deepEqual(result.booking.payments, booking().payments);
    assert.equal(result.notes.length, 1);
  }
});

test("a returning client's older payments can't slip through as this booking's", () => {
  // Payments for last year's engagement shoot and this wedding, together
  // more than this contract.
  const result = applyQuickBooksPayments(booking({ totalCents: 300_000 }), [
    history({
      payments: [
        { id: "old", amountCents: 150_000, paidOn: "2025-05-01" },
        { id: "p1", amountCents: 200_000, paidOn: "2026-03-02" },
      ],
    }),
  ]);
  const errors = assessExistingBooking(result.booking, "2026-09-17").filter(
    (issue) => issue.severity === "error",
  );
  assert.deepEqual(errors.map((issue) => issue.code), ["PAID_MORE_THAN_TOTAL"]);
});

test("the lookup reads QuickBooks and writes nothing to it", () => {
  const source = readFileSync("functions/src/operations/provider-runtime.ts", "utf8");
  const start = source.indexOf("export async function quickBooksPaymentHistory(");
  assert.ok(start >= 0, "the lookup is gone");
  const body = source.slice(start);
  assert.doesNotMatch(body, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(body, /\.(set|update|create)\(/);
  const command = readFileSync("functions/src/imports/commands.ts", "utf8");
  const lookup = command.slice(command.indexOf("export async function lookupQuickBooksPayments("));
  assert.match(lookup, /requireImportRole\(input\.membership\)/);
});
