import assert from "node:assert/strict";
import { test } from "node:test";
import { bookingSteps } from "@/features/client/booking-steps";

test("an open proposal is the couple's first step", () => {
  const view = bookingSteps({ proposalStatus: "sent", contractStatus: null, retainer: null });
  assert.equal(view.steps[0]?.state, "current");
  assert.equal(view.steps[1]?.state, "upcoming");
  assert.equal(view.next.href, "/client/proposal");
  assert.equal(view.booked, false);
});

test("after accepting, the couple is told the agreement is coming, not left at a dead end", () => {
  const view = bookingSteps({ proposalStatus: "accepted", contractStatus: null, retainer: null });
  assert.equal(view.steps[0]?.state, "done");
  assert.equal(view.steps[1]?.state, "waiting");
  assert.match(view.next.title, /on its way/);
  assert.equal(view.next.href, null);
});

test("a sent agreement asks for a signature", () => {
  const view = bookingSteps({ proposalStatus: "accepted", contractStatus: "sent", retainer: null });
  assert.equal(view.steps[1]?.state, "current");
  assert.equal(view.next.href, "/client/contract");
});

test("signed with a payable invoice points at the deposit", () => {
  const view = bookingSteps({
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainer: { status: "sent", balanceCents: 100_000, hostedUrl: "https://quickbooks.example/pay" },
  });
  assert.equal(view.steps[2]?.state, "current");
  assert.equal(view.next.href, "/client/payments");
});

test("signed but the invoice is still syncing is a wait, not an action", () => {
  const view = bookingSteps({
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainer: { status: "queued", balanceCents: 100_000, hostedUrl: null },
  });
  assert.equal(view.steps[2]?.state, "waiting");
  assert.equal(view.next.href, null);
});

test("signed and paid is booked", () => {
  const view = bookingSteps({
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainer: { status: "paid", balanceCents: 0, hostedUrl: null },
  });
  assert.equal(view.booked, true);
  assert.ok(view.steps.every((step) => step.state === "done"));
});
