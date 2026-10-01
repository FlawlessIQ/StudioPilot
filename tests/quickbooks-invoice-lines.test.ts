import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  packageLineDescription,
  quickBooksAmountCheck,
  quickBooksCustomerCreateBody,
  quickBooksCustomerNames,
  quickBooksCustomerSparseUpdate,
  quickBooksFinalLines,
  quickBooksLinePayload,
  quickBooksRetainerLines,
  quickBooksTaxMode,
  type InvoiceLine,
  type JobPackageItem,
  type QuickBooksContact,
} from "../functions/src/operations/quickbooks-invoice-lines.ts";
import { jobPackageItems } from "../functions/src/operations/quickbooks-invoice-plan.ts";
import { billingAddressInputSchema } from "../functions/src/contacts/billing-address.ts";
import { billingAddressSchema } from "../features/contacts/schema.ts";

/**
 * GR Productions' invoices, the way Gabe builds them in QuickBooks
 * (2026-10-01): a customer with name, email, phone and address; a retainer
 * invoice of crew × $1,000 with the packages at $0; a final of the packages
 * at full price, less the retainer, plus tax on the full package.
 */

const sum = (lines: readonly InvoiceLine[]) => lines.reduce((total, line) => total + line.amountCents, 0);

const gold: JobPackageItem = {
  kind: "package",
  name: "Gold Photo Package",
  summary: "2 photographers, 8 hours",
  inclusions: ["Engagement session", "Online gallery"],
  quantity: 1,
  unitPriceCents: 500_000,
  amountCents: 500_000,
  taxable: true,
};
const album: JobPackageItem = {
  kind: "add_on",
  name: "Parent album",
  summary: null,
  inclusions: [],
  quantity: 2,
  unitPriceCents: 25_000,
  amountCents: 50_000,
  taxable: false,
};

const contact: QuickBooksContact = {
  firstName: "Dionne",
  lastName: "Rhodes",
  displayName: "Dionne & Sam",
  email: "dionne@example.test",
  phone: "(732) 555-0100",
  billingAddress: { line1: "12 Shore Rd", line2: null, city: "Point Pleasant", region: "NJ", postalCode: "08742", country: "US" },
};

test("a new customer carries first and last name, email, phone and the billing address", () => {
  assert.deepEqual(quickBooksCustomerCreateBody(contact, "Dionne & Sam"), {
    DisplayName: "Dionne & Sam",
    GivenName: "Dionne",
    FamilyName: "Rhodes",
    PrimaryEmailAddr: { Address: "dionne@example.test" },
    PrimaryPhone: { FreeFormNumber: "(732) 555-0100" },
    BillAddr: { Line1: "12 Shore Rd", City: "Point Pleasant", CountrySubDivisionCode: "NJ", PostalCode: "08742", Country: "US" },
  });
  // No address, no phone: neither is sent, nothing else changes.
  const bare = quickBooksCustomerCreateBody({ displayName: "Avery Stone", email: "a@example.test" }, "Avery Stone");
  assert.equal("BillAddr" in bare, false);
  assert.equal("PrimaryPhone" in bare, false);
  assert.equal(bare.GivenName, "Avery");
  assert.equal(bare.FamilyName, "Stone");
});

test("names fall back to splitting the display name", () => {
  assert.deepEqual(quickBooksCustomerNames({ displayName: "Mary Ann Lee", email: "m@x.test" }), { given: "Mary Ann", family: "Lee" });
  assert.deepEqual(quickBooksCustomerNames({ displayName: "Cher", email: "c@x.test" }), { given: "Cher", family: "" });
  assert.deepEqual(quickBooksCustomerNames({ firstName: "A", lastName: "B", displayName: "Z Y", email: "c@x.test" }), { given: "A", family: "B" });
});

