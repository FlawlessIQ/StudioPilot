import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  balanceWithSalesTax,
  combinePricedSalesTax,
  plusSalesTaxPhrase,
  readPricedSalesTax,
  salesTaxEstimateText,
  salesTaxSentence,
  salesTaxTreatment,
  totalWithSalesTax,
} from "@/features/billing/sales-tax-pricing";
import { pricePackage, type PricedSalesTax, type SalesTaxTreatment } from "@/features/pricing/package-price";
import { combineSnapshotPricing } from "@/features/proposals/combined-pricing";
import { inlineText, resolveContractDocument, type ContractSources } from "@/features/contracts/document";
import { buildCombinedAgreement } from "@/features/contracts/combined";
import { createPackageSnapshot } from "@/features/packages/create-snapshot";
import { couplePackageView } from "@/features/packages/job-packages";
import { combineSnapshotPricing as functionsCombine } from "../functions/src/proposals/combined-pricing";
import { pricePackage as functionsPrice } from "../functions/src/pricing/package-price";
import { fieldsOf, repriceSnapshot } from "../functions/src/pricing/reprice-snapshot";
import { amendmentOneOffRecords, repriceKeptSnapshot } from "../functions/src/booking/amendment-packages";
import { amendmentChangeLines, amendmentMoney } from "../functions/src/booking/amendment-core";
import {
  proposalPdfAdjustments,
  proposalPdfPaymentAmount,
  proposalPdfSalesTax,
} from "../functions/src/proposals/pdf-adjustments";
import { resolveContractDocument as functionsResolve } from "../functions/src/contracts/document";

/**
 * Owner's decision, 2026-10-01: where QuickBooks works the sales tax out on
 * the final invoice (billingSettings salesTax.mode "quickbooks", and the
 * studio switched on for itemised QuickBooks invoices), the price the couple
 * agrees to is pre-tax, "plus sales tax", with an estimate. Every other
 * studio prices exactly as before.
 */

const MARKER = "// ── mirrored below ──";
const below = (path: string) => {
  const source = readFileSync(path, "utf8");
  return source.slice(source.indexOf(MARKER));
};

test("the functions copy of the sales-tax pricing rules is the same", () => {
  assert.equal(below("functions/src/billing/sales-tax-pricing.ts"), below("features/billing/sales-tax-pricing.ts"));
});

// ── The gate ─────────────────────────────────────────────────────────────

const quickBooksSettings = { tenantId: "t1", salesTax: { mode: "quickbooks", estimateRateBasisPoints: 663 } };
const switchedOn = { quickbooksItemisedInvoices: true };

test("only QuickBooks sales tax on a switched-on studio prices pre-tax", () => {
  const gate = (billingSettings: unknown, tenantFeatures: unknown, project: Record<string, unknown> = {}) =>
    salesTaxTreatment({ tenantId: "t1", billingSettings, tenantFeatures, project });
  // No settings, mode "none", or not switched on: the old way.
  assert.equal(gate(undefined, switchedOn), null);
  assert.equal(gate({ salesTax: { mode: "none", estimateRateBasisPoints: 663 } }, switchedOn), null);
  assert.equal(gate(quickBooksSettings, undefined), null);
  assert.equal(gate(quickBooksSettings, { quickbooksItemisedInvoices: "yes" }), null);
  // Both: pre-tax, at the studio's estimate rate.
  assert.deepEqual(gate(quickBooksSettings, switchedOn), { exempt: false, rateBasisPoints: 663 });
  assert.deepEqual(gate({ salesTax: { mode: "quickbooks" } }, switchedOn), { exempt: false, rateBasisPoints: null });
  // An exempt job: no tax, no estimate.
  assert.deepEqual(gate(quickBooksSettings, switchedOn, { salesTaxExempt: true }), { exempt: true, rateBasisPoints: null });
});

// ── Pricing ──────────────────────────────────────────────────────────────

const basePackage = {
  basePriceCents: 800_000,
  addOns: [
    { unitPriceCents: 50_000, quantity: 1, taxable: true },
    { unitPriceCents: 29_800, quantity: 1, taxable: false },
  ],
  discount: { type: "none" } as const,
  taxRateBasisPoints: 887,
  retainerRule: { type: "percentage", basisPoints: 2500 } as const,
  billedCrew: 1,
};
const gated: SalesTaxTreatment = { exempt: false, rateBasisPoints: 663 };

