import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { depositDraft, dueInDays, stableInvoiceId, writeStudioInvoiceDraft } from "../functions/src/billing/studio-invoice-issue";
import { todayInbox, type TodayInput } from "../features/today/inbox";

/**
 * Own invoicing, Phase 2: a job the studio bills itself gets its deposit
 * drafted — numbered, with its PDF — and the studio sends it, by email or its
 * own way (docs/own-invoicing-plan-2026-10-09.md).
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

type Doc = Record<string, unknown>;

/** Just enough Firestore for one drafting transaction. */
function fakeStore(store: Record<string, Doc>) {
  const ref = (path: string) => ({ path, id: path.split("/").pop()! });
  const snap = (path: string) => {
    const data = store[path];
    return {
      id: path.split("/").pop()!,
      exists: Boolean(data),
      ref: ref(path),
      data: () => data,
      get: (field: string) => field.split(".").reduce<unknown>((value, key) => (value as Doc | undefined)?.[key], data),
    };
  };
  const writes: Array<[string, Doc]> = [];
  const db = { doc: ref };
  const transaction = {
    get: async (target: { path: string }) => snap(target.path),
    set: (target: { path: string }, data: Doc) => writes.push([target.path, data]),
  };
  return { db, transaction, writes };
}

const project = (extra: Doc = {}) => ({ "projects/p": { tenantId: "t", ...extra } });
const settings = { "billingSettings/t": { tenantId: "t", studioInvoices: { tax: { rateBasisPoints: 800 } } } };

test("a deposit is part of the agreed price: no tax; paid in full completes the price: taxed", async () => {
  const deposit = depositDraft({ amountCents: 120_000, paidInFull: false, packageName: "Gold", currency: "USD", dueDate: "2026-10-23" });
  assert.equal(deposit.completesPrice, false);
  assert.deepEqual(deposit.lines, [{ description: "Deposit · Gold", quantity: 1, unitAmountCents: 120_000, amountCents: 120_000 }]);
  const whole = depositDraft({ amountCents: 50_000, paidInFull: true, packageName: "Family session", currency: "USD", dueDate: "2026-10-23" });
  assert.equal(whole.completesPrice, true);
  assert.equal(whole.lines[0]!.description, "Family session");

  for (const [draft, exempt, expectedTax] of [
    [deposit, false, 0],
    [whole, false, 4_000],
    [whole, true, 0],
  ] as const) {
    const { db, transaction, writes } = fakeStore({ ...project(exempt ? { salesTaxExempt: true } : {}), ...settings });
    const result = await writeStudioInvoiceDraft(db as never, transaction as never, {
      tenantId: "t",
      projectId: "p",
      invoiceId: "invoice_studio_x",
      draft,
      actor: "booking-orchestrator",
      now: "2026-10-09T12:00:00.000Z",
    });
    assert.equal(result.created, true);
    assert.equal(result.number, "INV-0001");
    const invoice = writes.find(([path]) => path === "invoiceReferences/invoice_studio_x")![1];
    assert.equal(invoice.taxCents, expectedTax);
    assert.equal(invoice.amountCents, draft.subtotalCents + expectedTax);
    assert.equal(invoice.balanceCents, invoice.amountCents);
    assert.equal(invoice.status, "draft");
    assert.equal(invoice.billedBy, "studio");
    assert.equal(invoice.provider, null);
    assert.equal(invoice.pdfRevision, 1);
    // Its first PDF is queued, and the counter moved past the number.
    assert.ok(writes.some(([path, data]) => path === "pdfJobs/invoice_invoice_studio_x_r1" && data.type === "invoice_pdf"));
    assert.ok(writes.some(([path, data]) => path === "invoiceCounters/t" && data.next === 2));
  }
});

test("drafting twice for the same trigger makes one invoice, and never takes a second number", async () => {
  const { db, transaction, writes } = fakeStore({
    ...project(),
    ...settings,
    "invoiceReferences/invoice_studio_x": { tenantId: "t", number: "INV-0007" },
  });
  const result = await writeStudioInvoiceDraft(db as never, transaction as never, {
    tenantId: "t",
    projectId: "p",
    invoiceId: "invoice_studio_x",
    draft: depositDraft({ amountCents: 1000, paidInFull: false, packageName: "x", currency: "USD", dueDate: "2026-10-23" }),
    actor: "a",
    now: "2026-10-09T12:00:00.000Z",
  });
  assert.deepEqual(result, { created: false, invoiceId: "invoice_studio_x", number: "INV-0007" });
  assert.deepEqual(writes, []);
  assert.equal(stableInvoiceId("t", "p", "deposit", "c1"), stableInvoiceId("t", "p", "deposit", "c1"));
  assert.notEqual(stableInvoiceId("t", "p", "deposit", "c1"), stableInvoiceId("t", "p", "deposit", "c2"));
});

test("the due date counts from the job's own calendar day", () => {
  assert.equal(dueInDays(14, "2026-10-09T12:00:00.000Z", "America/New_York"), "2026-10-23");
  // 11pm in New York is already tomorrow in UTC: the job's day still wins.
  assert.equal(dueInDays(0, "2026-10-10T03:00:00.000Z", "America/New_York"), "2026-10-09");
  assert.equal(dueInDays(7, "2026-10-09T12:00:00.000Z", "Not/AZone"), "2026-10-16");
});

