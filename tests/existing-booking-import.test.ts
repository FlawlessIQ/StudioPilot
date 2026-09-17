import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { balanceFromTotals } from "../features/booking/agreed-final-balance";
import {
  assessExistingBooking,
  balanceOwedCents,
  bookingImportKey,
  clientAutomationsPaused,
  defaultBookingName,
  existingBookingSchema,
  importBlocked,
  planImportedBooking,
  studioVouchedAuthorities,
  type ExistingBooking,
} from "../features/imports/existing-booking";

/**
 * Importing a booking a studio already has.
 *
 * Two things can go wrong, and both are quiet. The import can hold a wrong fact
 * as true — an amount paid that exceeds the contract, a signature dated after
 * the wedding — and every screen downstream will repeat it. Or it can look
 * enough like a live booking that the machinery built for live bookings acts on
 * it: a "You're booked" email to a couple who booked last year, a second
 * invoice for money already billed elsewhere.
 */

const today = "2026-09-17";

const booking = (overrides: Partial<ExistingBooking> = {}): ExistingBooking =>
  existingBookingSchema.parse({
    clients: [
      { firstName: "Maya", lastName: "Johnson", email: "Maya@Example.com", phone: null },
      { firstName: "Theo", lastName: "Johnson", email: null, phone: null },
    ],
    projectName: null,
    eventTypeId: "wedding",
    eventType: "Wedding",
    eventDate: "2027-06-12",
    timezone: "America/New_York",
    venueName: "The Grove",
    city: "Madison",
    state: "BOOKED",
    packageName: "Signature Collection",
    coverageMinutes: 480,
    photographers: 2,
    currency: "usd",
    totalCents: 649_900,
    taxCents: 42_900,
    signedOn: "2026-03-02",
    signerName: "Maya Johnson",
    hasSignedCopy: true,
    payments: [
      { amountCents: 200_000, paidOn: "2026-03-02", method: "Check" },
      { amountCents: 50_000, paidOn: "2026-07-01", method: "Venmo" },
    ],
    notes: null,
    ...overrides,
  });

const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

const context = {
  tenantId: "tenant-a",
  projectId: "project-a",
  packageSnapshotId: "snapshot-a",
  contractId: "contract-a",
  invoiceId: "invoice-a",
  contactIds: ["contact-a"],
  actorId: "owner-a",
  now: "2026-09-17T14:00:00.000Z",
  source: "form" as const,
  batchId: null,
};

test("a complete booking imports with nothing to fix", () => {
  const value = booking();
  assert.equal(value.clients[0]!.email, "maya@example.com", "emails are normalised");
  assert.equal(value.currency, "USD");
  assert.deepEqual(assessExistingBooking(value, today), []);
});

test("every fact that would be held wrong stops the import", () => {
  const cases: Array<[Partial<ExistingBooking>, string]> = [
    [{ eventDate: "2026-02-30" }, "INVALID_DATE"],
    [
      {
        clients: [{ firstName: "Maya", lastName: "Johnson", email: null, phone: null }],
      },
      "PRIMARY_EMAIL_REQUIRED",
    ],
    [
      {
        clients: [
          { firstName: "Maya", lastName: "Johnson", email: "maya@example.com", phone: null },
          { firstName: "Theo", lastName: "Johnson", email: "maya@example.com", phone: null },
        ],
      },
      "DUPLICATE_CLIENT_EMAIL",
    ],
    [{ eventDate: "2026-08-01", signedOn: "2026-03-02" }, "EVENT_ALREADY_HAPPENED"],
    [{ signedOn: "2026-10-01" }, "SIGNED_IN_FUTURE"],
    [{ eventDate: "2026-09-20", signedOn: "2026-09-21" }, "SIGNED_AFTER_EVENT"],
    [
      { payments: [{ amountCents: 1, paidOn: "2026-12-01", method: "Check" }] },
      "PAYMENT_IN_FUTURE",
    ],
    [
      { payments: [{ amountCents: 700_000, paidOn: "2026-03-02", method: "Check" }] },
      "PAID_MORE_THAN_TOTAL",
    ],
    [{ taxCents: 700_000 }, "TAX_EXCEEDS_TOTAL"],
  ];
  for (const [overrides, code] of cases) {
    const issues = assessExistingBooking(booking(overrides), today);
    assert.ok(codes(issues).includes(code), `${code} was not raised`);
    assert.equal(importBlocked(issues), true, `${code} did not block`);
  }
});

