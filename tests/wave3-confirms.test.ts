import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { jobClientRecipient, recipientLabel } from "../features/projects/client-recipient.ts";
import { providerFailureHint } from "../features/booking/provider-failure-hint.ts";
import { friendlyError, isVersionConflict } from "../lib/ai/friendly-error.ts";
import { todayInbox } from "../features/today/inbox.ts";
import { stripePaymentFailureFields } from "../functions/src/booking/payment-failure.ts";

/**
 * Wave 3 safety sweep (2026-09-30): a confirm step in front of every one-tap
 * act that reaches the couple or can't be undone, and no dead ends — no
 * button the server refuses, no "try again" where trying again can't work.
 */

const source = (file: string) => readFileSync(file, "utf8");
/** The body of one top-level function, so an assertion can't match a neighbour. */
function slice(file: string, start: string): string {
  const text = source(file);
  const from = text.indexOf(start);
  assert.ok(from >= 0, `${start} in ${file}`);
  const next = text.indexOf("\nfunction ", from + start.length);
  const nextExport = text.indexOf("\nexport function ", from + start.length);
  const ends = [next, nextExport].filter((index) => index > 0);
  return text.slice(from, ends.length ? Math.min(...ends) : undefined);
}

// ── The shared step ─────────────────────────────────────────────────────────

test("one shared confirm step, styled, with the act and a way back", () => {
  const step = source("components/ui/confirm-step.tsx");
  assert.match(step, /export function ConfirmStep/);
  assert.match(step, /role="group"/);
  assert.match(step, /onCancel/);
  const css = source("app/confirm-step.css");
  for (const name of ["confirm-step", "confirm-step-actions", "today-confirm-step", "ai-queue-confirm-step"])
    assert.match(css, new RegExp(`\\.${name}\\b`), name);
  assert.match(source("app/globals.css"), /@import "\.\/confirm-step\.css";/);
});

// ── Confirm wiring: the first tap opens the step, it doesn't act ────────────