test("without the gate a package prices exactly as it always did", () => {
  const priced = pricePackage(basePackage);
  assert.equal(priced.subtotalCents, 879_800);
  assert.equal(priced.taxCents, Math.round((850_000 * 887) / 10000));
  assert.equal(priced.totalCents, 879_800 + priced.taxCents);
  assert.equal(priced.retainerCents, Math.round((priced.totalCents * 2500) / 10000));
  assert.equal("salesTax" in priced, false);
  assert.deepEqual(pricePackage({ ...basePackage, salesTax: null }), priced);
});

test("with the gate the total is pre-tax, the estimate is recorded, and the retainer is a share of the pre-tax total", () => {
  const priced = pricePackage({ ...basePackage, salesTax: gated });
  assert.equal(priced.taxCents, 0);
  assert.equal(priced.totalCents, 879_800);
  assert.equal(priced.retainerCents, Math.round((879_800 * 2500) / 10000));
  // On the taxable part only, at the studio's estimate rate, not the package's.
  assert.deepEqual(priced.salesTax, {
    mode: "quickbooks",
    exempt: false,
    estimatedCents: Math.round((850_000 * 663) / 10000),
    rateBasisPoints: 663,
  });
  // A fixed retainer is the amount it was.
  const fixed = pricePackage({ ...basePackage, retainerRule: { type: "fixed", amountCents: 150_000 }, salesTax: gated });
  assert.equal(fixed.retainerCents, 150_000);
  // The functions copy agrees.
  assert.deepEqual(functionsPrice({ ...basePackage, salesTax: gated }), priced);
});

test("an exempt job has no tax and no estimate", () => {
  const priced = pricePackage({ ...basePackage, salesTax: { exempt: true, rateBasisPoints: 663 } });
  assert.equal(priced.taxCents, 0);
  assert.equal(priced.totalCents, 879_800);
  assert.deepEqual(priced.salesTax, { mode: "quickbooks", exempt: true, estimatedCents: 0, rateBasisPoints: null });
  assert.equal(salesTaxSentence(priced.salesTax!, "USD"), "No sales tax on this booking.");
});

test("a snapshot records the decision it was priced with", () => {
  const studioPackage = {
    id: "gold",
    tenantId: "t1",
    eventTypeId: "wedding",
    name: "Gold",
    description: "Gold coverage",
    basePriceCents: 800_000,
    currency: "USD",
    retainerRule: { type: "percentage", basisPoints: 2500 },
    includedCoverageMinutes: 480,
    includedPhotographers: 1,
    includedDeliverables: ["Online gallery"],
    includedTravelArea: "Local",
    addOns: [],
    taxRateBasisPoints: 887,
    terms: "Standard terms.",
    active: true,
    publicVisible: true,
    displayOrder: 0,
    internalNotes: null,
    version: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    createdBy: "u1",
    updatedBy: "u1",
    archivedAt: null,
  } as unknown as Parameters<typeof createPackageSnapshot>[0]["package"];
  const input = {
    id: "s1",
    tenantId: "t1",
    projectId: "p1",
    selectedBy: "u1",
    selectedAt: "2026-10-01T00:00:00.000Z",
    package: studioPackage,
    selection: { packageId: "gold", selectedAddOns: [], discount: { type: "none" as const } },
  };
  const old = createPackageSnapshot(input);
  assert.equal(old.taxCents, 70_960);
  assert.equal(old.salesTax, undefined);
  const now = createPackageSnapshot({ ...input, salesTax: gated });
  assert.equal(now.taxCents, 0);
  assert.equal(now.totalCents, 800_000);
  assert.deepEqual(now.salesTax, { mode: "quickbooks", exempt: false, estimatedCents: 53_040, rateBasisPoints: 663 });
});

// ── Combined pricing ─────────────────────────────────────────────────────

