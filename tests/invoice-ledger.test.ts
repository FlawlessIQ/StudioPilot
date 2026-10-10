import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { filterLedger, ledgerCsv, ledgerRows, ledgerState, ledgerTotals } from "../features/billing/invoice-ledger";
import { outstandingFinalBalance } from "../features/booking/final-balance-due";
import { studioTaxRateFor } from "../features/billing/job-billing-from-records";
import { paymentReminderDraft, paymentReminderLink } from "../functions/src/billing/payment-reminders";
import { todayInbox, type TodayInput } from "../features/today/inbox";

/**
 * Own invoicing, Phase 4: tracking. The Invoices page lists every bill with
 * what's owed and late, a CSV for the bookkeeper, overdue studio invoices are
 * chased with their own number, instructions and pay link, and a balance
 * shown before a self-billed final is drafted matches the invoice it becomes.
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const today = "2026-10-10";

const invoices = [
  { id: "a", projectId: "p1", kind: "retainer", billedBy: "studio", provider: null, number: "INV-0001", status: "paid", amountCents: 191_000, balanceCents: 0, issuedAt: "2026-09-01T10:00:00Z", studioPayments: [{ amountCents: 191_000, paidAt: "2026-09-05" }] },
  { id: "b", projectId: "p1", kind: "final", billedBy: "studio", provider: null, number: "INV-0003", status: "sent", amountCents: 582_988, balanceCents: 582_988, taxCents: 58_988, issuedAt: "2026-10-01T10:00:00Z", dueDate: "2026-10-05" },
  { id: "c", projectId: "p2", kind: "retainer", billedBy: "studio", provider: null, number: "INV-0004", status: "draft", amountCents: 50_000, balanceCents: 50_000, issuedAt: "2026-10-09T10:00:00Z", dueDate: "2026-10-23" },
  { id: "d", projectId: "p2", kind: "final", provider: "quickbooks", providerDocNumber: "1043", status: "sent", amountCents: 100_000, balanceCents: 40_000, issuedAt: "2026-09-20T10:00:00Z", dueDate: "2026-11-01" },
  { id: "e", projectId: "p2", kind: "retainer", provider: null, status: "paid", amountCents: 20_000, balanceCents: 0, completionAuthority: "manual_attested", paidAt: "2026-08-01T00:00:00Z", issuedAt: "2026-08-01T00:00:00Z" },
  { id: "f", projectId: "p1", kind: "final", provider: "quickbooks", status: "superseded", amountCents: 99_000, balanceCents: 99_000 },
];
const projects = [
  { id: "p1", name: "Priya & Jordan", clientContactIds: ["c1"] },
  { id: "p2", name: "Lee family session", clientContactIds: [] },
];
const contacts = [{ id: "c1", displayName: "Priya Patel" }];

test("each bill knows where it came from and where it stands", () => {
  const rows = ledgerRows({ invoices, projects, contacts, today });
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.equal(byId.get("b")!.state, "overdue");
  assert.equal(byId.get("b")!.sourceLabel, "You");
  assert.equal(byId.get("b")!.clientName, "Priya Patel");
  assert.equal(byId.get("c")!.state, "draft");
  assert.equal(byId.get("d")!.sourceLabel, "QuickBooks");
  assert.equal(byId.get("d")!.number, "1043");
  assert.equal(byId.get("d")!.paidCents, 60_000);
  assert.equal(byId.get("e")!.sourceLabel, "Recorded by you");
  assert.equal(byId.get("e")!.paidOn, "2026-08-01");
  assert.equal(byId.get("a")!.paidOn, "2026-09-05");
  assert.equal(byId.get("f")!.state, "closed");
  // Newest first.
  assert.deepEqual(rows.map((row) => row.id).slice(0, 2), ["c", "b"]);
  assert.equal(ledgerState({ status: "sent", balanceCents: 10, dueDate: "2026-10-10" }, today), "owed");
});

test("totals: outstanding, overdue, not sent, received — a replaced bill counts for nothing", () => {
  const totals = ledgerTotals(ledgerRows({ invoices, projects, contacts, today }));
  assert.deepEqual(totals, {
    outstandingCents: 582_988 + 40_000,
    overdueCents: 582_988,
    overdueCount: 1,
    draftCents: 50_000,
    draftCount: 1,
    paidCents: 191_000 + 60_000 + 20_000,
  });
  const rows = ledgerRows({ invoices, projects, contacts, today });
  assert.deepEqual(filterLedger(rows, "owed").map((row) => row.id).sort(), ["b", "d"]);
  assert.deepEqual(filterLedger(rows, "overdue").map((row) => row.id), ["b"]);
  assert.ok(!filterLedger(rows, "all").some((row) => row.id === "f"));
  assert.deepEqual(ledgerRows({ invoices, projects, today, projectId: "p2" }).map((row) => row.projectId), ["p2", "p2", "p2"]);
});

test("the CSV opens cleanly in a spreadsheet and can't run a formula", () => {
  const rows = ledgerRows({ invoices, projects, contacts, today });
  const csv = ledgerCsv(filterLedger(rows, "owed"));
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0], "Invoice number,Job,Client,Bill,Billed through,Status,Issued,Sent,Due,Paid on,Currency,Amount,Tax,Paid,Balance");
  assert.ok(lines.includes("INV-0003,Priya & Jordan,Priya Patel,Final balance,You,Overdue,2026-10-01,,2026-10-05,,USD,5829.88,589.88,0.00,5829.88"));
  const hostile = ledgerRows({
    invoices: [{ id: "x", projectId: "p9", kind: "final", status: "sent", amountCents: 1, balanceCents: 1 }],
    projects: [{ id: "p9", name: '=HYPERLINK("http://x","y")' }],
    today,
  });
  // The job name cell is quoted and starts with ' — read as text, never run.
  assert.match(ledgerCsv(hostile), /\r\n,"'=HYPERLINK\(""http:\/\/x"",""y""\)",/);
});

test("before a self-billed final is drafted, its balance is the one the invoice will carry", () => {
  const proposals = [{ id: "pr", projectId: "p1", status: "accepted", version: 1, pricingSnapshot: { totalCents: 764_000, taxCents: 49_000 } }];
  const paid = [{ id: "a", projectId: "p1", kind: "retainer", status: "paid", amountCents: 191_000, balanceCents: 0 }];
  // As QuickBooks would bill it: the agreed total, less what was paid.
  assert.equal(outstandingFinalBalance({ projectId: "p1", proposals, invoices: paid }).cents, 573_000);
  // The studio's own invoice: before tax $7,150, plus 8.25%, less the deposit — $5,829.88, as raised.
  assert.equal(outstandingFinalBalance({ projectId: "p1", proposals, invoices: paid, studioTaxBasisPoints: 825 }).cents, 582_988);
  assert.equal(outstandingFinalBalance({ projectId: "p1", proposals, invoices: paid, studioTaxBasisPoints: 0 }).cents, 524_000);
  const settings = { tenantId: "t", studioInvoices: { tax: { rateBasisPoints: 825 } } };
  assert.equal(studioTaxRateFor({ projectId: "p1", project: {}, connections: [], invoices: [], billingSettings: settings }), 825);
  assert.equal(studioTaxRateFor({ projectId: "p1", project: { salesTaxExempt: true }, connections: [], invoices: [], billingSettings: settings }), 0);
  const quickbooks = [{ provider: "quickbooks", status: "connected", archivedAt: null }];
  assert.equal(studioTaxRateFor({ projectId: "p1", project: { billing: { method: "quickbooks" } }, connections: quickbooks, invoices: [], billingSettings: settings }), undefined);
});

test("an overdue studio invoice is chased with its own number, instructions and pay link", () => {
  const draft = paymentReminderDraft({
    sequence: 1,
    studioName: "Alder & Muse",
    clientFirstName: "Priya",
    projectName: "Priya & Jordan",
    invoiceKind: "final",
    balanceCents: 582_988,
    dueDate: "2026-10-05",
    today,
    invoiceNumber: "INV-0003",
    paymentInstructions: "Zelle to billing@alderandmuse.test\nChecks payable to Alder & Muse",
  });
  assert.match(draft.body, /balance for Priya & Jordan \(invoice INV-0003\), \$5,829\.88, was due on October 5/);
  assert.match(draft.body, /How to pay: Zelle to billing@alderandmuse\.test · Checks payable to Alder & Muse/);
  assert.equal(paymentReminderLink({}, "p1", "https://studio-cue.com", "https://square.link/u/alder"), "https://square.link/u/alder");
  assert.equal(paymentReminderLink({ payLinkUrl: "https://paypal.me/x" }, "p1", "https://studio-cue.com", "https://square.link/u/alder"), "https://paypal.me/x");
  assert.equal(paymentReminderLink({}, "p1", "https://studio-cue.com"), "https://studio-cue.com/client/payments?project=p1");
  // Without a number or instructions it reads as it always did.
  const plain = paymentReminderDraft({ sequence: 1, studioName: "S", clientFirstName: null, projectName: "J", invoiceKind: "final", balanceCents: 100, dueDate: "2026-10-05", today });
  assert.doesNotMatch(plain.body, /How to pay|\(invoice/);
});

test("Today: an overdue studio invoice offers Email it again, not 'resend it from QuickBooks'", () => {
  const input = {
    now: "2026-10-10T12:00:00.000Z",
    projects: [{ id: "p1", tenantId: "t", name: "Priya & Jordan", state: "PLANNING", eventDate: "2026-10-31" }],
    invoiceReferences: [invoices[1]],
  } as unknown as TodayInput;
  const inbox = todayInbox(input);
  const card = [...inbox.act, ...(inbox.exceptions ?? [])].find((item) => item.id === "invoice-b");
  assert.ok(card, "an overdue card");
  assert.match(card.title, /overdue · INV-0003$/);
  assert.deepEqual(card.action, { kind: "studio_invoice", label: "Email it again", projectId: "p1", invoiceId: "b" });
  assert.ok(!(card.facts ?? []).some((fact) => /QuickBooks/.test(fact)));
});

test("the Invoices page leads with the ledger and no longer says everything is QuickBooks'", () => {
  const page = read("app/studio/invoices/page.tsx");
  assert.match(page, /beforeContent=\{<InvoiceLedger projectId=\{project\} \/>\}/);
  assert.doesNotMatch(page, /synced from QuickBooks|QuickBooks references/);
  assert.match(read("components/billing/invoice-ledger.tsx"), /Download CSV/);
});
