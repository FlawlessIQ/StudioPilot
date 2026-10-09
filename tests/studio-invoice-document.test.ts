import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as features from "../features/billing/studio-invoice-document";
import * as functionsCopy from "../functions/src/billing/studio-invoice-document";
import { invoicePayNote } from "../features/client/invoice-pay-route";
import { billingAddressLines, invoicePdfJobId, invoicePdfPath } from "../functions/src/billing/studio-invoice-pdf";
import { sampleStudioInvoice } from "../functions/src/billing/studio-invoice-preview";

/**
 * The invoice a studio issues itself, as the client will read it (own
 * invoicing, Phase 1; docs/own-invoicing-plan-2026-10-09.md). The words and
 * figures are decided in one place and the PDF service only draws them, so
 * these read the payload itself.
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const shared = (source: string) => source.slice(source.indexOf("// --- shared with"));

const stored = (overrides: Record<string, unknown> = {}) => ({
  tenantId: "t",
  projectId: "p",
  kind: "final",
  provider: null,
  billedBy: "studio",
  number: "INV-0042",
  status: "sent",
  currency: "USD",
  amountCents: 817_288,
  balanceCents: 617_288,
  taxCents: 62_288,
  issuedAt: "2026-10-09T12:00:00.000Z",
  dueDate: "2027-05-29",
  lines: [
    { description: "Signature Collection", quantity: 1, unitAmountCents: 650_000, amountCents: 650_000 },
    { description: "Extra hour", quantity: 2, unitAmountCents: 30_000, amountCents: 60_000 },
    { description: "Engagement session", quantity: 1, unitAmountCents: 45_000, amountCents: 45_000 },
  ],
  studioPayments: [{ id: "pay1", amountCents: 200_000, paidAt: "2026-10-02", method: "Zelle" }],
  ...overrides,
});

const studio = {
  name: "Alder & Muse",
  logoUrl: null,
  settings: {
    businessName: null,
    businessAddress: "214 Hudson Street\nKingston, NY 12401",
    businessEmail: "billing@alderandmuse.test",
    businessPhone: null,
    paymentInstructions: "Zelle to billing@alderandmuse.test",
    payLinkUrl: "https://square.link/u/alder",
    tax: { rateBasisPoints: 825, label: "Sales tax" },
    footer: "Thank you!",
  },
};

const payload = (overrides: Record<string, unknown> = {}, module: typeof features = features) => {
  const invoice = module.studioInvoiceSource("invoice_1", stored(overrides));
  assert.ok(invoice);
  return module.studioInvoicePdfPayload({
    invoice,
    studio,
    client: { name: "Maya Johnson", email: "maya@example.com", addressLines: ["88 Orchard Lane", "Rhinebeck, NY 12572"] },
    job: { name: "Maya & Theo Johnson", eventDate: "2027-06-12" },
    generatedAt: "2026-10-09T21:00:00.000Z",
  });
};

test("the features and functions copies match", () => {
  assert.equal(
    shared(read("functions/src/billing/studio-invoice-document.ts")),
    shared(read("features/billing/studio-invoice-document.ts")),
  );
  assert.deepEqual(payload({}, functionsCopy as never), payload());
});

test("only an invoice the studio issued through StudioCue gets a StudioCue PDF", () => {
  assert.ok(features.studioInvoiceSource("i", stored()));
  // A QuickBooks bill, a payment recorded by hand, one with no number yet.
  assert.equal(features.studioInvoiceSource("i", stored({ provider: "quickbooks" })), null);
  assert.equal(features.studioInvoiceSource("i", stored({ billedBy: undefined })), null);
  assert.equal(features.studioInvoiceSource("i", stored({ number: "" })), null);
});

test("an owed invoice: lines, tax, a payment received, the balance and how to pay", () => {
  const pdf = payload();
  assert.equal(pdf.invoice_number, "INV-0042");
  assert.equal(pdf.kind_label, "Final balance");
  assert.equal(pdf.stamp, "");
  assert.equal(pdf.issued_on, "October 9, 2026");
  assert.equal(pdf.due_on, "May 29, 2027");
  assert.equal(pdf.studio.name, "Alder & Muse");
  assert.deepEqual(pdf.studio.address_lines, ["214 Hudson Street", "Kingston, NY 12401"]);
  assert.equal(pdf.job_line, "Maya & Theo Johnson · Saturday, June 12, 2027");
  assert.deepEqual(pdf.lines[1], { description: "Extra hour", quantity: "2", unit_amount: "$300.00", amount: "$600.00" });
  assert.deepEqual(pdf.totals, [
    { label: "Subtotal", amount: "$7,550.00" },
    { label: "Sales tax (8.25%)", amount: "$622.88" },
    { label: "Total", amount: "$8,172.88" },
  ]);
  assert.deepEqual(pdf.payments, [{ label: "Paid October 2, 2026 · Zelle", amount: "−$2,000.00" }]);
  assert.equal(pdf.balance_due, "$6,172.88");
  assert.equal(pdf.payment_instructions, "Zelle to billing@alderandmuse.test");
  assert.equal(pdf.pay_link, "https://square.link/u/alder");
  assert.equal(pdf.footer, "Thank you!");
});

test("the printed arithmetic always holds, even when the payment entries don't", () => {
  // A whole bill recorded paid with no entries, or a corrected payment.
  const pdf = payload({ studioPayments: [], balanceCents: 0 });
  assert.deepEqual(pdf.payments, [{ label: "Paid to date", amount: "−$8,172.88" }]);
  const corrected = payload({ studioPayments: [{ amountCents: 300_000 }], balanceCents: 617_288 });
  assert.deepEqual(corrected.payments, [{ label: "Paid to date", amount: "−$2,000.00" }]);
  // Nothing paid: no payment lines at all.
  assert.deepEqual(payload({ studioPayments: [], balanceCents: 817_288 }).payments, []);
});

test("paid and void invoices say so, and stop asking for money", () => {
  const paid = payload({ balanceCents: 0, studioPayments: [] });
  assert.equal(paid.stamp, "PAID");
  assert.equal(paid.due_on, "Paid");
  assert.equal(paid.payment_instructions, "");
  assert.equal(paid.pay_link, "");
  const voided = payload({ status: "voided" });
  assert.equal(voided.stamp, "VOID");
  assert.equal(voided.balance_due, "$0.00");
  assert.equal(voided.pay_link, "");
});

test("no tax, due on receipt, the bill's own pay link, and the client's words for each bill", () => {
  const untaxed = payload({ taxCents: 0, amountCents: 755_000, balanceCents: 755_000, studioPayments: [] });
  assert.deepEqual(untaxed.totals, [{ label: "Total", amount: "$7,550.00" }]);
  assert.equal(payload({ dueDate: "2026-10-09" }).due_on, "Due on receipt");
  assert.equal(payload({ dueDate: null }).due_on, "Due on receipt");
  assert.equal(payload({ payLinkUrl: "https://paypal.me/alder" }).pay_link, "https://paypal.me/alder");
  assert.equal(features.invoiceKindLabel("retainer", false), "Deposit");
  assert.equal(features.invoiceKindLabel("retainer", true), "Payment in full");
  assert.equal(features.invoiceKindLabel("final", false), "Final balance");
  // No lines stored: one line named for the bill, at its pre-tax amount.
  assert.deepEqual(payload({ lines: [] }).lines, [
    { description: "Final balance", quantity: "1", unit_amount: "$7,550.00", amount: "$7,550.00" },
  ]);
  assert.equal(features.studioInvoiceFileName("INV-0042", "Maya & Theo Johnson"), "inv-0042-maya-theo-johnson.pdf");
});

test("the PDF service accepts exactly the payload the builder makes", () => {
  // Field names cross a language boundary: a renamed key is a 422 in production.
  const python = read("cloud-run/pdf/invoice.py");
  const fieldsOf = (className: string) => {
    const block = python.slice(python.indexOf(`class ${className}(BaseModel):`));
    const body = block.slice(block.indexOf("\n") + 1, block.search(/\n\n\n|\nclass |\ndef /));
    return [...body.matchAll(/^ {4}(\w+):/gm)].map((match) => match[1]).sort();
  };
  const pdf = payload();
  assert.deepEqual(fieldsOf("InvoiceRequest"), Object.keys(pdf).sort());
  assert.deepEqual(fieldsOf("InvoiceStudio"), Object.keys(pdf.studio).sort());
  assert.deepEqual(fieldsOf("InvoiceBillTo"), Object.keys(pdf.bill_to).sort());
  assert.deepEqual(fieldsOf("InvoiceLine"), Object.keys(pdf.lines[0]!).sort());
  assert.deepEqual(fieldsOf("InvoiceRow"), Object.keys(pdf.totals[0]!).sort());
  assert.match(read("cloud-run/pdf/main.py"), /@app\.post\("\/v1\/invoices\/pdf"\)/);
  assert.match(read("cloud-run/pdf/Dockerfile"), /invoice\.py/);
  // And the sample fixture stays a valid request.
  const sample = JSON.parse(read("cloud-run/pdf/sample-invoice.json")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(sample).sort(), Object.keys(pdf).sort());
});

test("each revision has its own path, and the worker stores the latest for the client", () => {
  assert.equal(invoicePdfJobId("invoice_1", 3), "invoice_invoice_1_r3");
  assert.equal(invoicePdfPath("t", "p", "invoice_1", 3), "tenants/t/projects/p/invoices/invoice_1/r3.pdf");
  assert.deepEqual(
    billingAddressLines({ line1: "88 Orchard Lane", line2: "", city: "Rhinebeck", region: "NY", postalCode: "12572", country: "US" }),
    ["88 Orchard Lane", "Rhinebeck, NY 12572"],
  );
  const store = read("functions/src/billing/studio-invoice-pdf.ts");
  // A slow render never puts an older balance back in front of the client.
  assert.match(store, /if \(landed >= revision\) return \{ documentId, path, revision, stale: true \}/);
  assert.match(store, /visibility: "client"/);
  const worker = read("functions/src/operations/ai-pdf.ts");
  assert.match(worker, /if\(type===INVOICE_PDF_JOB_TYPE\)return studioInvoicePdfInput\(db,job\)/);
  assert.match(worker, /INVOICE_PDF_JOB_TYPE\)return storeStudioInvoicePdf\(/);
});

test("the client sees a sent studio invoice with its PDF, instructions and the studio's own pay link", () => {
  const route = read("app/api/client/portal/route.ts");
  assert.match(route, /value\.billedBy === "studio" && value\.status === "draft"\) \{\s*return \[\];/);
  assert.match(route, /sanitized\.pdfStoragePath = pdfPath/);
  assert.match(route, /startsWith\(`tenants\/\$\{tenantId\}\/projects\/\$\{projectId\}\/invoices\/`\)/);
  // Deposit by the studio follows the job, not whether QuickBooks is connected.
  assert.match(route, /jobBillingFromRecords\(\{[\s\S]{0,400}\}\)\.method === "studio"/);
  assert.equal(
    invoicePayNote("direct", { studioName: "Alder & Muse", invoiceName: "Deposit", providerName: null, hasInstructions: true }),
    "Your deposit invoice is ready. Alder & Muse takes this payment directly — here's how to pay.",
  );
  assert.equal(
    invoicePayNote("online", { studioName: "Alder & Muse", invoiceName: "Deposit", providerName: null }),
    "Payment opens on Alder & Muse's own payment page. StudioCue never receives your card or bank details.",
  );
  const page = read("components/client/kit/client-payments.tsx");
  assert.match(page, /Download invoice/);
  assert.match(page, /resolveFile\(/);
});

test("the sample invoice adds up, and uses the studio's next number without taking it", () => {
  const sample = sampleStudioInvoice({ number: "INV-0007", rateBasisPoints: 825, today: "2026-10-09" });
  const subtotal = sample.lines.reduce((sum, line) => sum + line.amountCents, 0);
  assert.equal(sample.amountCents, subtotal + sample.taxCents);
  assert.equal(sample.taxCents, Math.round((subtotal * 825) / 10000));
  assert.equal(sample.dueDate, "2026-10-23");
  assert.equal(sample.number, "INV-0007");
  const preview = read("functions/src/billing/studio-invoice-preview.ts");
  assert.doesNotMatch(preview, /reserveInvoiceNumber|\.set\(|\.update\(/);
});