test("an existing customer only has its blanks filled — the studio's data is never overwritten", () => {
  const theirs = {
    Id: "58",
    SyncToken: "3",
    DisplayName: "Dionne Rhodes",
    GivenName: "Dee",
    PrimaryEmailAddr: { Address: "dee@their-books.test" },
    PrimaryPhone: { FreeFormNumber: "" },
  };
  assert.deepEqual(quickBooksCustomerSparseUpdate(theirs, contact), {
    Id: "58",
    SyncToken: "3",
    sparse: true,
    FamilyName: "Rhodes",
    PrimaryPhone: { FreeFormNumber: "(732) 555-0100" },
    BillAddr: { Line1: "12 Shore Rd", City: "Point Pleasant", CountrySubDivisionCode: "NJ", PostalCode: "08742", Country: "US" },
  });
  // An address of their own, even a partial one, is left alone whole.
  const withAddress = { ...theirs, FamilyName: "R", PrimaryPhone: { FreeFormNumber: "1" }, BillAddr: { PostalCode: "07001" } };
  assert.equal(quickBooksCustomerSparseUpdate(withAddress, contact), null);
  // Without an Id and SyncToken there is nothing safe to send.
  assert.equal(quickBooksCustomerSparseUpdate({ Id: "1" }, contact), null);
  // A matched-by-name customer with no email gets this client's.
  const nameOnly = quickBooksCustomerSparseUpdate({ Id: "9", SyncToken: 0, GivenName: "D", FamilyName: "R", BillAddr: { Line1: "x" }, PrimaryPhone: { FreeFormNumber: "2" } }, contact);
  assert.deepEqual(nameOnly, { Id: "9", SyncToken: "0", sparse: true, PrimaryEmailAddr: { Address: "dionne@example.test" } });
});

test("retainer: crew × the per-crew amount, then every package and extra at $0", () => {
  const lines = quickBooksRetainerLines({
    amountCents: 200_000,
    items: [gold, album],
    parts: [{ packageName: "Gold Photo Package", retainerCents: 200_000, perCrew: { amountPerCrewCents: 100_000, crew: 2 } }],
    taxApplies: true,
  });
  assert.equal(lines.length, 3);
  assert.deepEqual(
    { kind: lines[0]!.kind, quantity: lines[0]!.quantity, unit: lines[0]!.unitPriceCents, amount: lines[0]!.amountCents, taxable: lines[0]!.taxable },
    { kind: "retainer", quantity: 2, unit: 100_000, amount: 200_000, taxable: false },
  );
  assert.equal(lines[1]!.amountCents, 0);
  assert.equal(lines[1]!.unitPriceCents, 0);
  assert.equal(lines[1]!.quantity, 1);
  assert.equal(lines[1]!.taxable, true);
  assert.equal(lines[1]!.description, "Gold Photo Package — 2 photographers, 8 hours\n• Engagement session\n• Online gallery");
  assert.equal(lines[2]!.description, "Parent album × 2");
  assert.equal(lines[2]!.taxable, false);
  assert.equal(sum(lines), 200_000);
});

test("retainer: one photographer is 1 × $1,000; two packages at one rate add their crew", () => {
  const one = quickBooksRetainerLines({
    amountCents: 100_000,
    items: [gold],
    parts: [{ packageName: "Gold", retainerCents: 100_000, perCrew: { amountPerCrewCents: 100_000, crew: 1 } }],
    taxApplies: false,
  });
  assert.equal(one[0]!.quantity, 1);
  assert.equal(one[0]!.unitPriceCents, 100_000);
  assert.equal(one[1]!.taxable, false, "no tax agreed: nothing marked taxable");
  const both = quickBooksRetainerLines({
    amountCents: 300_000,
    items: [],
    parts: [
      { packageName: "Photo", retainerCents: 200_000, perCrew: { amountPerCrewCents: 100_000, crew: 2 } },
      { packageName: "Video", retainerCents: 100_000, perCrew: { amountPerCrewCents: 100_000, crew: 1 } },
    ],
    taxApplies: false,
  });
  assert.equal(both.length, 1);
  assert.equal(both[0]!.quantity, 3);
  assert.equal(sum(both), 300_000);
  const mixed = quickBooksRetainerLines({
    amountCents: 250_000,
    items: [],
    parts: [
      { packageName: "Photo", retainerCents: 200_000, perCrew: { amountPerCrewCents: 100_000, crew: 2 } },
      { packageName: "Video", retainerCents: 50_000, perCrew: null },
    ],
    taxApplies: false,
  });
  assert.deepEqual(
    mixed.map((line) => [line.title, line.quantity, line.unitPriceCents]),
    [
      ["Retainer — Photo", 2, 100_000],
      ["Retainer — Video", 1, 50_000],
    ],
  );
  assert.equal(sum(mixed), 250_000);
});

