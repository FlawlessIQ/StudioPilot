import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { currentFinalInvoice, outstandingFinalBalance } from "@/features/booking/final-balance-due";
import { todayInbox } from "@/features/today/inbox";

/**
 * The final balance, when nothing billed it (2026-09-30).
 *
 * The scheduler raises a final invoice on one day — 28 days before the
 * wedding — and only when the retainer carries an invoicing customer. A job
 * booked or moved inside that window, or whose retainer was recorded by hand
 * (Rivera, on production), was never billed, while Today said "Send final
 * invoice" and linked to a page that said "No final invoice is due".
 */

const read = (path: string) => readFileSync(path, "utf8");

const rivera = {
  proposals: [
    { id: "old", projectId: "p1", status: "superseded", version: 1, pricingSnapshot: { totalCents: 459_900 } },
    {
      id: "amend",
      projectId: "p1",
      status: "accepted",
      version: 2,
      pricingSnapshot: { totalCents: 759_900 },
      paymentSchedule: [
        { label: "Retainer", amountCents: 137_970, dueDate: "2026-09-01" },
        { label: "Final balance", amountCents: 621_930, dueDate: "2026-10-08" },
      ],
    },
  ],
  invoices: [
    { id: "ret", projectId: "p1", kind: "retainer", status: "paid", amountCents: 137_970, balanceCents: 0 },
    // Replaced by a booking change: not owed, not paid.
    { id: "old-final", projectId: "p1", kind: "final", status: "superseded", amountCents: 321_930, balanceCents: 321_930 },
  ],
};

test("what's left is the agreed total less what was paid on bills still standing", () => {
  const due = outstandingFinalBalance({ projectId: "p1", ...rivera });
  assert.deepEqual(due, { cents: 621_930, dueDate: "2026-10-08", finalStanding: false });
  const billed = outstandingFinalBalance({
    projectId: "p1",
    proposals: rivera.proposals,
    invoices: [...rivera.invoices, { id: "f2", projectId: "p1", kind: "final", status: "sent", amountCents: 621_930, balanceCents: 621_930 }],
  });
  assert.equal(billed.finalStanding, true);
  const paidUp = outstandingFinalBalance({
    projectId: "p1",
    proposals: rivera.proposals,
    invoices: [...rivera.invoices, { id: "f2", projectId: "p1", kind: "final", status: "paid", amountCents: 621_930, balanceCents: 0 }],
  });
  assert.equal(paidUp.cents, null);
});

test("Today's 'send final invoice' step is a card that sends it, not a link to a page that can't", () => {
  const inbox = todayInbox({
    now: "2026-09-30T12:00:00Z",
    projects: [{ id: "p1", name: "Alex & Sam Rivera wedding", state: "BOOKED", eventDate: "2026-10-22", packageSnapshotId: "snap1", archivedAt: null }],
    proposals: rivera.proposals,
    invoiceReferences: rivera.invoices,
    journeys: [
      {
        stepKey: "final_balance",
        projectId: "p1",
        projectName: "Alex & Sam Rivera wedding",
        eventDate: "2026-10-22",
        state: "BOOKED",
        stepTitle: "Final balance",
        stepDetail: "Total − retainer, computed exactly · one month out",
        owner: "studio",
        actionLabel: "Send final invoice",
        actionHref: "/studio/invoices?project=p1",
        updatedAt: "2026-09-30T11:00:00Z",
      },
    ],
  });
  const card = inbox.act.find((item) => item.id === "journey-p1");
  assert.ok(card, "the card");
  assert.equal(card!.title, "Bill Alex & Sam Rivera's final balance · $6,219.30");
  assert.match(card!.detail, /^Due Oct 8, 2026\. Nothing has billed it yet/);
  assert.deepEqual(card!.action, {
    kind: "final_balance",
    label: "Send the final bill",
    projectId: "p1",
    packageSnapshotId: "snap1",
    balanceCents: 621_930,
  });
  // A superseded final is not an overdue balance.
  assert.ok(!inbox.act.concat(inbox.approve ?? []).some((item) => item.id === "invoice-old-final"));
});

test("sending by hand resolves the customer; the scheduler still never bills anyone new", () => {
  const raise = read("functions/src/booking/final-invoice.ts");
  assert.match(raise, /else if \(options\.resolveCustomer\) customerId = `pending_\$\{project\.id\}`;/);
  assert.match(raise, /type: provider === "stripe" \? "create_stripe_invoice" : "create_quickbooks_invoice"/);
  assert.doesNotMatch(raise, /provider: "quickbooks",/);
  assert.doesNotMatch(read("functions/src/operations/invoice-scheduler.ts"), /resolveCustomer/);
  assert.doesNotMatch(read("functions/src/booking/amendment-apply.ts"), /resolveCustomer/);
  const send = read("functions/src/booking/send-final-balance.ts");
  assert.match(send, /resolveCustomer: true/);
  assert.match(send, /\["studio_owner", "studio_admin"\]\.includes\(input\.role\)/);
  assert.match(send, /connection\.get\("status"\) === "connected"/);
  assert.match(read("functions/src/booking/commands.ts"), /command\.type === "sendFinalBalance"/);
});

test("a final bill reaches the couple as a final bill, not a retainer", () => {
  const runtime = read("functions/src/operations/provider-runtime.ts");
  assert.match(runtime, /type:input\.kind==="final"\?"final_invoice":"retainer_invoice"/);
  assert.match(runtime, /kind:String\(invoice\.get\("kind"\)\?\?""\)/);
});

test("every place that says the balance is due can settle it", () => {
  assert.match(read("components/today/today-inbox.tsx"), /item\.action\.kind === "final_balance"/);
  assert.match(read("components/today/today-inbox.tsx"), /lead\?\.action\.kind === "final_balance"/);
  assert.match(read("components/planning/final-invoice-reconciliation.tsx"), /<FinalBalanceActions/);
  assert.match(read("components/ai/actions/prepared-actions.tsx"), /send_final_balance: SendFinalBalanceCard/);
});

test("a raised bill is in flight, and the bill that stands is the one read", () => {
  // After a booking change a job has a superseded final and its replacement.
  const invoices = [
    { id: "old", kind: "final", status: "superseded" },
    { id: "new", kind: "final", status: "awaiting_delivery" },
  ];
  assert.equal(currentFinalInvoice(invoices)?.id, "new");
  assert.equal(currentFinalInvoice([{ id: "old", kind: "final", status: "superseded" }])?.id, "old");
  const steps = read("features/journey/steps.ts");
  assert.match(steps, /\["draft", "awaiting_delivery", "sent", "viewed", "partially_paid", "overdue"\]/);
  for (const reader of ["components/today/use-today-inbox.ts", "components/projects/use-project-journey.ts", "components/projects/use-readiness-evidence.ts"])
    assert.doesNotMatch(read(reader), /find\(\(invoice\) => invoice\.kind === "final"\)/, reader);
});