const snapshotPricing = (salesTax?: PricedSalesTax | null) => ({
  packageName: "Gold",
  currency: "USD",
  subtotalCents: 800_000,
  discountCents: 0,
  taxCents: 0,
  retainerCents: 200_000,
  totalCents: 800_000,
  ...(salesTax === undefined ? {} : { salesTax }),
  lineItems: [{ description: "Gold", quantity: 1, unitPriceCents: 800_000, totalCents: 800_000 }],
});

test("combined pricing carries the estimate, and nothing for a proposal priced the old way", () => {
  const photo: PricedSalesTax = { mode: "quickbooks", exempt: false, estimatedCents: 53_040, rateBasisPoints: 663 };
  const video: PricedSalesTax = { mode: "quickbooks", exempt: false, estimatedCents: 19_890, rateBasisPoints: 663 };
  for (const combine of [combineSnapshotPricing, functionsCombine]) {
    const both = combine([snapshotPricing(photo), { ...snapshotPricing(video), packageName: "Film" }]);
    assert.deepEqual(both.salesTax, { mode: "quickbooks", exempt: false, estimatedCents: 72_930, rateBasisPoints: 663 });
    assert.equal(both.taxCents, 0);
    assert.equal(both.totalCents, 1_600_000);
    // The old way: the exact shape it always had.
    const legacy = combine([snapshotPricing()]);
    assert.equal("salesTax" in legacy, false);
    assert.equal("salesTax" in combine([snapshotPricing(null)]), false);
  }
  assert.deepEqual(
    combinePricedSalesTax([
      { mode: "quickbooks", exempt: true, estimatedCents: 0, rateBasisPoints: null },
      { mode: "quickbooks", exempt: true, estimatedCents: 0, rateBasisPoints: null },
    ]),
    { mode: "quickbooks", exempt: true, estimatedCents: 0, rateBasisPoints: null },
  );
  assert.equal(readPricedSalesTax({ mode: "stripe" }), null);
  assert.equal(readPricedSalesTax(null), null);
});

// ── Wording ──────────────────────────────────────────────────────────────

const estimate: PricedSalesTax = { mode: "quickbooks", exempt: false, estimatedCents: 58_330, rateBasisPoints: 663 };
const noRate: PricedSalesTax = { mode: "quickbooks", exempt: false, estimatedCents: 0, rateBasisPoints: null };
const exempt: PricedSalesTax = { mode: "quickbooks", exempt: true, estimatedCents: 0, rateBasisPoints: null };

test("the words", () => {
  assert.equal(
    totalWithSalesTax("$8,798.00", estimate, "USD"),
    "$8,798.00 plus sales tax (about $583 at 6.63%, worked out on your final invoice)",
  );
  assert.equal(totalWithSalesTax("$8,798.00", noRate, "USD"), "$8,798.00 plus sales tax, worked out on your final invoice");
  assert.equal(totalWithSalesTax("$8,798.00", exempt, "USD"), "$8,798.00 (no sales tax on this booking)");
  assert.equal(totalWithSalesTax("$8,798.00", null, "USD"), "$8,798.00");
  assert.equal(balanceWithSalesTax("$4,399.00", estimate), "$4,399.00 plus sales tax");
  assert.equal(balanceWithSalesTax("$4,399.00", exempt), "$4,399.00");
  assert.equal(balanceWithSalesTax("$4,399.00", null), "$4,399.00");
  assert.equal(plusSalesTaxPhrase(exempt, "USD"), "");
  assert.equal(salesTaxEstimateText(estimate, "USD"), "about $583");
  assert.equal(salesTaxEstimateText(noRate, "USD"), "On your final invoice");
  assert.equal(salesTaxEstimateText(exempt, "USD"), null);
  assert.equal(
    salesTaxSentence(estimate, "USD"),
    "Plus sales tax: about $583 at 6.63%, worked out on your final invoice. It isn't included in the total.",
  );
  assert.equal(salesTaxSentence(noRate, "USD"), "Plus sales tax, worked out on your final invoice.");
  assert.equal(salesTaxSentence(null, "USD"), null);
  assert.equal(
    totalWithSalesTax("$8,798.00", { ...estimate, rateBasisPoints: 600 }, "USD"),
    "$8,798.00 plus sales tax (about $583 at 6%, worked out on your final invoice)",
  );
});