test("retainer: a figure the parts don't explain is one line of the whole amount", () => {
  // The studio set $750 by hand on a $2,000 per-crew package.
  const lines = quickBooksRetainerLines({
    amountCents: 75_000,
    items: [gold],
    parts: [{ packageName: "Gold", retainerCents: 200_000, perCrew: { amountPerCrewCents: 100_000, crew: 2 } }],
    taxApplies: true,
  });
  assert.deepEqual([lines[0]!.quantity, lines[0]!.unitPriceCents], [1, 75_000]);
  assert.equal(sum(lines), 75_000);
  // A per-crew rule the package total capped ($1,000 × 3 > $2,500) is not shown as 3 × $1,000.
  const capped = quickBooksRetainerLines({
    amountCents: 250_000,
    items: [],
    parts: [{ packageName: "Mini", retainerCents: 250_000, perCrew: { amountPerCrewCents: 100_000, crew: 3 } }],
    taxApplies: false,
  });
  assert.deepEqual([capped[0]!.quantity, capped[0]!.unitPriceCents], [1, 250_000]);
});

// Gold $5,000 (taxable) + album $500 (not taxable); 6.625% NJ tax on $5,000.
const TAX = 33_125;
const TOTAL = 550_000 + TAX;

test("final: packages at full price, the retainer taken off, tax on the full package", () => {
  const result = quickBooksFinalLines({
    amountCents: TOTAL - 200_000,
    packageTotalCents: TOTAL,
    taxCents: TAX,
    discountCents: 0,
    items: [gold, album],
    retainerPaidCents: 200_000,
  });
  assert.equal(result.itemised, true);
  assert.equal(result.taxCents, TAX);
  assert.deepEqual(
    result.lines.map((line) => [line.kind, line.quantity, line.unitPriceCents, line.amountCents, line.taxable]),
    [
      ["package", 1, 500_000, 500_000, true],
      ["add_on", 2, 25_000, 50_000, false],
      ["retainer_received", 1, -200_000, -200_000, false],
    ],
  );
  assert.equal(sum(result.lines) + result.taxCents, TOTAL - 200_000);
});

test("final without tax: nothing taxable, and the balance is packages − retainer", () => {
  const result = quickBooksFinalLines({
    amountCents: 350_000,
    packageTotalCents: 550_000,
    taxCents: 0,
    discountCents: 0,
    items: [gold, album],
    retainerPaidCents: 200_000,
  });
  assert.equal(result.taxCents, 0);
  assert.ok(result.lines.every((line) => !line.taxable));
  assert.equal(sum(result.lines), 350_000);
});

test("final: a discount is its own line, and later payments are named apart from the retainer", () => {
  const result = quickBooksFinalLines({
    amountCents: 550_000 - 30_000 - 100_000 - 50_000,
    packageTotalCents: 520_000,
    taxCents: 0,
    discountCents: 30_000,
    items: [gold, album],
    retainerPaidCents: 100_000,
  });
  assert.deepEqual(
    result.lines.map((line) => [line.kind, line.amountCents]),
    [
      ["package", 500_000],
      ["add_on", 50_000],
      ["discount", -30_000],
      ["retainer_received", -100_000],
      ["payments_received", -50_000],
    ],
  );
  assert.equal(sum(result.lines), 370_000);
});

test("final: lines that don't add up to the agreed price fall back to one Packages line of it", () => {
  // An amendment moved the agreed total; the proposal lines still say $5,500.
  const result = quickBooksFinalLines({
    amountCents: 400_000,
    packageTotalCents: 600_000,
    taxCents: 0,
    discountCents: 0,
    items: [gold, album],
    retainerPaidCents: 200_000,
  });
  assert.equal(result.itemised, false);
  assert.deepEqual(result.lines.map((line) => [line.title, line.amountCents]), [
    ["Packages", 600_000],
    ["Retainer received", -200_000],
  ]);
  // Nonsense in, the amount out: never a wrong total.
  const odd = quickBooksFinalLines({ amountCents: 900_000, packageTotalCents: 600_000, taxCents: 0, discountCents: 0, items: [gold], retainerPaidCents: 0 });
  assert.equal(sum(odd.lines) + odd.taxCents, 900_000);
});

