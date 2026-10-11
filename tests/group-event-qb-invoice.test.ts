import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  eventSignupSettingsProblem,
  eventSignupSettingsSchema,
  howToPay,
  normaliseEventSignup,
  participantInvoiceJobId,
  participantInvoiceOpen,
  participantInvoiceRequestId,
  participantInvoiceSendable,
  participantInvoiceSummary,
  statusForMethod,
} from "../features/group-events/signup.ts";
import {
  participantCustomerBody,
  participantCustomerNames,
  participantInvoiceLines,
  participantInvoiceStanding,
  participantInvoiceVoidJob,
} from "../functions/src/group-events/participant-invoice-core.ts";
import { billingHoldApplies } from "../functions/src/saas/billing-hold.ts";
import { CLIENT_EMAIL_TYPES, renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { EDITABLE_EMAILS } from "../features/communications/email-catalog.ts";

/**
 * A QuickBooks invoice for each parent at a group event
 * (docs/group-event-signup-plan-2026-10-10.md, Phase 4b). The QuickBooks
 * calls themselves are proven against the sandbox by
 * scripts/uat/quickbooks-participant-invoice-sandbox.mts.
 */

const read = (path: string) => readFileSync(path, "utf8");
const brand = { studioName: "GR Productions", productName: "StudioCue", accentColor: null, logoUrl: null, replyTo: null } as never;

// ── Where it lives ──

test("a parent's invoice never becomes one of the job's invoices", () => {
  // Twenty readers sum a job's invoiceReferences — the organiser's portal among them.
  for (const file of ["functions/src/group-events/participant-invoices.ts", "functions/src/group-events/participant-invoice-core.ts"])
    assert.doesNotMatch(read(file), /collection\("invoiceReferences"\)|doc\(`invoiceReferences\//, file);
  const route = read("app/api/public/event-signup/route.ts");
  assert.doesNotMatch(route, /invoiceReferences/);
  assert.match(route, /qbInvoice: \{\s*state: "queued"/);
});

// ── The method ──

test("QuickBooks invoices are a way to pay that needs no handle, but never beside a pay link", () => {
  const config = normaliseEventSignup({
    signup: { token: "tok_abcdefghijklmnop", options: [{ id: "a", name: "Digital", priceCents: 4500 }], methods: ["cash", "quickbooks"], open: true },
  });
  assert.deepEqual(config.methods, ["cash", "quickbooks"]);
  assert.equal(statusForMethod("quickbooks"), "unpaid");
  assert.match(howToPay("quickbooks", config, "GR"), /emailing you a secure invoice to pay online by card or bank/);
  const settings = eventSignupSettingsSchema.parse({
    options: [{ id: "a", name: "Digital", priceCents: 4500 }],
    methods: ["pay_link", "quickbooks"],
    payLinkUrl: "https://square.link/u/x",
    open: true,
  });
  assert.equal(eventSignupSettingsProblem(settings), "EVENT_ONLINE_TWICE");
});

test("the method is offered only while QuickBooks is connected — on the page, at sign-up and in settings", () => {
  const route = read("app/api/public/event-signup/route.ts");
  assert.match(route, /methods: \(await offeredMethods\(config, tenantId\)\)\.map/);
  assert.match(route, /if \(!\(await offeredMethods\(config, tenantId\)\)\.includes\(input\.method\)\)/);
  const crm = read("functions/src/crm/commands.ts");
  assert.match(crm, /settings\.methods\.includes\("quickbooks"\) && !\(await quickBooksConnectedIn\(transaction, db, command\.tenantId\)\)/);
  const panel = read("components/group-events/event-signup-panel.tsx");
  assert.match(panel, /method !== "quickbooks" \|\| quickBooks \|\| methods\.includes\(method\)/);
  for (const code of ["EVENT_QUICKBOOKS_NOT_CONNECTED", "EVENT_ONLINE_TWICE", "PARTICIPANT_INVOICE_OPEN", "PARTICIPANT_AMOUNT_REQUIRED"])
    assert.match(read("lib/ai/friendly-error.ts"), new RegExp(`${code}:`), code);
});

test("signing up to pay by invoice asks for the invoice in the same write", () => {
  const route = read("app/api/public/event-signup/route.ts");
  const transaction = route.slice(route.indexOf("transaction.create(reference, record);"));
  assert.match(transaction.slice(0, 900), /if \(input\.method === "quickbooks"\) \{[\s\S]*type: CREATE_PARTICIPANT_INVOICE_JOB,[\s\S]*idempotencyKey: participantInvoiceRequestId\(participantId, 1\)/);
  assert.equal(participantInvoiceJobId("p1"), "participant_invoice_p1");
  assert.ok(participantInvoiceRequestId("6f1c2c9e-8d55-4b1a-9a1e-1234567890ab", 12).length <= 50);
});

// ── The invoice ──

test("one line, the parent's athlete and package, and never sales tax", () => {
  const plain = participantInvoiceLines({ amountCents: 4550, athleteName: "Mia", packageName: "Gold", eventName: "Spring Cheer", itemRef: { value: "1" }, taxable: "none" });
  assert.equal(plain.length, 1);
  assert.equal(plain[0]!.Amount, 45.5);
  assert.equal(plain[0]!.Description, "Mia — Gold (Spring Cheer)");
  assert.equal((plain[0]!.SalesItemLineDetail as Record<string, unknown>).TaxCodeRef, undefined);
  const coded = participantInvoiceLines({ amountCents: 4500, athleteName: "Mia", packageName: null, eventName: null, itemRef: { value: "1" }, taxable: "codes" });
  assert.deepEqual((coded[0]!.SalesItemLineDetail as Record<string, unknown>).TaxCodeRef, { value: "NON" });
  // A refused request is retried without online payment, then without tax codes — never a second invoice.
  const worker = read("functions/src/group-events/participant-invoices.ts");
  assert.match(worker, /if \(refused\(error\)\) return create\(false, taxable, "o"\)/);
  assert.match(worker, /if \(refused\(error\) && taxable === "codes"\) return create\(false, "none", "p"\)/);
  assert.match(worker, /\/\/ Kept the moment it exists, so a retry adopts it rather than billing twice\.\s*await reference\.update\(invoicePatch\(\{ providerInvoiceId, providerCustomerId \}/);
});

test("the parent is the customer, named apart when the name is someone else's", () => {
  assert.deepEqual(participantCustomerNames("Dana Reyes", "dana@example.com"), ["Dana Reyes", "Dana Reyes (dana@example.com)"]);
  const body = participantCustomerBody({ displayName: "Dana Reyes", parentName: "Dana  Reyes", email: "dana@example.com", phone: null });
  assert.deepEqual(body, { DisplayName: "Dana Reyes", GivenName: "Dana", FamilyName: "Reyes", PrimaryEmailAddr: { Address: "dana@example.com" } });
  // Never the organiser: nothing in the worker reads the job's client contacts.
  assert.doesNotMatch(read("functions/src/group-events/participant-invoices.ts"), /clientContactIds|clientEmailFor/);
});

test("what QuickBooks reports becomes the parent's invoice state", () => {
  assert.equal(participantInvoiceStanding({ totalCents: 4500, balanceCents: 4500 }), "open");
  assert.equal(participantInvoiceStanding({ totalCents: 4500, balanceCents: 1000 }), "partially_paid");
  assert.equal(participantInvoiceStanding({ totalCents: 4500, balanceCents: 0 }), "paid");
  assert.equal(participantInvoiceStanding({ totalCents: 0, balanceCents: 0 }), "voided");
  assert.equal(participantInvoiceStanding({ operation: "Delete", totalCents: 4500, balanceCents: 4500 }), "voided");
});

test("the studio can send again only after a failure or a withdrawal", () => {
  assert.equal(participantInvoiceSendable(null), true);
  assert.equal(participantInvoiceSendable({ state: "failed" }), true);
  assert.equal(participantInvoiceSendable({ state: "voided" }), true);
  assert.equal(participantInvoiceSendable({ state: "queued" }), false);
  assert.equal(participantInvoiceSendable({ state: "open", providerInvoiceId: "9" }), false);
  assert.equal(participantInvoiceOpen({ state: "open", providerInvoiceId: "9" }), true);
  assert.equal(participantInvoiceOpen({ state: "open", providerInvoiceId: null }), false);
  assert.equal(participantInvoiceSummary({ state: "open", docNumber: "1070" }), "QuickBooks invoice #1070 sent");
  assert.equal(participantInvoiceSummary({ state: "failed" }), "QuickBooks invoice failed");
});

// ── Paid, withdrawn, read again ──

test("paid another way withdraws the invoice; paid online asks QuickBooks; cancelled withdraws it", () => {
  const crm = read("functions/src/crm/commands.ts");
  const pay = crm.slice(crm.indexOf('if (command.type === "recordParticipantPayment")'));
  const payBody = pay.slice(0, pay.indexOf("return output;"));
  assert.match(payBody, /participantInvoiceOpen\(parentInvoice\) && command\.input\.method === "online"[\s\S]*type: RECONCILE_PARTICIPANT_INVOICE_JOB/);
  assert.match(payBody, /invoiceFields = withdrawParticipantInvoice\(transaction, db, participant, timestamp\)/);
  const cancel = crm.slice(crm.indexOf('if (command.type === "cancelParticipant")'));
  assert.match(cancel.slice(0, cancel.indexOf("return output;")), /command\.input\.restore \? \{\} : withdrawParticipantInvoice\(transaction, db, participant, timestamp\)/);
  const job = participantInvoiceVoidJob({ participantId: "p1", tenantId: "t", projectId: "j", providerInvoiceId: "189", now: "2026-10-10T00:00:00Z" });
  assert.equal(job.id, participantInvoiceVoidJob({ participantId: "p1", tenantId: "t", projectId: "j", providerInvoiceId: "189", now: "later" }).id, "one void per invoice");
  assert.equal(job.data.type, "void_quickbooks_participant_invoice");
});

test("sending an invoice checks the job, the parent and QuickBooks, and leaves a receipt", () => {
  const crm = read("functions/src/crm/commands.ts");
  assert.match(crm, /type: z\.literal\("sendParticipantInvoice"\)/);
  const branch = crm.slice(crm.indexOf('if (command.type === "sendParticipantInvoice")'));
  const body = branch.slice(0, branch.indexOf("return output;"));
  assert.match(body, /hasProjectAccess\(membershipData, command\.input\.projectId\)/);
  assert.match(body, /if \(!participantInvoiceSendable\(current\)\) throw new Error\("PARTICIPANT_INVOICE_OPEN"\)/);
  assert.match(body, /quickBooksConnectedIn\(transaction, db, command\.tenantId\)/);
  assert.match(body, /participantAudit\(/);
  assert.match(body, /transaction\.create\(commandReference/);
  // Crew record payments at the field; they never send bills.
  assert.match(crm, /const fieldCrewCommands: readonly string\[\] = \["recordParticipantPayment"\];/);
});

test("QuickBooks events reach the parent's invoice: the webhook, a payment applied to it, a payment deleted", () => {
  const webhook = read("functions/src/booking/webhooks.ts");
  // Only when it isn't one of the job's invoices: the existing path is untouched.
  assert.match(webhook, /event\.entityName === "invoice" && !invoice\s*\? await firestore\.collection\("eventParticipants"\)[\s\S]*\.where\("qbInvoice\.providerInvoiceId", "==", event\.entityId\)/);
  assert.match(webhook, /type: RECONCILE_PARTICIPANT_INVOICE_JOB/);
  const money = read("functions/src/booking/quickbooks-money-events.ts");
  assert.match(money, /parentInvoiceIds = \[\.\.\.ids\];/);
  assert.match(money, /\.where\("qbInvoice\.state", "==", status\)/);
  assert.match(money, /await queueParticipantInvoiceReconciles\(/);
  const worker = read("functions/src/group-events/participant-invoices.ts");
  // Paid there marks them paid and emails the receipt; a payment QuickBooks took back reopens them.
  assert.match(worker, /update\.payment = \{ amountCents: totalCents, method: "online", paidAt: now, recordedBy: "quickbooks" \}/);
  assert.match(worker, /type: "participant_receipt"/);
  assert.match(worker, /else if \(state !== "paid" && paidByQuickBooks\)/);
});

test("the runner works the three jobs, a bill waits while billing lapses, and a refusal reaches the roster", () => {
  const jobs = read("functions/src/operations/jobs.ts");
  for (const handler of ["createQuickBooksParticipantInvoice", "reconcileQuickBooksParticipantInvoice", "voidQuickBooksParticipantInvoice"])
    assert.match(jobs, new RegExp(`return ${handler}\\(document\\)`), handler);
  assert.match(jobs, /await participantInvoiceFailed\(document, \{ code, message \}\)/);
  assert.equal(billingHoldApplies("providerJobs", "create_quickbooks_participant_invoice"), true);
  assert.equal(billingHoldApplies("providerJobs", "reconcile_quickbooks_participant_invoice"), false);
});

// ── The email ──

test("the invoice email leads with the pay link and always links the parent's order", () => {
  const values = { athleteName: "Mia", packageName: "Digital set", amountText: "$45.00", actionUrl: "https://studio-cue.com/e/order/abc" };
  const linked = renderEmailTemplate({
    key: "group_participant_invoice",
    brand,
    recipientName: "Dana Reyes",
    projectName: "Spring Cheer Classic",
    values: { ...values, payUrl: "https://connect.intuit.com/portal/app/CommerceNetwork/view/scs-v1-abc" },
  });
  assert.match(linked.subject, /Your invoice from GR Productions/);
  assert.match(linked.html, />Pay \$45\.00</);
  assert.match(linked.html, /href="https:\/\/studio-cue\.com\/e\/order\/abc"/);
  assert.doesNotMatch(linked.text, /wedding|couple/i);
  const unlinked = renderEmailTemplate({ key: "group_participant_invoice", brand, recipientName: "Dana Reyes", projectName: null, values });
  assert.match(unlinked.html, />See your order</);
  assert.ok(CLIENT_EMAIL_TYPES.has("group_participant_invoice"));
  assert.ok(EDITABLE_EMAILS.some((entry) => entry.key === "group_participant_invoice"));
  // A bill: held while the studio's billing lapses, like the job's own.
  assert.equal(billingHoldApplies("emailJobs", "group_participant_invoice"), true);
});