// ── The agreement ────────────────────────────────────────────────────────

const sources = (salesTax?: PricedSalesTax | null): ContractSources => ({
  client: { names: "Erin & Joe", email: "erin@example.com" },
  event: { name: "Erin & Joe Wedding", type: "Wedding", date: "2027-06-12", venue: "The Barn" },
  packages: [{ name: "Gold", totalCents: 879_800 }],
  package: { name: "Gold", coverage: null, deliverables: ["Online gallery"] },
  pricing: {
    currency: "USD",
    totalCents: 879_800,
    retainerCents: 440_000,
    discountCents: 50_000,
    ...(salesTax === undefined ? {} : { salesTax }),
  },
  paymentSchedule: [
    { label: "Retainer", amountCents: 440_000, dueDate: null },
    { label: "Final balance", amountCents: 439_800, dueDate: "2027-05-15" },
  ],
  formAnswers: [],
  studio: { name: "GR Productions", legalName: null, address: null, phone: null, email: null, website: null },
  contractDate: "2026-10-01",
});
const template = {
  title: "Agreement",
  body: ["Total: {{price.total}}", "", "Balance: {{price.balance}}", "", "Plan: {{payment.schedule}}", "", "{{payment.schedule}}"].join(
    "\n",
  ),
  customFields: [],
};
const merged = (resolve: typeof resolveContractDocument, salesTax?: PricedSalesTax | null) => {
  const resolved = resolve({ template, sources: sources(salesTax), overrides: {} });
  const value = (key: string) => resolved.fields.find((field) => field.key === key)?.value;
  const table = resolved.document.blocks.find((block) => block.type === "payment_schedule");
  return {
    document: resolved.document,
    total: value("price.total"),
    balance: value("price.balance"),
    schedule: value("payment.schedule"),
    rows: table && table.type === "payment_schedule" ? table.rows.map((row) => row.amount) : [],
  };
};

test("a studio without QuickBooks sales tax signs exactly the words it always did", () => {
  for (const resolve of [resolveContractDocument, functionsResolve as typeof resolveContractDocument]) {
    const legacy = merged(resolve);
    assert.equal(legacy.total, "$8,798.00 (after a $500.00 discount)");
    assert.equal(legacy.balance, "$4,398.00");
    assert.equal(legacy.schedule, "Retainer $4,400.00; Final balance $4,398.00");
    assert.deepEqual(legacy.rows, ["$4,400.00", "$4,398.00"]);
    // Byte-identical whether the field is absent or null.
    assert.equal(JSON.stringify(merged(resolve, null).document), JSON.stringify(legacy.document));
  }
});

test("a pre-tax booking's agreement says plus sales tax beside the total, the balance and the last payment", () => {
  for (const resolve of [resolveContractDocument, functionsResolve as typeof resolveContractDocument]) {
    const now = merged(resolve, estimate);
    assert.equal(
      now.total,
      "$8,798.00 (after a $500.00 discount) plus sales tax (about $583 at 6.63%, worked out on your final invoice)",
    );
    assert.equal(now.balance, "$4,398.00 plus sales tax");
    assert.equal(now.schedule, "Retainer $4,400.00; Final balance $4,398.00 plus sales tax");
    assert.deepEqual(now.rows, ["$4,400.00", "$4,398.00 plus sales tax"]);
    assert.equal(merged(resolve, noRate).total, "$8,798.00 (after a $500.00 discount) plus sales tax, worked out on your final invoice");
    const free = merged(resolve, exempt);
    assert.equal(free.total, "$8,798.00 (after a $500.00 discount) (no sales tax on this booking)");
    assert.equal(free.balance, "$4,398.00");
  }
});