test("releasing a delivery asks first, naming who is emailed", () => {
  const form = source("components/post-event/delivery-form.tsx");
  assert.match(form, /if \(!confirmingRelease\) \{\s*setConfirmingRelease\(true\);\s*return;/);
  assert.match(form, /<ConfirmStep[\s\S]*?confirmType="submit"/);
  assert.match(form, /jobClientRecipient\(project, contacts\)/);
  assert.match(form, /An email can't be unsent/);
});

test("album fulfillment asks first and says it can be put back", () => {
  const closeout = source("components/post-event/delivery-closeout-workspace.tsx");
  assert.doesNotMatch(closeout, /onClick=\{\(\) => void updateAlbum\(album\.id, "fulfilled"\)\}/);
  assert.match(closeout, /onClick=\{\(\) => setConfirmingFulfillment\(album\.id\)\}/);
  assert.match(closeout, /Put back to\s+Approved/);
});

test("Cue's 'They reviewed us' says the asks stop for good", () => {
  const card = slice("components/ai/actions/studio-actions.tsx", "export function ConfirmReviewCard");
  assert.match(card, /onClick=\{\(\) => setConfirming\(true\)\}/);
  assert.match(card, /can&rsquo;t be undone/);
  assert.match(card, /<ConfirmStep/);
});

test("revoking a vendor link or a portal invite asks first", () => {
  const vendor = source("components/planning/vendor-share-actions.tsx");
  assert.doesNotMatch(vendor, /onClick=\{\(\) => void revoke\(\)\}/);
  assert.match(vendor, /setConfirmingRevoke\(true\)/);
  const invite = source("components/clients/client-portal-invite.tsx");
  assert.doesNotMatch(invite, /onClick=\{\(\) => void revoke\(\)\}/);
  assert.match(invite, /setConfirmingRevoke\(true\)/);
  assert.match(invite, /send a fresh\s+invitation afterwards/);
});

test("the couple's Remove card says what stops and how to pay instead", () => {
  const autopay = source("components/client/client-autopay.tsx");
  assert.doesNotMatch(autopay, /onClick=\{\(\) => void remove\(\)\}/);
  assert.match(autopay, /setConfirmingRemove\(true\)/);
  assert.match(autopay, /you'll pay with the invoice link instead/);
});

test("bulk dismissing drafts asks first; they can't be brought back", () => {
  const tray = source("components/projects/project-prepared-tray.tsx");
  assert.doesNotMatch(tray, /onClick=\{\(\) => void dismissAll\(/);
  assert.match(tray, /setConfirmingClear\("stale"\)/);
  assert.match(tray, /can't be brought back|can&rsquo;t be brought back/);
});

test("Reject and Dismiss in the AI queue take one line of confirm", () => {
  const queue = slice("components/ai/ai-approval-queue.tsx", "export function AiQueueCard");
  assert.doesNotMatch(queue, /onClick=\{\(\) => void decide\("rejected"\)\}/);
  assert.doesNotMatch(queue, /onClick=\{\(\) => void decide\("dismissed"\)\}/);
  assert.match(queue, /setConfirmingNo\("rejected"\)/);
  assert.match(queue, /setConfirmingNo\("dismissed"\)/);
});

test("a receipt's Cancel / Retry refusal is shown, not swallowed", () => {
  const receipt = slice("components/ai/ai-approval-queue.tsx", "function ReceiptCard");
  assert.match(receipt, /catch \(caught: unknown\)/);
  assert.match(receipt, /setNotice\(\s*friendlyError/);
  for (const code of ["ACTION_RECEIPT_NOT_FOUND", "ACTION_RECEIPT_NOT_CANCELLABLE", "ACTION_RECEIPT_NOT_RETRYABLE"])
    assert.doesNotMatch(friendlyError(new Error(code), "FALLBACK"), /FALLBACK/, code);
});

test("Today: Not now, Add over a sent proposal and the final bill all confirm", () => {
  const requests = slice("components/today/today-inbox.tsx", "function PackageRequestActions");
  assert.doesNotMatch(requests, /onClick=\{\(\) => void decline\(\)\}/);
  assert.match(requests, /setConfirming\("decline"\)/);
  assert.match(requests, /proposalOut \? setConfirming\("add"\) : void add\(\)/);
  assert.match(requests, /this can't be undone/);
  const bill = slice("components/today/today-inbox.tsx", "function FinalBalanceCardActions");
  assert.doesNotMatch(bill, /onClick=\{\(\) => void send\(\)\} type="button"/);
  assert.match(bill, /onClick=\{\(\) => setConfirming\(true\)\}/);
  assert.match(bill, /goes to \$\{recipient \?\? "the couple"\}/);
  const shared = source("components/booking/final-balance-actions.tsx");
  assert.match(shared, /onClick=\{\(\) => setConfirming\(true\)\}/);
  assert.match(shared, /goes to \$\{recipient \?\? "the couple"\}/);
});

test("the retainer invoice shows its amount and confirms who gets it", () => {
  const workspace = source("components/booking/project-booking-workspace.tsx");
  assert.doesNotMatch(workspace, /onClick=\{\(\) => void createRetainer\(\)\}/);
  assert.match(workspace, /"Create retainer invoice"\} · \$\{currency\(agreedRetainerCents/);
  assert.match(workspace, /`Try again · \$\{currency\(agreedRetainerCents/);
  assert.match(workspace, /can only be voided, not unsent/);
});

// ── Dead ends ──────────────────────────────────────────────────────────────

test("a version conflict says refresh, and the booking page offers Refresh", () => {
  assert.equal(
    friendlyError(new Error("PROJECT_VERSION_CONFLICT")),
    "Someone changed this job a moment ago — refresh and try again.",
  );
  assert.equal(isVersionConflict(new Error("PROJECT_VERSION_CONFLICT")), true);
  assert.equal(isVersionConflict(new Error("VERSION_CONFLICT")), true);
  assert.equal(isVersionConflict(new Error("RETAINER_NOT_READY")), false);
  const workspace = source("components/booking/project-booking-workspace.tsx");
  assert.match(workspace, /setStaleJob\(isVersionConflict\(error\)\)/);
  assert.match(workspace, /\{staleJob \? \([\s\S]*?Refresh\s*<\/button>/);
});

test("no retainer to record points at waiving it, not at a locked package", () => {
  const copy = friendlyError(new Error("RETAINER_AMOUNT_NOT_FOUND"));
  assert.doesNotMatch(copy, /Check the package/);
  assert.match(copy, /Waive it/);
});

test("the booking page names the studio's own invoicing app", () => {
  const workspace = source("components/booking/project-booking-workspace.tsx");
  assert.doesNotMatch(workspace, /QuickBooks refused this invoice/);
  assert.doesNotMatch(workspace, /Open QuickBooks invoice/);
  assert.doesNotMatch(workspace, /"QuickBooks customer matching and retainer creation are queued\."/);
  assert.match(workspace, /capability: "invoicing"/);
  assert.match(workspace, /`\$\{invoicingName\} refused this invoice`/);
});

test("an invoice email that failed can be sent again from the booking page", () => {
  const workspace = source("components/booking/project-booking-workspace.tsx");
  assert.match(workspace, /type: "retryEmailJob"/);
  assert.match(workspace, /Send the email again/);
  assert.doesNotMatch(workspace, /fix the connection and try again/);
});

test("billing refusals get billing advice; deterministic ones aren't told to retry", () => {
  const stripe400 = providerFailureHint("STRIPE_INVOICE_CREATE_FAILED:400:No such customer", "Stripe", false, "billing");
  assert.doesNotMatch(stripe400, /signer role|agreement|template/i);
  assert.match(stripe400, /Stripe said: "No such customer"/);
  assert.match(stripe400, /refused the same way/);
  assert.doesNotMatch(stripe400, /^.*\bTry again\b/);
  const qb402 = providerFailureHint("QUICKBOOKS_INVOICE_CREATE_FAILED:402:X", "QuickBooks", false);
  assert.doesNotMatch(qb402, /send agreements|test mode/i);
  assert.match(qb402, /record the payment below/);
  const stripe422 = providerFailureHint("X:422:X", "Stripe", false);
  assert.doesNotMatch(stripe422, /try again/i);
  // Transient: retrying is the right advice.
  assert.match(providerFailureHint("X:503:X", "Stripe", false, "billing"), /try again/);
  assert.match(providerFailureHint("X:429:X", "Stripe", false, "billing"), /Wait a moment and try again/);
  // Signing keeps its own advice, and a deterministic 4xx isn't "try again".
  assert.match(providerFailureHint("X:400:Y", "Dropbox Sign", false), /signer role/);
  assert.doesNotMatch(providerFailureHint("X:404:Y", "Dropbox Sign", false), /try again/i);
});

test("Cue's automatic-emails setting only claims the three messages it governs", () => {
  const catalog = source("functions/src/ai/action-catalog.ts");
  const line = catalog.split("\n").find((entry) => entry.includes('id: "set_automatic_emails"')) ?? "";
  assert.doesNotMatch(line, /reminders, follow-ups, review requests\) on or off/);
  assert.match(line, /schedule confirmation, final balance summary or day-before checklist/);
  const card = source("components/ai/actions/studio-actions.tsx");
  assert.doesNotMatch(card, /Which reminders and notices StudioCue drafts or sends on its own\./);
});

test("buttons the server refuses for this role aren't offered", () => {
  const today = source("components/today/today-inbox.tsx");
  assert.match(slice("components/today/today-inbox.tsx", "function EmailProblemActions"), /if \(!ownerOrAdmin\(workspace\.role\)\)/);
  assert.match(slice("components/today/today-inbox.tsx", "function FinalBalanceCardActions"), /if \(!ownerOrAdmin\(workspace\.role\)\)/);
  assert.match(slice("components/today/today-inbox.tsx", "function PackageRequestActions"), /mayAdd/);
  assert.match(today, /function ownerOrAdmin/);
  assert.match(source("components/booking/final-balance-actions.tsx"), /if \(!mayBill\)/);
  const closeout = source("components/post-event/delivery-closeout-workspace.tsx");
  assert.match(closeout, /const readyToClose = closeable && mayClose;/);
  assert.match(closeout, /mayClose && !closed && !reviewConfirmed/);
});

// ── Pure helpers ───────────────────────────────────────────────────────────

test("the named recipient is the one the server emails: first client contact with an address", () => {
  const project = { tenantId: "t1", clientContactIds: ["c0", "c1", "c2"] };
  const contacts = [
    { id: "c0", tenantId: "t1", displayName: "No Email", email: null },
    { id: "c1", tenantId: "t1", displayName: "Ada Lovelace", email: "ada@example.com" },
    { id: "c2", tenantId: "t1", displayName: "Second", email: "second@example.com" },
  ];
  const recipient = jobClientRecipient(project, contacts);
  assert.deepEqual(recipient, { name: "Ada Lovelace", email: "ada@example.com" });
  assert.equal(recipientLabel(recipient), "Ada Lovelace (ada@example.com)");
  assert.equal(recipientLabel({ name: null, email: "x@y.z" }), "x@y.z");
  assert.equal(jobClientRecipient({ clientContactIds: [] }, contacts), null);
  assert.equal(recipientLabel(null), null);
  // Another tenant's contact is never named.
  assert.equal(
    jobClientRecipient(project, [{ id: "c1", tenantId: "other", displayName: "X", email: "x@example.com" }]),
    null,
  );
});

test("a Stripe payment_failed is recorded beside the status, and cleared by payment", () => {
  const failed = stripePaymentFailureFields({
    eventType: "invoice.payment_failed",
    eventId: "evt_1",
    decidedStatus: "sent",
    object: { attempt_count: 1, next_payment_attempt: 1790000000 },
    now: "2026-09-30T12:00:00.000Z",
  });
  assert.equal(failed.paymentFailedAt, "2026-09-30T12:00:00.000Z");
  assert.equal(failed.paymentFailure?.attemptCount, 1);
  assert.equal(failed.paymentFailure?.nextAttemptAt, new Date(1790000000 * 1000).toISOString());
  assert.deepEqual(
    stripePaymentFailureFields({ eventType: "invoice.paid", eventId: "evt_2", decidedStatus: "paid", object: {}, now: "n" }),
    { paymentFailedAt: null, paymentFailure: null },
  );
  // A studio-recorded payment the webhook keeps as paid clears it too.
  assert.deepEqual(
    stripePaymentFailureFields({ eventType: "invoice.payment_failed", eventId: "e", decidedStatus: "paid", object: {}, now: "n" }),
    { paymentFailedAt: null, paymentFailure: null },
  );
  assert.deepEqual(
    stripePaymentFailureFields({ eventType: "invoice.voided", eventId: "e", decidedStatus: "voided", object: {}, now: "n" }),
    { paymentFailedAt: null, paymentFailure: null },
  );
  const webhook = source("functions/src/booking/webhooks.ts");
  assert.match(webhook, /\.\.\.stripePaymentFailureFields\(\{/);
});

test("Today raises a failed payment, and chases a bill on the job's own page", () => {
  const inbox = todayInbox({
    now: "2026-09-30T12:00:00Z",
    invoiceReferences: [
      {
        id: "inv-failed",
        projectId: "p1",
        kind: "final",
        provider: "stripe",
        status: "sent",
        balanceCents: 250000,
        dueDate: "2026-10-20",
        paymentFailedAt: "2026-09-30T10:00:00Z",
      },
      { id: "inv-retainer", projectId: "p2", kind: "retainer", provider: "quickbooks", status: "sent", balanceCents: 50000, dueDate: "2026-09-01" },
      { id: "inv-final", projectId: "p3", kind: "final", provider: "stripe", status: "sent", balanceCents: 90000, dueDate: "2026-09-01" },
      { id: "inv-paid", projectId: "p4", kind: "final", status: "paid", balanceCents: 0, paymentFailedAt: "2026-09-29T10:00:00Z" },
    ],
  });
  const failed = inbox.act.find((item) => item.id === "invoice-payment-failed-inv-failed");
  assert.ok(failed, "a failed charge has its own card");
  assert.equal(failed.title, "$2,500 payment failed");
  assert.deepEqual(failed.action, { kind: "link", label: "Open the invoice", href: "/studio/invoices?project=p1" });
  assert.ok(failed.facts.includes("Stripe couldn't take the payment"));
  assert.ok(!inbox.act.some((item) => item.id === "invoice-payment-failed-inv-paid"), "a paid bill raises nothing");

  const retainer = inbox.act.find((item) => item.id === "invoice-inv-retainer");
  assert.ok(retainer && retainer.action.kind === "link");
  assert.equal(retainer.action.href, "/studio/booking?project=p2");
  assert.ok(retainer.facts.includes("resend it from QuickBooks"));
  const final = inbox.act.find((item) => item.id === "invoice-inv-final");
  assert.ok(final && final.action.kind === "link");
  assert.equal(final.action.href, "/studio/invoices?project=p3");
  assert.ok(final.facts.includes("resend it from Stripe"));
});

test("a package request carries its proposal's status, so Add can confirm over a sent one", () => {
  const inbox = todayInbox({
    now: "2026-09-29T15:00:00Z",
    projects: [{ id: "p1", name: "Gabe and Dionne", state: "PROPOSAL", archivedAt: null, eventDate: "2027-08-17" }],
    proposals: [{ id: "current", projectId: "p1", status: "sent", version: 1 }],
    packageRequests: [
      { id: "req1", projectId: "p1", packageId: "pkg", packageName: "Gold", status: "pending", createdAt: "2026-09-29T14:00:00Z" },
    ],
  });
  const card = inbox.act.find((item) => item.id === "package-request-req1");
  assert.ok(card && card.action.kind === "package_request");
  assert.equal(card.action.proposalStatus, "sent");
});
