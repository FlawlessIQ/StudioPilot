import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  BALANCE_ATTESTABLE_STATES,
  balanceFromTotals,
  balanceMayBeAttested,
  finalBalanceFromSchedule,
} from "@/features/booking/agreed-final-balance";

/**
 * The wall the walk of 2026-08-27 ended on: a delivered, reviewed job whose
 * couple had paid by transfer could not be closed, because the only thing that
 * could satisfy "Final QuickBooks balance settled" was an invoice a scheduler
 * raises 28 days before the event.
 */

test("the accepted proposal's schedule decides the balance", () => {
  const schedule = [
    { label: "Retainer", amountCents: 195000 },
    { label: "Final balance", amountCents: 455000 },
  ];
  assert.equal(finalBalanceFromSchedule(schedule, 999999), 455000);
});

test("a studio that renamed the closing payment is still understood", () => {
  for (const label of ["Balance", "Final payment"]) {
    assert.equal(
      finalBalanceFromSchedule([{ label, amountCents: 12345 }], 999),
      12345,
    );
  }
});

test("zero is a real balance, not a missing one", () => {
  // A couple who paid in full up front owes nothing, and that must not fall
  // back to the package total.
  assert.equal(
    finalBalanceFromSchedule([{ label: "Final balance", amountCents: 0 }], 650000),
    0,
  );
});

test("a missing or nonsensical figure falls back", () => {
  assert.equal(finalBalanceFromSchedule(null, 455000), 455000);
  assert.equal(finalBalanceFromSchedule([], 455000), 455000);
  assert.equal(
    finalBalanceFromSchedule([{ label: "Final balance" }], 455000),
    455000,
  );
  assert.equal(
    finalBalanceFromSchedule(
      [{ label: "Final balance", amountCents: -5 }],
      455000,
    ),
    455000,
  );
});

test("the fallback is the total less what the retainer collected", () => {
  assert.equal(balanceFromTotals(650000, 195000), 455000);
  assert.equal(balanceFromTotals(650000, 0), 650000);
  // A retainer larger than the total is a data problem, not a refund.
  assert.equal(balanceFromTotals(100000, 195000), 0);
  assert.equal(balanceFromTotals(-1, 0), 0);
});

test("the balance may be attested from booking onward, never before or after", () => {
  for (const state of ["BOOKED", "READY", "DELIVERED", "REVIEW_REQUESTED"]) {
    assert.equal(balanceMayBeAttested(state), true, state);
  }
  // Nothing is owed on a job that is not real yet, and recording money against
  // a cancelled or closed job records it against nothing.
  for (const state of [
    "LEAD",
    "PROPOSAL",
    "CONTRACT_PENDING",
    "RETAINER_PENDING",
    "CANCELLED",
    "ARCHIVED",
  ]) {
    assert.equal(balanceMayBeAttested(state), false, state);
  }
  assert.equal(BALANCE_ATTESTABLE_STATES.includes("CLOSED"), false);
});

test("the functions copy has not drifted from the features copy", () => {
  // functions/ cannot import from features/, so the rule is duplicated. The two
  // disagreeing means the figure a studio is shown and the figure recorded
  // against the job are different figures.
  const strip = (source: string) =>
    source
      .replace(/\/\*\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ")
      .trim();
  assert.equal(
    strip(readFileSync("features/booking/agreed-final-balance.ts", "utf8")),
    strip(readFileSync("functions/src/booking/agreed-final-balance.ts", "utf8")),
  );
});