test("Part 2 of a booking agreement shows the estimate under the total, not in it", () => {
  const terms = { format: 1 as const, title: "Agreement", blocks: [] };
  const coverage = {
    currency: "USD",
    lineItems: [{ description: "Gold", quantity: 1, totalCents: 879_800, kind: "package" }],
    discountCents: 0,
    taxCents: 0,
    totalCents: 879_800,
    paymentSchedule: [
      { label: "Retainer", amountCents: 440_000, dueDate: null },
      { label: "Final balance", amountCents: 439_800, dueDate: null },
    ],
  };
  const textOf = (document: ReturnType<typeof buildCombinedAgreement>["document"]) =>
    document.blocks
      .flatMap((block) =>
        block.type === "list"
          ? block.items.map((item) => inlineText(item.content))
          : block.type === "payment_schedule"
            ? block.rows.map((row) => `${row.label} ${row.amount}`)
            : "content" in block
              ? [inlineText(block.content)]
              : [],
      )
      .join("\n");
  const legacy = textOf(buildCombinedAgreement(terms, coverage).document);
  assert.match(legacy, /^Total: \$8,798\.00$/m);
  assert.doesNotMatch(legacy, /sales tax/);
  assert.equal(textOf(buildCombinedAgreement(terms, { ...coverage, salesTax: null }).document), legacy);
  const now = textOf(buildCombinedAgreement(terms, { ...coverage, salesTax: estimate }).document);
  assert.match(now, /^Total: \$8,798\.00 plus sales tax \(about \$583 at 6\.63%, worked out on your final invoice\)$/m);
  assert.match(now, /^Estimated sales tax \(on final invoice\): about \$583\. Not included in the total above\.$/m);
  assert.match(now, /^Final balance \$4,398\.00 plus sales tax$/m);
  assert.match(now, /^Retainer \$4,400\.00$/m);
});

// ── The PDF ──────────────────────────────────────────────────────────────