test("the QuickBooks payload totals StudioCue's amount in every tax mode", () => {
  const final = quickBooksFinalLines({
    amountCents: TOTAL - 200_000,
    packageTotalCents: TOTAL,
    taxCents: TAX,
    discountCents: 0,
    items: [gold, album],
    retainerPaidCents: 200_000,
  });
  const itemRef = { value: "1" };
  const automated = quickBooksLinePayload({ lines: final.lines, taxCents: final.taxCents, mode: "automated", itemRef });
  assert.deepEqual(automated.TxnTaxDetail, { TotalTax: 331.25 });
  assert.deepEqual(
    automated.Line.map((line) => (line.SalesItemLineDetail as { TaxCodeRef?: { value: string } }).TaxCodeRef?.value),
    ["TAX", "NON", "NON"],
  );
  assert.equal(automated.Line.length, 3, "tax is QuickBooks' own, not a line");
  assert.equal(automated.expectedTotalCents, TOTAL - 200_000);

  for (const mode of ["manual", "none"] as const) {
    const payload = quickBooksLinePayload({ lines: final.lines, taxCents: final.taxCents, mode, itemRef });
    assert.equal(payload.TxnTaxDetail, undefined);
    assert.equal(payload.Line.length, 4);
    assert.equal(payload.Line[3]!.Description, "Sales tax");
    assert.equal(payload.Line[3]!.Amount, 331.25);
    assert.equal(payload.expectedTotalCents, TOTAL - 200_000);
    const codes = payload.Line.map((line) => (line.SalesItemLineDetail as { TaxCodeRef?: { value: string } }).TaxCodeRef?.value);
    assert.deepEqual(codes, mode === "manual" ? ["NON", "NON", "NON", "NON"] : [undefined, undefined, undefined, undefined]);
  }

  // Every line's Amount is Qty × UnitPrice, which QuickBooks insists on.
  for (const line of automated.Line) {
    const detail = line.SalesItemLineDetail as { Qty: number; UnitPrice: number };
    assert.equal(Math.round(detail.Qty * detail.UnitPrice * 100), Math.round(Number(line.Amount) * 100));
  }

  // No tax agreed: an automated company marks every line NON so QuickBooks adds none.
  const untaxed = quickBooksLinePayload({
    lines: quickBooksRetainerLines({ amountCents: 200_000, items: [gold], parts: [], taxApplies: true }),
    taxCents: 0,
    mode: "automated",
    itemRef,
  });
  assert.equal(untaxed.TxnTaxDetail, undefined);
  assert.ok(untaxed.Line.every((line) => (line.SalesItemLineDetail as { TaxCodeRef: { value: string } }).TaxCodeRef.value === "NON"));
  assert.equal(untaxed.expectedTotalCents, 200_000);
});

test("a company without sales tax gets what StudioCue always sent: no tax codes", () => {
  assert.equal(quickBooksTaxMode(null), "none");
  assert.equal(quickBooksTaxMode({ TaxPrefs: { UsingSalesTax: false } }), "none");
  assert.equal(quickBooksTaxMode({ TaxPrefs: { UsingSalesTax: true, PartnerTaxEnabled: true } }), "automated");
  assert.equal(quickBooksTaxMode({ TaxPrefs: { UsingSalesTax: true } }), "manual");
  // TAX/NON are US codes; a Canadian company would refuse them.
  assert.equal(
    quickBooksTaxMode({ CurrencyPrefs: { HomeCurrency: { value: "CAD" } }, TaxPrefs: { UsingSalesTax: true, PartnerTaxEnabled: true } }),
    "none",
  );
  const lines = quickBooksRetainerLines({ amountCents: 100_000, items: [], parts: [], taxApplies: false });
  const payload = quickBooksLinePayload({ lines, taxCents: 0, mode: "none", itemRef: { value: "1" } });
  assert.deepEqual(payload.Line, [
    { Amount: 1000, DetailType: "SalesItemLineDetail", Description: "Retainer", SalesItemLineDetail: { ItemRef: { value: "1" }, Qty: 1, UnitPrice: 1000 } },
  ]);
});

test("a QuickBooks total that differs from StudioCue's is flagged, not absorbed", () => {
  assert.deepEqual(quickBooksAmountCheck(383_125, 383_125), { matches: true, expectedCents: 383_125, providerTotalCents: 383_125, differenceCents: 0 });
  const doubled = quickBooksAmountCheck(383_125, 416_250);
  assert.equal(doubled.matches, false);
  assert.equal(doubled.differenceCents, 33_125);
});