test("signing, or booking with no agreement, drafts the deposit for a job the studio bills itself", () => {
  const orchestration = read("functions/src/booking/orchestration.ts");
  assert.equal((orchestration.match(/await draftStudioDeposit\(db, \{/g) ?? []).length, 2);
  assert.match(orchestration, /trigger: contract\.id,/);
  assert.match(orchestration, /trigger: proposal\.id,/);
  assert.match(orchestration, /if \(moved && needs\.payment && billing\?\.method === "studio"\)/);
});

test("sending: email carries the PDF and the studio's words; 'I sent it' records it", () => {
  const send = read("functions/src/billing/studio-invoice-send.ts");
  assert.match(send, /attachmentDocumentId: invoicePdfDocumentId\(invoice\.id\)/);
  assert.match(send, /billedBy: "studio"/);
  assert.match(send, /if \(input\.via === "email" && !email\) throw new Error\("CLIENT_EMAIL_REQUIRED"\)/);
  assert.match(send, /action: input\.via === "email" \? "invoice\.studio_emailed" : "invoice\.studio_marked_sent"/);
  const jobs = read("functions/src/operations/jobs.ts");
  assert.match(jobs, /\(type === "retainer_invoice" \|\| type === "final_invoice"\) && document\.get\("billedBy"\) === "studio"/);
  const commands = read("functions/src/booking/commands.ts");
  assert.match(commands, /type: z\.literal\("sendStudioInvoice"\)/);
  assert.match(commands, /type: z\.literal\("createStudioDeposit"\)/);
});

test("the client's email for a studio invoice: number, amount, due date, how to pay, and Pay", async () => {
  const { renderEmailTemplate } = await import("../functions/src/communications/email-templates");
  const email = renderEmailTemplate({
    key: "retainer_invoice",
    brand: { studioName: "Alder & Muse", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null },
    recipientName: "Maya Johnson",
    projectName: "Maya & Theo Johnson",
    values: {
      billedBy: "studio",
      invoiceNumber: "INV-0001",
      invoiceKindLabel: "Deposit",
      amountLabel: "$1,200.00",
      dueLabel: "October 23, 2026",
      paymentInstructions: "Zelle to billing@alderandmuse.test\nChecks payable to Alder & Muse",
      payLinkUrl: "https://square.link/u/alder",
      invoiceUrl: "https://square.link/u/alder",
    },
  });
  assert.equal(email.subject, "Invoice INV-0001 from Alder & Muse");
  assert.match(email.text, /Here's your deposit invoice.*: \$1,200\.00, due October 23, 2026\. It's attached as a PDF\./);
  assert.match(email.text, /How to pay: Zelle to billing@alderandmuse\.test · Checks payable to Alder & Muse/);
  assert.match(email.text, /Pay \$1,200\.00: https:\/\/square\.link\/u\/alder/);
  assert.doesNotMatch(email.text, /accounting portal|QuickBooks/);
});

test("a payment, a correction or a void re-renders the client's copy", () => {
  const commands = read("functions/src/booking/commands.ts");
  assert.equal((commands.match(/requeueStudioInvoicePdf\(firestore, settleBatch, standing, timestamp\)/g) ?? []).length, 2);
  assert.match(read("functions/src/booking/invoice-payments.ts"), /requeueStudioInvoicePdf\(db, transaction, invoice, context\.now\)/);
  assert.equal((read("functions/src/booking/invoice-corrections.ts").match(/requeueStudioInvoicePdf\(/g) ?? []).length, 2);
});

const base = (invoices: Doc[]): TodayInput =>
  ({
    now: "2026-10-09T12:00:00.000Z",
    projects: [{ id: "p", tenantId: "t", name: "Maya & Theo Johnson", state: "RETAINER_PENDING", eventDate: "2027-06-12" }],
    invoiceReferences: invoices,
  }) as unknown as TodayInput;

test("Today: an invoice the studio issued, not yet sent, is a card; sent, it's gone", () => {
  const draft = { id: "inv1", tenantId: "t", projectId: "p", kind: "retainer", billedBy: "studio", provider: null, status: "draft", number: "INV-0001", balanceCents: 120_000, dueDate: "2026-10-23" };
  const card = todayInbox(base([draft])).act.find((item) => item.id === "studio-invoice-inv1");
  assert.ok(card);
  assert.match(card.title, /deposit invoice · \$1,200$/);
  assert.match(card.detail ?? "", /^INV-0001 is ready, with its PDF, due /);
  assert.deepEqual(card.action, { kind: "studio_invoice", label: "Email it", projectId: "p", invoiceId: "inv1" });
  assert.ok(!todayInbox(base([{ ...draft, status: "sent" }])).act.some((item) => item.id === "studio-invoice-inv1"));
  // A QuickBooks bill is never a studio invoice card.
  assert.ok(!todayInbox(base([{ ...draft, billedBy: undefined, provider: "quickbooks" }])).act.some((item) => item.id === "studio-invoice-inv1"));
});

test("the booking page, Today and the agreement send all offer the studio invoice", () => {
  assert.match(read("components/booking/project-booking-workspace.tsx"), /<StudioDepositPanel/);
  assert.match(read("components/today/today-inbox.tsx"), /item\.action\.kind === "studio_invoice"/);
  const send = read("components/contracts/combined-agreement-send.tsx");
  assert.match(send, /billing\?\.canChoose && !billing\.decided \? \(\s*<JobBillingChoice/);
  const actions = read("components/booking/studio-invoice-actions.tsx");
  assert.match(actions, /I sent it myself/);
  assert.match(actions, /Download PDF/);
});