test("the proposal PDF: lines add up to the pre-tax total, the estimate printed beneath it", () => {
  const pricing = {
    currency: "USD",
    subtotalCents: 929_800,
    discountCents: 50_000,
    taxCents: 0,
    totalCents: 879_800,
    salesTax: estimate,
    lineItems: [
      { description: "Gold", totalCents: 850_000 },
      { description: "Album", totalCents: 79_800 },
    ],
  };
  const adjustments = proposalPdfAdjustments(pricing);
  assert.deepEqual(adjustments, [{ description: "Discount", cents: -50_000 }]);
  const sum = pricing.lineItems.reduce((total, line) => total + line.totalCents, 0) + adjustments.reduce((total, row) => total + row.cents, 0);
  assert.equal(sum, pricing.totalCents);
  assert.deepEqual(proposalPdfSalesTax(pricing, "USD"), {
    totalLabel: "Total, plus sales tax",
    afterTotal: [
      {
        description: "Estimated sales tax (on final invoice)",
        amount: "about $583",
        details: ["About 6.63%, worked out from your billing address on your final invoice. Not included in the total above."],
      },
    ],
  });
  assert.equal(proposalPdfPaymentAmount(pricing, "$4,398.00", true), "$4,398.00 plus sales tax");
  assert.equal(proposalPdfPaymentAmount(pricing, "$4,400.00", false), "$4,400.00");
  assert.deepEqual(proposalPdfSalesTax({ ...pricing, salesTax: noRate }, "USD").afterTotal[0]?.amount, "On final invoice");
  assert.deepEqual(proposalPdfSalesTax({ ...pricing, salesTax: exempt }, "USD"), {
    totalLabel: "Total",
    afterTotal: [{ description: "No sales tax on this booking", amount: "None", details: [] }],
  });
  // The old way: a Tax row in the lines, a plain Total, nothing beneath.
  const legacy = { ...pricing, taxCents: 70_000, totalCents: 949_800, salesTax: undefined };
  assert.deepEqual(proposalPdfAdjustments(legacy), [
    { description: "Discount", cents: -50_000 },
    { description: "Tax", cents: 70_000 },
  ]);
  assert.deepEqual(proposalPdfSalesTax(legacy, "USD"), { totalLabel: "Total", afterTotal: [] });
  assert.equal(proposalPdfPaymentAmount(legacy, "$4,398.00", true), "$4,398.00");
  // The renderer takes both fields, defaulted for older callers.
  const renderer = readFileSync("cloud-run/pdf/main.py", "utf8");
  assert.match(renderer, /total_label: str = Field\(default="Total"/);
  assert.match(renderer, /after_total: list\[LineItem\] = Field\(default_factory=list/);
  const pdf = readFileSync("functions/src/operations/ai-pdf.ts", "utf8");
  assert.match(pdf, /total_label:proposalPdfSalesTax\(pricing,currency\)\.totalLabel/);
  assert.match(pdf, /after_total:proposalPdfSalesTax\(pricing,currency\)\.afterTotal/);
});

// ── Re-pricing and booking changes ───────────────────────────────────────

test("re-pricing keeps the snapshot's tax decision, whatever the settings say now", () => {
  const packageDocument = fieldsOf({ taxRateBasisPoints: 887, retainerRule: { type: "percentage", basisPoints: 2500 } });
  const lines = [{ unitPriceCents: 50_000, quantity: 1, taxable: true }];
  // Priced pre-tax: stays pre-tax, the estimate worked out again at its rate.
  const preTax = fieldsOf({ basePriceCents: 800_000, subtotalCents: 800_000, taxCents: 0, retainerCents: 200_000, salesTax: estimate });
  const again = repriceSnapshot(preTax, packageDocument, lines, { type: "none" });
  assert.equal(again.taxCents, 0);
  assert.equal(again.totalCents, 850_000);
  assert.equal(again.retainerCents, 212_500);
  assert.deepEqual(again.salesTax, { mode: "quickbooks", exempt: false, estimatedCents: 56_355, rateBasisPoints: 663 });
  // Priced with tax in the total: keeps it, and has no decision to record.
  const taxed = fieldsOf({ basePriceCents: 800_000, subtotalCents: 800_000, taxCents: 70_960, retainerCents: 217_740 });
  const taxedAgain = repriceSnapshot(taxed, packageDocument, lines, { type: "none" });
  assert.equal(taxedAgain.taxCents, Math.round((850_000 * 887) / 10000));
  assert.equal(taxedAgain.salesTax, undefined);
  // Exempt stays exempt.
  const free = repriceSnapshot(
    fieldsOf({ basePriceCents: 800_000, subtotalCents: 800_000, taxCents: 0, retainerCents: 200_000, salesTax: exempt }),
    packageDocument,
    lines,
    { type: "none" },
  );
  assert.deepEqual(free.salesTax, exempt);
});

test("a booking change prices its packages as the booking was, and says plus sales tax", () => {
  const kept = repriceKeptSnapshot({
    previousId: "s1",
    snapshot: {
      id: "s1",
      basePriceCents: 800_000,
      subtotalCents: 800_000,
      discountCents: 0,
      taxCents: 0,
      retainerCents: 200_000,
      totalCents: 800_000,
      salesTax: { ...estimate, estimatedCents: 53_040 },
    },
    packageData: { taxRateBasisPoints: 887, retainerRule: { type: "percentage", basisPoints: 2500 } },
    addOns: [{ addOnId: "album", name: "Album", quantity: 1, unitPriceCents: 79_800, lineTotalCents: 79_800, taxable: true }],
    id: "s2",
    amendmentId: "a1",
    actorId: "u1",
    timestamp: "2026-10-01T00:00:00.000Z",
  });
  assert.equal(kept.taxCents, 0);
  assert.equal(kept.totalCents, 879_800);
  assert.deepEqual(kept.salesTax, { mode: "quickbooks", exempt: false, estimatedCents: 58_331, rateBasisPoints: 663 });

  const oneOff = (salesTax: SalesTaxTreatment | null) =>
    amendmentOneOffRecords({
      given: { name: "Rehearsal dinner", basePriceCents: 100_000, included: ["Two hours of coverage at the dinner"] },
      packageId: "pk",
      snapshotId: "sx",
      tenantId: "t1",
      projectId: "p1",
      amendmentId: "a1",
      actorId: "u1",
      timestamp: "2026-10-01T00:00:00.000Z",
      mode: "add",
      mainSnapshot: { retainerCents: 0, terms: "Terms." },
      mainPackage: { retainerRule: { type: "fixed", amountCents: 0 }, taxRateBasisPoints: 887 },
      catalogue: [],
      tenantCurrency: "USD",
      eventTypeId: "wedding",
      eventTypeLabel: "Wedding",
      salesTax,
    }).snapshotRecord;
  assert.equal(oneOff(null).taxCents, 8_870);
  assert.equal(oneOff(null).salesTax, undefined);
  assert.equal(oneOff(gated).taxCents, 0);
  assert.deepEqual(oneOff(gated).salesTax, { mode: "quickbooks", exempt: false, estimatedCents: 6_630, rateBasisPoints: 663 });

  const money = amendmentMoney({ previousTotalCents: 800_000, newTotalCents: 879_800, agreedRetainerCents: 200_000, paidCents: 200_000 });
  const base = { previousDate: "2027-06-12", newDate: "2027-06-12", keptPackages: ["Gold"], addedPackages: [], removedPackages: [], money };
  assert.deepEqual(amendmentChangeLines({ ...base, plusSalesTax: true }).slice(-3), [
    "The total changes from $8,000 to $8,798, plus sales tax.",
    "$2,000 already paid is kept and counts toward the new total.",
    "$6,798 remains to be paid, plus sales tax.",
  ]);
  // Without it, the words it always had.
  assert.deepEqual(amendmentChangeLines(base).slice(-3), [
    "The total changes from $8,000 to $8,798.",
    "$2,000 already paid is kept and counts toward the new total.",
    "$6,798 remains to be paid.",
  ]);
});

// ── Where the decision is made and carried ───────────────────────────────

test("every place a package is priced decides once, and every reader carries it", () => {
  const commands = readFileSync("functions/src/crm/commands.ts", "utf8");
  // selectPackage and createOneOffPackage read the gate inside the transaction.
  assert.equal(commands.match(/await readSalesTaxTreatment\(\s*db,\s*\(reference\) => transaction\.get\(reference\)/g)?.length, 2);
  assert.equal(commands.match(/salesTax: salesTaxTreatment,/g)?.length, 2);
  // Every re-priced copy records the refreshed decision.
  assert.equal(commands.match(/\.\.\.\(priced\.salesTax \? \{ salesTax: priced\.salesTax \} : \{\}\)/g)?.length, 4);
  const portal = readFileSync("app/api/client/portal/route.ts", "utf8");
  assert.match(portal, /await readSalesTaxTreatment\(\s*adminFirestore,/);
  assert.match(portal, /salesTax: salesTaxTreatment,/);
  assert.match(portal, /"salesTax",\n {2}\],\n {2}contracts:/);
  // The gate reads the studio's two documents, nothing from the browser.
  for (const path of ["functions/src/billing/sales-tax-treatment.ts", "server/billing/sales-tax-treatment.ts"]) {
    const reader = readFileSync(path, "utf8");
    assert.match(reader, /billingSettings\/\$\{tenantId\}/);
    assert.match(reader, /tenantFeatures\/\$\{tenantId\}/);
  }
  // The proposal and a booking change carry each snapshot's decision.
  const proposals = readFileSync("functions/src/booking/proposals.ts", "utf8");
  assert.equal(proposals.match(/salesTax: readPricedSalesTax\(data\.salesTax\),/g)?.length, 2);
  const amendments = readFileSync("functions/src/contracts/amendments.ts", "utf8");
  assert.match(amendments, /salesTax: readPricedSalesTax\(data\.salesTax\),/);
  assert.match(amendments, /const bookingSalesTax = treatmentOf\(readPricedSalesTax\(obj\(base\.get\("pricingSnapshot"\)\)\.salesTax\)\);/);
  // The agreement's sources and Part 2 read it from the proposal.
  assert.match(readFileSync("functions/src/contracts/sources.ts", "utf8"), /readPricedSalesTax\(pricing\.salesTax\)/);
  assert.match(readFileSync("functions/src/contracts/combined-commands.ts", "utf8"), /salesTax: readPricedSalesTax\(pricing\.salesTax\),/);
});

test("the couple's package page says plus sales tax beside a pre-tax total", () => {
  const view = couplePackageView({
    snapshots: [{ id: "s1", packageName: "Gold", totalCents: 800_000, currency: "USD", salesTax: estimate }],
    proposals: [],
  });
  assert.deepEqual(view?.salesTax, estimate);
  const legacy = couplePackageView({ snapshots: [{ id: "s1", packageName: "Gold", totalCents: 870_960, currency: "USD" }], proposals: [] });
  assert.equal(legacy && "salesTax" in legacy, false);
});