test("package lines read like the proposal", () => {
  assert.equal(packageLineDescription({ ...gold, inclusions: [] }), "Gold Photo Package — 2 photographers, 8 hours");
  const long = packageLineDescription({ ...gold, inclusions: Array.from({ length: 40 }, () => "x".repeat(300)) });
  assert.ok(long.length <= 4000, "QuickBooks caps a description at 4,000 characters");
});

test("job items come from the accepted proposal, with each extra's own taxability", () => {
  const snapshots = [
    {
      id: "snap_gold",
      data: {
        packageId: "pkg_gold",
        packageName: "Gold Photo Package",
        includedCoverage: [{ role: "photographer", count: 2 }],
        includedCoverageMinutes: 480,
        description: "Engagement session. Online gallery.",
        addOns: [{ addOnId: "addon_album", name: "Parent album", quantity: 2, unitPriceCents: 25_000, lineTotalCents: 50_000, taxable: false }],
        discountCents: 0,
      },
    },
  ];
  const accepted = {
    pricingSnapshot: {
      discountCents: 10_000,
      lineItems: [
        { description: "Gold Photo Package", quantity: 1, unitPriceCents: 500_000, totalCents: 500_000, kind: "package", sourceId: "pkg_gold" },
        { description: "Parent album", quantity: 2, unitPriceCents: 25_000, totalCents: 50_000, kind: "add_on", sourceId: "addon_album" },
      ],
    },
    packageDetails: [{ snapshotId: "snap_gold", packageName: "Gold Photo Package", items: ["Engagement session", "Online gallery", "Drone"] }],
  };
  const { items, discountCents } = jobPackageItems(snapshots, accepted);
  assert.equal(discountCents, 10_000);
  assert.deepEqual(items[0], {
    kind: "package",
    name: "Gold Photo Package",
    summary: "2 photographers, 8 hours",
    inclusions: ["Engagement session", "Online gallery", "Drone"],
    quantity: 1,
    unitPriceCents: 500_000,
    amountCents: 500_000,
    taxable: true,
  });
  assert.equal(items[1]!.taxable, false);
  // Before a proposal: the snapshots, with the description's sentences as bullets.
  const fromSnapshots = jobPackageItems(snapshots, null);
  assert.deepEqual(fromSnapshots.items[0]!.inclusions, ["Engagement session", "Online gallery"]);
  assert.equal(fromSnapshots.items.length, 2);
});

test("the two billing-address schemas agree", () => {
  const samples: unknown[] = [
    { line1: "12 Shore Rd", city: "Point Pleasant", region: "NJ", postalCode: "08742" },
    { line1: " 1 Main ", line2: "Apt 2", city: "Newark", region: null, postalCode: null, country: "us" },
    { line1: "", city: "Newark" },
    { line1: "1 Main", city: "Newark", country: "USA" },
    { line1: "1 Main" },
  ];
  for (const sample of samples) {
    const app = billingAddressSchema.safeParse(sample);
    const functions = billingAddressInputSchema.safeParse(sample);
    assert.equal(app.success, functions.success, JSON.stringify(sample));
    if (app.success && functions.success) assert.deepEqual(app.data, functions.data);
  }
});

test("the worker sends the lines, keeps the online-payment retry, and reads the total back", () => {
  const source = readFileSync("functions/src/operations/provider-runtime.ts", "utf8");
  const start = source.indexOf("export async function createQuickBooksInvoice(");
  const body = source.slice(start, source.indexOf("export async function voidQuickBooksInvoice(", start));
  assert.match(body, /planQuickBooksInvoiceLines\(db,invoice\)/);
  assert.match(body, /Line:payload\.Line/);
  assert.match(body, /QUICKBOOKS_ONLINE_PAYMENT_FLAGS/);
  assert.match(body, /quickBooksAmountCheck\(/);
  assert.match(body, /providerAmountMismatch/);
  assert.doesNotMatch(body, /Description:String\(invoice\.get\("kind"\)\)/, "the one-line 'retainer' invoice is gone");
  // The customer is created with the full record, not a display name alone.
  assert.match(source, /quickBooksCustomerCreateBody\(details,name\)/);
});
