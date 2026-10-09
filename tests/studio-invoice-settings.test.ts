import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as features from "../features/billing/studio-invoice-settings";
import * as functionsCopy from "../functions/src/billing/studio-invoice-settings";
import * as numberFeatures from "../features/billing/invoice-number";
import * as numberFunctions from "../functions/src/billing/invoice-number";
import { invoiceReferenceSchema } from "../features/invoices/schema";

/**
 * What goes on an invoice a studio issues itself, and how those invoices are
 * numbered (docs/own-invoicing-plan-2026-10-09.md, Phase 0).
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const shared = (source: string) => source.slice(source.indexOf("// --- shared with"));

test("the features and functions copies match", () => {
  assert.equal(
    shared(read("functions/src/billing/studio-invoice-settings.ts")),
    shared(read("features/billing/studio-invoice-settings.ts")),
  );
  assert.equal(shared(read("functions/src/billing/invoice-number.ts")), shared(read("features/billing/invoice-number.ts")));
});

for (const [name, module] of [
  ["features", features],
  ["functions", functionsCopy],
] as const) {
  test(`${name}: a studio that saved nothing gets plain defaults and no tax`, () => {
    assert.deepEqual(module.normaliseStudioInvoiceSettings(null), module.defaultStudioInvoiceSettings());
    assert.deepEqual(module.normaliseStudioInvoiceSettings({ salesTax: { mode: "quickbooks" } }).tax, {
      rateBasisPoints: null,
      label: null,
    });
    assert.equal(module.normaliseStudioInvoiceSettings(null).dueDays, 14);
  });

  test(`${name}: stored values are trimmed, capped and checked`, () => {
    const settings = module.normaliseStudioInvoiceSettings({
      studioInvoices: {
        businessName: "  Spin Theory  ",
        businessAddress: "1 Main St\r\nAustin, TX",
        paymentInstructions: "x".repeat(2000),
        payLinkUrl: "http://pay.example.com",
        dueDays: 500,
        tax: { rateBasisPoints: 825, label: "" },
        footer: "   ",
        unknown: "dropped",
      },
    });
    assert.equal(settings.businessName, "Spin Theory");
    assert.equal(settings.businessAddress, "1 Main St\nAustin, TX");
    assert.equal(settings.paymentInstructions?.length, module.STUDIO_INVOICE_TEXT_LIMITS.paymentInstructions);
    // Only https: an invoice link must never be downgraded.
    assert.equal(settings.payLinkUrl, null);
    assert.equal(settings.dueDays, module.STUDIO_INVOICE_MAX_DUE_DAYS);
    assert.deepEqual(settings.tax, { rateBasisPoints: 825, label: "Sales tax" });
    assert.equal(settings.footer, null);
    assert.equal("unknown" in settings, false);
  });

  test(`${name}: pay links, due days and tax rates`, () => {
    assert.equal(module.normalisePayLink("https://square.link/u/abc"), "https://square.link/u/abc");
    assert.equal(module.normalisePayLink("javascript:alert(1)"), null);
    assert.equal(module.normalisePayLink("https://localhost"), null);
    assert.equal(module.normaliseDueDays(0), 0);
    assert.equal(module.normaliseDueDays("abc"), 14);
    assert.equal(module.normaliseTaxRate(0), null);
    assert.equal(module.normaliseTaxRate(2600), null);
    assert.equal(module.normaliseTaxRate(825.4), 825);
    assert.equal(module.studioInvoiceTaxCents(100_000, { tax: { rateBasisPoints: 825, label: "Tax" } }), 8250);
    assert.equal(module.studioInvoiceTaxCents(100_000, { tax: { rateBasisPoints: null, label: null } }), 0);
    assert.equal(module.studioInvoicePaymentReady({ paymentInstructions: null, payLinkUrl: null }), false);
    assert.equal(module.studioInvoicePaymentReady({ paymentInstructions: "Zelle", payLinkUrl: null }), true);
  });
}

test("invoice numbers are padded, never reused, and start at one", () => {
  for (const copy of [numberFeatures, numberFunctions]) {
    assert.equal(copy.formatInvoiceNumber(1), "INV-0001");
    assert.equal(copy.formatInvoiceNumber(42), "INV-0042");
    assert.equal(copy.formatInvoiceNumber(12345), "INV-12345");
    assert.throws(() => copy.formatInvoiceNumber(0));
    assert.equal(copy.nextInvoiceSequence(null), 1);
    assert.equal(copy.nextInvoiceSequence({ next: 7 }), 7);
    assert.equal(copy.nextInvoiceSequence({ next: -3 }), 1);
  }
  const allocator = read("functions/src/billing/invoice-number.ts");
  // Read before the write, and the write moves the counter past the number given.
  assert.match(allocator, /await transaction\.get\(reference\)/);
  assert.match(allocator, /next: sequence \+ 1/);
});

test("the settings are saved by an audited owner/admin command, and erased with the studio", () => {
  const command = read("functions/src/integrations/commands.ts");
  assert.match(command, /type: z\.literal\("setStudioInvoiceSettings"\)/);
  assert.match(command, /action: "billing\.invoice_settings_set"/);
  assert.match(command, /INVOICE_PAY_LINK_INVALID/);
  // Saved under its own key and merged, so the QuickBooks settings beside it survive.
  assert.match(command, /studioInvoices: after,[\s\S]{0,120}\{ merge: true \}/);
  const lifecycle = read("functions/src/saas/data-lifecycle.ts");
  assert.match(lifecycle, /"billingSettings"/);
  assert.match(lifecycle, /"invoiceCounters"/);
  const rules = read("firestore.rules");
  assert.match(rules, /match \/invoiceCounters\/\{tenantId\} \{\s*allow read, write: if false;/);
});

test("the invoice schema describes what is actually stored", () => {
  const base = {
    id: "invoice_1",
    tenantId: "t",
    projectId: "p",
    kind: "retainer",
    currency: "USD",
    amountCents: 120_000,
    balanceCents: 0,
    dueDate: "2026-11-01",
    archivedAt: null,
    createdAt: "2026-10-09T10:00:00.000Z",
    updatedAt: "2026-10-09T10:00:00.000Z",
    createdBy: "u",
    updatedBy: "u",
  };
  // Recorded by hand: no provider.
  assert.ok(
    invoiceReferenceSchema.safeParse({
      ...base,
      provider: null,
      providerState: "not_applicable",
      status: "paid",
      completionAuthority: "manual_attested",
    }).success,
  );
  for (const status of ["failed", "superseded", "review_required", "awaiting_delivery"])
    assert.ok(invoiceReferenceSchema.safeParse({ ...base, provider: "quickbooks", status }).success, status);
  // Billed by the studio through StudioCue.
  assert.ok(
    invoiceReferenceSchema.safeParse({
      ...base,
      provider: null,
      status: "sent",
      billedBy: "studio",
      number: "INV-0042",
      lines: [{ description: "Full day", quantity: 1, unitAmountCents: 120_000, amountCents: 120_000 }],
      taxCents: 0,
    }).success,
  );
});