test("gaps a studio may knowingly have are warnings, not refusals", () => {
  const issues = assessExistingBooking(
    booking({ payments: [], hasSignedCopy: false }),
    today,
  );
  assert.deepEqual(codes(issues).sort(), ["NO_PAYMENTS_RECORDED", "NO_SIGNED_COPY"]);
  assert.equal(importBlocked(issues), false);
});

test("the records never look like a live booking to the machinery that acts on one", () => {
  const records = planImportedBooking(booking({ state: "PLANNING" }), context);

  // Written BOOKED, entered into PLANNING only once checkpoints exist.
  assert.equal(records.project.state, "BOOKED");
  assert.equal(records.targetState, "PLANNING");

  // Quiet until the studio brings them in.
  assert.equal(clientAutomationsPaused(records.project), true);
  assert.equal(records.project.clientPortalActive, false);

  // The booking side-effects job keys off this; an import has none.
  assert.equal("bookingProviderState" in records.project, false);

  // Evidence says what it is, and counts as a studio's word, never a provider's.
  assert.equal(records.contract.completionAuthority, "imported");
  assert.equal(records.contract.status, "completed");
  assert.ok(studioVouchedAuthorities.includes("imported"));

  // No provider customer means the final-invoice scheduler never raises a
  // second invoice for something billed elsewhere.
  assert.equal(records.paidInvoice?.providerCustomerId, null);
  assert.equal(records.paidInvoice?.providerInvoiceId, null);
  assert.equal(records.paidInvoice?.completionAuthority, "imported");
});

test("what was paid before StudioCue leaves exactly the right balance", () => {
  const value = booking();
  const records = planImportedBooking(value, context);
  // $2,000 + $500 already paid against $6,499.
  assert.equal(records.paidInvoice?.amountCents, 250_000);
  assert.equal(records.paidInvoice?.status, "paid");
  assert.equal(records.paidInvoice?.balanceCents, 0);
  assert.equal(records.paidInvoice?.paidAt, "2026-07-01T00:00:00.000Z");
  assert.equal(records.packageSnapshot.retainerCents, 250_000);
  // The final balance is computed downstream as total less paid retainers —
  // recordFinalPayment uses exactly this.
  assert.equal(
    balanceFromTotals(
      Number(records.packageSnapshot.totalCents),
      Number(records.paidInvoice?.amountCents),
    ),
    balanceOwedCents(value),
  );
  assert.equal(balanceOwedCents(value), 399_900);

  // Nothing paid means no paid record, and the whole total is owed.
  const unpaid = planImportedBooking(booking({ payments: [] }), context);
  assert.equal(unpaid.paidInvoice, null);
  assert.equal(unpaid.packageSnapshot.retainerCents, 0);
});

test("the contract as signed is kept, not the studio's current catalogue", () => {
  const records = planImportedBooking(booking(), context);
  assert.equal(records.packageSnapshot.packageId, "imported");
  assert.equal(records.packageSnapshot.packageName, "Signature Collection");
  assert.equal(records.packageSnapshot.totalCents, 649_900);
  assert.equal(records.packageSnapshot.subtotalCents, 607_000);
  assert.equal(records.packageSnapshot.includedPhotographers, 2);
  assert.equal(records.packageSnapshot.includedCoverageMinutes, 480);
  assert.equal(records.project.bookingCompletedAt, "2026-03-02T00:00:00.000Z");
});

test("a booking is named from the couple, and keyed so it can't be imported twice", () => {
  assert.equal(defaultBookingName(booking().clients), "Maya & Theo Johnson");
  assert.equal(
    defaultBookingName([
      { firstName: "Maya", lastName: "Johnson", email: null, phone: null },
      { firstName: "Theo", lastName: "Reed", email: null, phone: null },
    ]),
    "Maya Johnson & Theo Reed",
  );
  assert.equal(planImportedBooking(booking(), context).project.name, "Maya & Theo Johnson");
  assert.equal(
    bookingImportKey(booking()),
    bookingImportKey(
      booking({
        clients: [{ firstName: "M", lastName: "J", email: "MAYA@example.com ", phone: null }],
      }),
    ),
  );
});

test("a project is quiet only when it says so", () => {
  assert.equal(clientAutomationsPaused({ clientAutomationsPausedAt: "2026-09-17T00:00:00Z" }), true);
  assert.equal(clientAutomationsPaused({ clientAutomationsPausedAt: null }), false);
  assert.equal(clientAutomationsPaused({}), false);
  assert.equal(clientAutomationsPaused(undefined), false);
});

test("features/ and functions/ import bookings identically", () => {
  assert.equal(
    readFileSync("functions/src/imports/existing-booking.ts", "utf8"),
    readFileSync("features/imports/existing-booking.ts", "utf8"),
    "the copy the command runs has drifted from the tested one",
  );
});
