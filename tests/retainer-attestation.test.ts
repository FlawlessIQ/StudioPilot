import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planRetainerAttestation,
  type RetainerInvoiceRow,
} from "@/features/booking/retainer-attestation";

/**
 * A studio whose couple paid by bank transfer could not book the job: the
 * retainer step refused with RETAINER_INVOICE_ALREADY_EXISTS and the only way
 * on was a QuickBooks webhook for money that never went through QuickBooks.
 *
 * The rule is one retainer, one record. Settle the invoice that exists rather
 * than writing a second one beside it.
 */

const row = (over: Partial<RetainerInvoiceRow>): RetainerInvoiceRow => ({
  id: "inv-1",
  status: "sent",
  balanceCents: 268500,
  ...over,
});

test("with no invoice at all, an attested one is written", () => {
  assert.deepEqual(planRetainerAttestation([]), { action: "create" });
});

test("an invoice out with the client is the record that gets settled", () => {
  assert.deepEqual(planRetainerAttestation([row({ id: "inv-qb" })]), {
    action: "settle",
    invoiceId: "inv-qb",
  });
});

test("a retried attestation is a no-op, not a failure", () => {
  // Two people recording the same cheque must not produce an error after the
  // first one worked.
  assert.deepEqual(
    planRetainerAttestation([row({ id: "inv-qb", status: "paid", balanceCents: 0 })]),
    { action: "already_paid", invoiceId: "inv-qb" },
  );
});

test("a paid invoice wins over an outstanding one", () => {
  // The money is in. Nothing further should be written just because a stale
  // duplicate is also standing.
  assert.deepEqual(
    planRetainerAttestation([
      row({ id: "inv-stale" }),
      row({ id: "inv-paid", status: "paid", balanceCents: 0 }),
    ]),
    { action: "already_paid", invoiceId: "inv-paid" },
  );
});

test("failed, superseded and voided invoices do not block a fresh attestation", () => {
  for (const status of ["failed", "superseded", "voided"]) {
    assert.deepEqual(
      planRetainerAttestation([row({ status })]),
      { action: "create" },
      `${status} should not stand in the way`,
    );
  }
});

test("a paid invoice with a balance still owing is not settled", () => {
  // Part-paid is not paid. It is still the invoice to settle.
  assert.deepEqual(
    planRetainerAttestation([row({ id: "inv-part", status: "paid", balanceCents: 5000 })]),
    { action: "settle", invoiceId: "inv-part" },
  );
});
