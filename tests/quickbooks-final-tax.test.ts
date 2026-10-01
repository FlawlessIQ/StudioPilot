import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  chooseQuickBooksTaxStrategy,
  gatedFinalLines,
  quickBooksDefaultTaxCode,
  quickBooksGatedPayload,
  quickBooksHoldReason,
  quickBooksInvoiceStillTaxed,
  quickBooksLinesWithoutTax,
  quickBooksSalesTaxCodes,
  quickBooksSparseInvoiceUpdate,
  quickBooksTaxReadBack,
  quickBooksUntaxChanges,
  sendReviewRecord,
  taxStrategyFromRecord,
} from "../functions/src/operations/quickbooks-final-tax.ts";
import { quickBooksRetainerLines, type JobPackageItem } from "../functions/src/operations/quickbooks-invoice-lines.ts";
import { heldInvoiceActionRefusal, sendHeldInvoiceIn } from "../functions/src/booking/held-invoice-send.ts";
import { HELD_INVOICE_JOB_TYPE } from "../functions/src/operations/quickbooks-held-invoice.ts";
import { raiseFinalInvoice } from "../functions/src/booking/final-invoice.ts";
import { approveFinalInvoiceIn, type CorrectionContext } from "../functions/src/booking/invoice-corrections.ts";
import { finalBillBasis } from "../functions/src/booking/final-tax-authority.ts";
import { providerReportedInvoice } from "@/features/booking/invoice-standing";
import { heldInvoiceView, salesTaxNote } from "@/features/billing/held-invoice-review";
import { outstandingFinalBalance } from "@/features/booking/final-balance-due";
import { todayInbox } from "@/features/today/inbox";

/**
 * QuickBooks as the sales-tax authority (owner decision, 2026-10-01).
 *
 * For a studio switched on to itemised invoices, StudioCue sends pre-tax
 * lines marked taxable and lets QuickBooks' Automated Sales Tax work the tax
 * out from the couple's billing address; it never overrides the tax. Every
 * final bill is held in QuickBooks, unsent, until the studio presses "Send
 * with tax" or "Send without tax". Retainers never carry tax, and are held
 * only when the studio asked. Off, nothing changes.
 */

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

// ── A tiny in-memory Firestore (as tests/wave1-money.test.ts) ──────────────
type Doc = Record<string, unknown>;
function fakeFirestore(store: Record<string, Doc>) {
  const ref = (path: string) => ({ path, id: path.split("/").pop()! });
  const snap = (path: string) => {
    const data = store[path];
    return {
      id: path.split("/").pop()!,
      exists: Boolean(data),
      ref: ref(path),
      data: () => data,
      get: (field: string) =>
        field.split(".").reduce<unknown>((value, key) => (value as Doc | undefined)?.[key], data),
    };
  };
  type Query = {
    collection: string;
    filters: Array<[string, unknown]>;
    where: (field: string, op: string, value: unknown) => Query;
    limit: () => Query;
  };
  const query = (collection: string, filters: Array<[string, unknown]> = []): Query => ({
    collection,
    filters,
    where: (field, _op, value) => query(collection, [...filters, [field, value]]),
    limit() {
      return this;
    },
  });
  const writes: Array<[string, string, Doc]> = [];
  const db = { doc: ref, collection: (name: string) => query(name) };
  const transaction = {
    get: async (target: { path?: string } | Query) =>
      "collection" in target
        ? {
            docs: Object.keys(store)
              .filter((path) => path.split("/").length === 2 && path.startsWith(`${target.collection}/`))
              .map(snap)
              .filter((document) => target.filters.every(([field, value]) => document.get(field) === value)),
          }
        : snap(String(target.path)),
    create: (target: { path: string }, data: Doc) => {
      if (store[target.path]) throw new Error(`ALREADY_EXISTS ${target.path}`);
      writes.push(["create", target.path, data]);
    },
    set: (target: { path: string }, data: Doc) => writes.push(["set", target.path, data]),
    update: (target: { path: string }, data: Doc) => writes.push(["update", target.path, data]),
  };
  const commit = () => {
    for (const [kind, path, data] of writes.splice(0)) {
      store[path] = kind === "update" ? { ...store[path], ...data } : { ...data };
    }
  };
  return { db, transaction, snap, writes, commit, store };
}

const writeTo = (writes: Array<[string, string, Doc]>, path: string) =>
  writes.find(([, target]) => target === path)?.[2];

const context = (overrides: Partial<CorrectionContext> = {}): CorrectionContext => ({
  tenantId: "t",
  role: "studio_owner",
  actorId: "u1",
  now: "2026-10-01T12:00:00.000Z",
  idempotencyKey: "key-00000001",
  ipAddress: null,
  userAgent: null,
  ...overrides,
});

// ── The job's packages ──────────────────────────────────────────────────────
const gold: JobPackageItem = {
  kind: "package",
  name: "Gold Photo Package",
  summary: "2 photographers, 8 hours",
  inclusions: ["Online gallery"],
  quantity: 1,
  unitPriceCents: 500000,
  amountCents: 500000,
  taxable: true,
};
const album: JobPackageItem = {
  kind: "add_on",
  name: "Album",
  summary: null,
  inclusions: [],
  quantity: 1,
  unitPriceCents: 80000,
  amountCents: 80000,
  taxable: false,
};
const itemRef = { value: "1", name: "Photography package" };

const finalLines = (taxApplies = true) =>
  gatedFinalLines({
    amountCents: 580000 - 30000 - 200000,
    preTaxTotalCents: 580000 - 30000,
    discountCents: 30000,
    items: [gold, album],
    retainerPaidCents: 200000,
    taxApplies,
  });

// ── 1. The payload: pre-tax lines, taxable where tax applies, no override ──

test("a final invoice goes pre-tax: packages taxable, the retainer received and payments non-taxable", () => {
  const result = finalLines();
  assert.equal(result.itemised, true);
  assert.equal(result.taxCents, 0, "StudioCue adds no tax of its own");
  assert.deepEqual(
    result.lines.map((line) => [line.kind, line.amountCents, line.taxable]),
    [
      ["package", 500000, true],
      ["add_on", 80000, false],
      ["discount", -30000, true],
      ["retainer_received", -200000, false],
    ],
  );
  assert.equal(
    result.lines.reduce((sum, line) => sum + line.amountCents, 0),
    350000,
    "the lines add up to the pre-tax balance",
  );
});

test("Automated Sales Tax: TAX on taxable lines, NON on the rest, and never a tax override", () => {
  const payload = quickBooksGatedPayload({
    lines: finalLines().lines,
    strategy: { kind: "automated" },
    companyMode: "automated",
    itemRef,
  });
  const codes = payload.Line.map((line) => ((line.SalesItemLineDetail as Doc).TaxCodeRef as Doc).value);
  assert.deepEqual(codes, ["TAX", "NON", "TAX", "NON"]);
  assert.equal(payload.TxnTaxDetail, undefined, "QuickBooks computes the tax itself");
  assert.doesNotMatch(JSON.stringify(payload.Line), /TotalTax/);
  assert.equal(payload.expectedSubtotalCents, 350000);
  assert.equal(payload.estimateTaxCents, 0);
  assert.deepEqual(payload.Line[3], {
    Amount: -2000,
    DetailType: "SalesItemLineDetail",
    Description: "Retainer received — thank you",
    SalesItemLineDetail: { ItemRef: itemRef, Qty: 1, UnitPrice: -2000, TaxCodeRef: { value: "NON" } },
  });
});

test("an exempt job (or a studio with sales tax off) sends every line non-taxable and no tax", () => {
  const strategy = chooseQuickBooksTaxStrategy({
    taxApplies: false,
    companyMode: "automated",
    defaultTaxCode: null,
    salesTaxCodes: [],
    estimateRateBasisPoints: 825,
  });
  assert.deepEqual(strategy, { kind: "none" });
  const lines = finalLines(false).lines;
  assert.ok(lines.every((line) => !line.taxable));
  const payload = quickBooksGatedPayload({ lines, strategy, companyMode: "automated", itemRef });
  assert.ok(payload.Line.every((line) => ((line.SalesItemLineDetail as Doc).TaxCodeRef as Doc).value === "NON"));
  assert.equal(payload.TxnTaxDetail, undefined);
  // A company with no sales tax in QuickBooks gets no tax codes at all, as before.
  const plain = quickBooksGatedPayload({ lines, strategy, companyMode: "none", itemRef });
  assert.ok(plain.Line.every((line) => !("TaxCodeRef" in (line.SalesItemLineDetail as Doc))));
});

test("manual sales tax: the company's default code, else its only code, else the studio's estimate as a line", () => {
  const prefs = { TaxPrefs: { UsingSalesTax: true, TaxGroupCodeRef: { value: "7", name: "Travis County" } } };
  assert.deepEqual(quickBooksDefaultTaxCode(prefs), { id: "7", name: "Travis County" });
  assert.equal(quickBooksDefaultTaxCode({ TaxPrefs: {} }), null);
  const codes = quickBooksSalesTaxCodes({
    QueryResponse: {
      TaxCode: [
        { Id: "TAX", Name: "TAX", Taxable: true, SalesTaxRateList: { TaxRateDetail: [{}] } },
        { Id: "NON", Name: "NON", Taxable: false },
        { Id: "3", Name: "Austin", Active: true, Taxable: true, SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: "1" } }] } },
        { Id: "4", Name: "Old", Active: false, Taxable: true, SalesTaxRateList: { TaxRateDetail: [{}] } },
        { Id: "5", Name: "Group with no rate", Taxable: true, SalesTaxRateList: { TaxRateDetail: [] } },
      ],
    },
  });
  assert.deepEqual(codes, [{ id: "3", name: "Austin" }]);
  const base = { taxApplies: true, companyMode: "manual" as const, estimateRateBasisPoints: 825 };
  assert.deepEqual(chooseQuickBooksTaxStrategy({ ...base, defaultTaxCode: { id: "7", name: "Travis County" }, salesTaxCodes: codes }), {
    kind: "company_code",
    taxCodeId: "7",
    taxCodeName: "Travis County",
  });
  assert.deepEqual(chooseQuickBooksTaxStrategy({ ...base, defaultTaxCode: null, salesTaxCodes: codes }), {
    kind: "company_code",
    taxCodeId: "3",
    taxCodeName: "Austin",
  });
  const several = [...codes, { id: "9", name: "Dallas" }];
  const estimate = chooseQuickBooksTaxStrategy({ ...base, defaultTaxCode: null, salesTaxCodes: several });
  assert.deepEqual(estimate, { kind: "estimate", rateBasisPoints: 825, reason: "no_default_code" });
  assert.deepEqual(
    chooseQuickBooksTaxStrategy({ ...base, estimateRateBasisPoints: null, defaultTaxCode: null, salesTaxCodes: several }),
    { kind: "unavailable", reason: "no_default_code" },
  );

  // The company's code: TAX on taxable lines and the code on the invoice.
  const coded = quickBooksGatedPayload({
    lines: finalLines().lines,
    strategy: { kind: "company_code", taxCodeId: "7", taxCodeName: "Travis County" },
    companyMode: "manual",
    itemRef,
  });
  assert.deepEqual(coded.TxnTaxDetail, { TxnTaxCodeRef: { value: "7" } });
  assert.doesNotMatch(JSON.stringify(coded), /TotalTax/);

  // The estimate: every line NON, tax on the taxable base as its own line, said so.
  const estimated = quickBooksGatedPayload({ lines: finalLines().lines, strategy: estimate, companyMode: "manual", itemRef });
  const taxableBase = 500000 - 30000;
  assert.equal(estimated.estimateTaxCents, Math.round((taxableBase * 825) / 10000));
  const last = estimated.sentLines.at(-1)!;
  assert.equal(last.kind, "sales_tax");
  assert.equal(last.description, "Sales tax (estimated at 8.25%)");
  assert.ok(estimated.Line.every((line) => ((line.SalesItemLineDetail as Doc).TaxCodeRef as Doc).value === "NON"));
  assert.equal(estimated.expectedSubtotalCents, 350000, "the estimate is tax, not part of the subtotal");
  assert.equal(estimated.TxnTaxDetail, undefined);
});

test("sales tax off in QuickBooks, or tax codes refused: the estimate, with the reason in words", () => {
  const off = chooseQuickBooksTaxStrategy({
    taxApplies: true,
    companyMode: "none",
    defaultTaxCode: null,
    salesTaxCodes: [],
    estimateRateBasisPoints: 700,
  });
  assert.deepEqual(off, { kind: "estimate", rateBasisPoints: 700, reason: "no_sales_tax_in_quickbooks" });
  const refused = chooseQuickBooksTaxStrategy({
    taxApplies: true,
    companyMode: "automated",
    defaultTaxCode: null,
    salesTaxCodes: [],
    estimateRateBasisPoints: null,
    codesRefused: true,
  });
  assert.deepEqual(refused, { kind: "unavailable", reason: "tax_codes_refused" });
  const readBack = quickBooksTaxReadBack({ TotalAmt: 3500, Balance: 3500, BillAddr: { Line1: "1 Main", City: "Austin" } }, { expectedSubtotalCents: 350000 });
  const review = sendReviewRecord({ reason: "final_tax", strategy: off, readBack, itemised: true, now: "n" });
  assert.match(review.note!, /Sales tax is off in QuickBooks, so this is your estimate of 7%/);
  assert.match(
    sendReviewRecord({ reason: "final_tax", strategy: refused, readBack, itemised: true, now: "n" }).note!,
    /wouldn't take sales tax codes .* no tax is on this bill/,
  );
  assert.deepEqual(taxStrategyFromRecord(off), off);
  assert.deepEqual(taxStrategyFromRecord({ kind: "nonsense" }), { kind: "none" });
});

test("an older booking whose signed total included StudioCue's tax is billed pre-tax, so tax is never counted twice", () => {
  // Signed at $5,412.50 = $5,000 + 8.25% StudioCue tax; $2,000 retainer paid.
  assert.deepEqual(finalBillBasis({ totalCents: 541250, agreedTaxCents: 41250, quickBooksTax: true }), {
    billedTotalCents: 500000,
    taxCents: 0,
    agreedTaxExcludedCents: 41250,
  });
  // Signed pre-tax (the new way): the same reading.
  assert.deepEqual(finalBillBasis({ totalCents: 500000, agreedTaxCents: 0, quickBooksTax: true }), {
    billedTotalCents: 500000,
    taxCents: 0,
    agreedTaxExcludedCents: 0,
  });
  // Switched off: exactly as before.
  assert.deepEqual(finalBillBasis({ totalCents: 541250, agreedTaxCents: 41250, quickBooksTax: false }), {
    billedTotalCents: 541250,
    taxCents: 41250,
    agreedTaxExcludedCents: 0,
  });
});

// ── 2. The read-back ────────────────────────────────────────────────────────

test("QuickBooks' tax and total are read back as the bill; only a different pre-tax subtotal is a mismatch", () => {
  const created = {
    Id: "145",
    TotalAmt: 3788.75,
    Balance: 3788.75,
    TxnTaxDetail: { TotalTax: 288.75 },
    BillAddr: { Line1: "1 Main St", City: "Austin", CountrySubDivisionCode: "TX", PostalCode: "78701" },
  };
  const readBack = quickBooksTaxReadBack(created, { expectedSubtotalCents: 350000 });
  assert.deepEqual(readBack, {
    totalCents: 378875,
    taxCents: 28875,
    subtotalCents: 350000,
    balanceCents: 378875,
    billingAddressMissing: false,
    taxLocation: { city: "Austin", region: "TX" },
    preTaxMatches: true,
    preTaxDifferenceCents: 0,
  });
  const off = quickBooksTaxReadBack({ ...created, TotalAmt: 3888.75 }, { expectedSubtotalCents: 350000 });
  assert.equal(off.preTaxMatches, false);
  assert.equal(off.preTaxDifferenceCents, 10000);
  // The estimate line is tax, read from the invoice itself.
  const estimated = quickBooksTaxReadBack(
    { TotalAmt: 3788.75, Line: [{ Amount: 288.75, Description: "Sales tax (estimated at 8.25%)" }], BillAddr: { City: "Austin" } },
    { expectedSubtotalCents: 350000 },
  );
  assert.equal(estimated.taxCents, 28875);
  assert.equal(estimated.subtotalCents, 350000);
});

test("no billing address on an Automated Sales Tax invoice holds it with a clear prompt, and blocks Send with tax", () => {
  const readBack = quickBooksTaxReadBack({ TotalAmt: 3500, Balance: 3500, TxnTaxDetail: { TotalTax: 0 } }, { expectedSubtotalCents: 350000 });
  assert.equal(readBack.billingAddressMissing, true);
  assert.equal(readBack.taxLocation, null);
  const review = sendReviewRecord({ reason: "final_tax", strategy: { kind: "automated" }, readBack, itemised: true, now: "2026-10-01" });
  assert.equal(review.state, "awaiting_studio");
  assert.equal(review.sendWithTaxBlocked, true);
  assert.equal(review.note, "Add the couple's billing address so QuickBooks can work out the tax.");
  // With an address: nothing to add.
  const withAddress = quickBooksTaxReadBack(
    { TotalAmt: 3788.75, TxnTaxDetail: { TotalTax: 288.75 }, BillAddr: { City: "Austin", CountrySubDivisionCode: "TX" } },
    { expectedSubtotalCents: 350000 },
  );
  const ok = sendReviewRecord({ reason: "final_tax", strategy: { kind: "automated" }, readBack: withAddress, itemised: true, now: "n" });
  assert.equal(ok.sendWithTaxBlocked, false);
  assert.equal(ok.note, null);
  assert.equal(ok.taxCents, 28875);
});

// ── 3. Who is held ─────────────────────────────────────────────────────────

test("every final is held for a switched-on studio; a retainer only when the studio asked; off holds nothing", () => {
  assert.equal(quickBooksHoldReason({ kind: "final", gated: true, holdRetainerForReview: false }), "final_tax");
  assert.equal(quickBooksHoldReason({ kind: "retainer", gated: true, holdRetainerForReview: true }), "retainer");
  assert.equal(quickBooksHoldReason({ kind: "retainer", gated: true, holdRetainerForReview: false }), null);
  assert.equal(quickBooksHoldReason({ kind: "final", gated: false, holdRetainerForReview: true }), null);
  assert.equal(quickBooksHoldReason({ kind: "retainer", gated: false, holdRetainerForReview: true }), null);
});

test("a retainer is never taxed: non-taxable retainer, the packages at $0 non-taxable, no tax codes but NON", () => {
  const lines = quickBooksRetainerLines({
    amountCents: 200000,
    items: [gold, album],
    parts: [{ packageName: "Gold", retainerCents: 200000, perCrew: { amountPerCrewCents: 100000, crew: 2 } }],
    taxApplies: false,
  });
  assert.ok(lines.every((line) => !line.taxable));
  const payload = quickBooksGatedPayload({ lines, strategy: { kind: "none" }, companyMode: "automated", itemRef });
  assert.ok(payload.Line.every((line) => ((line.SalesItemLineDetail as Doc).TaxCodeRef as Doc).value === "NON"));
  assert.equal(payload.expectedSubtotalCents, 200000);
  const review = sendReviewRecord({
    reason: "retainer",
    strategy: { kind: "none" },
    readBack: quickBooksTaxReadBack({ TotalAmt: 2000, Balance: 2000 }, { expectedSubtotalCents: 200000 }),
    itemised: true,
    now: "n",
  });
  assert.equal(review.note, null, "no address prompt on a retainer");
  assert.equal(review.sendWithTaxBlocked, false);
});

// ── 4. "Send without tax" at QuickBooks ────────────────────────────────────

test("Send without tax makes every line non-taxable, drops the estimate line, and leaves QuickBooks' subtotal to it", () => {
  const lines = [
    { Id: "1", DetailType: "SalesItemLineDetail", Amount: 5000, SalesItemLineDetail: { ItemRef: { value: "2" }, TaxCodeRef: { value: "TAX" } } },
    { Id: "2", DetailType: "SalesItemLineDetail", Amount: -2000, Description: "Retainer received", SalesItemLineDetail: { TaxCodeRef: { value: "NON" } } },
    { Id: "3", DetailType: "SalesItemLineDetail", Amount: 288.75, Description: "Sales tax (estimated at 8.25%)", SalesItemLineDetail: {} },
    { DetailType: "SubTotalLineDetail", Amount: 3000, SubTotalLineDetail: {} },
    { Id: "4", DetailType: "SalesItemLineDetail", Amount: 10, SalesItemLineDetail: { ItemRef: { value: "2" } } },
  ];
  const untaxed = quickBooksLinesWithoutTax(lines);
  assert.deepEqual(
    untaxed.map((line) => [line.Id, ((line.SalesItemLineDetail as Doc).TaxCodeRef as Doc | undefined)?.value ?? null]),
    [
      ["1", "NON"],
      ["2", "NON"],
      ["4", null],
    ],
  );
  assert.equal(quickBooksInvoiceStillTaxed({ TxnTaxDetail: { TotalTax: 288.75 } }), true);
  assert.equal(quickBooksInvoiceStillTaxed({ Line: lines }), true, "the estimate line is tax");
  assert.equal(quickBooksInvoiceStillTaxed({ TxnTaxDetail: { TotalTax: 0 }, Line: untaxed }), false);
  assert.deepEqual(quickBooksSparseInvoiceUpdate({ Id: "145", SyncToken: 0 }, { Line: untaxed }), {
    Id: "145",
    SyncToken: "0",
    sparse: true,
    Line: untaxed,
  });
  assert.equal(quickBooksSparseInvoiceUpdate({ Id: "145" }, {}), null);
  // Automated Sales Tax: NON lines are the whole change.
  assert.deepEqual(quickBooksUntaxChanges({ Line: lines, TxnTaxDetail: { TotalTax: 288.75 } }), { Line: untaxed });
  // A manual-tax company's code on the invoice is cleared with it, or
  // QuickBooks refuses the NON lines (Intuit sandbox, 2026-10-01).
  assert.deepEqual(
    quickBooksUntaxChanges({ Line: lines, TxnTaxDetail: { TxnTaxCodeRef: { value: "2" }, TotalTax: 400 } }),
    { Line: untaxed, TxnTaxDetail: {} },
  );
});

// ── 5. The studio's choice: sendHeldInvoice ────────────────────────────────

const heldFinal = (review: Doc = {}) => ({
  tenantId: "t",
  projectId: "p",
  kind: "final",
  provider: "quickbooks",
  providerInvoiceId: "145",
  providerState: "completed",
  status: "review_required",
  currency: "USD",
  amountCents: 378875,
  balanceCents: 378875,
  taxCents: 28875,
  providerLines: {
    taxAuthority: "quickbooks",
    taxCents: 28875,
    taxLocation: { city: "Austin", region: "TX" },
    expectedSubtotalCents: 350000,
    lines: [
      { kind: "package", amountCents: 500000, taxable: true },
      { kind: "add_on", amountCents: 80000, taxable: false },
      { kind: "discount", amountCents: -30000, taxable: true },
      { kind: "retainer_received", amountCents: -200000, taxable: false },
    ],
  },
  sendReview: {
    state: "awaiting_studio",
    reason: "final_tax",
    strategy: "automated",
    taxStrategy: { kind: "automated" },
    subtotalCents: 350000,
    taxCents: 28875,
    totalCents: 378875,
    taxLocation: { city: "Austin", region: "TX" },
    billingAddressMissing: false,
    sendWithTaxBlocked: false,
    note: null,
    heldAt: "2026-10-01T10:00:00.000Z",
    ...review,
  },
});

const heldStore = (invoice: Doc = heldFinal()) => ({
  "projects/p": { tenantId: "t", name: "Smith wedding", state: "PLANNING", eventDate: "2026-10-20" },
  "invoiceReferences/final_p": invoice,
});

test("only an owner or admin sends a held bill, and only one actually held", async () => {
  const fake = fakeFirestore(heldStore());
  await assert.rejects(
    sendHeldInvoiceIn(fake.db as never, fake.transaction as never, context({ role: "studio_staff" }), {
      projectId: "p",
      invoiceId: "final_p",
      action: "send_with_tax",
      confirmAmountCents: 378875,
    }),
    /INVOICE_SEND_PERMISSION_REQUIRED/,
  );
  const sent = fakeFirestore(heldStore({ ...heldFinal(), status: "sent" }));
  await assert.rejects(
    sendHeldInvoiceIn(sent.db as never, sent.transaction as never, context(), {
      projectId: "p",
      invoiceId: "final_p",
      action: "send_with_tax",
      confirmAmountCents: 378875,
    }),
    /INVOICE_NOT_HELD/,
  );
  // Another job's bill is not this one.
  const other = fakeFirestore({ ...heldStore(), "invoiceReferences/final_p": { ...heldFinal(), projectId: "q" } });
  await assert.rejects(
    sendHeldInvoiceIn(other.db as never, other.transaction as never, context(), {
      projectId: "p",
      invoiceId: "final_p",
      action: "send_with_tax",
      confirmAmountCents: 378875,
    }),
    /INVOICE_NOT_FOUND/,
  );
});

test("the figure the studio confirmed must be the bill's: with tax the total, without it the pre-tax subtotal", () => {
  const invoice = heldFinal();
  assert.equal(heldInvoiceActionRefusal(invoice, { action: "send_with_tax", confirmAmountCents: 378875 }), null);
  assert.equal(heldInvoiceActionRefusal(invoice, { action: "send_with_tax", confirmAmountCents: 350000 }), "HELD_INVOICE_AMOUNT_CHANGED");
  assert.equal(heldInvoiceActionRefusal(invoice, { action: "send_without_tax", confirmAmountCents: 350000 }), null);
  assert.equal(heldInvoiceActionRefusal(invoice, { action: "send_without_tax", confirmAmountCents: 378875 }), "HELD_INVOICE_AMOUNT_CHANGED");
  assert.equal(heldInvoiceActionRefusal(invoice, { action: "recalculate", confirmAmountCents: null }), null);
  const noAddress = heldFinal({ billingAddressMissing: true, sendWithTaxBlocked: true });
  assert.equal(heldInvoiceActionRefusal(noAddress, { action: "send_with_tax", confirmAmountCents: 378875 }), "BILLING_ADDRESS_NEEDED_FOR_TAX");
  assert.equal(heldInvoiceActionRefusal(noAddress, { action: "send_without_tax", confirmAmountCents: 350000 }), null);
  const retainer = { ...heldFinal({ reason: "retainer" }), kind: "retainer" };
  assert.equal(heldInvoiceActionRefusal(retainer, { action: "send_without_tax", confirmAmountCents: 350000 }), "RETAINER_HAS_NO_TAX");
  assert.equal(heldInvoiceActionRefusal(heldFinal({ state: "releasing" }), { action: "send_with_tax", confirmAmountCents: 378875 }), "INVOICE_ACTION_IN_PROGRESS");
});

test("Send without tax queues the QuickBooks job, marks the bill as going, and audits who chose it and what it said", async () => {
  const fake = fakeFirestore(heldStore());
  const result = await sendHeldInvoiceIn(fake.db as never, fake.transaction as never, context(), {
    projectId: "p",
    invoiceId: "final_p",
    action: "send_without_tax",
    confirmAmountCents: 350000,
  });
  assert.equal(result.state, "releasing");
  const job = writeTo(fake.writes, `providerJobs/${result.jobId}`)!;
  assert.equal(job.type, HELD_INVOICE_JOB_TYPE);
  assert.equal(job.type, "release_quickbooks_invoice");
  assert.equal(job.action, "send_without_tax");
  assert.equal(job.invoiceId, "final_p");
  assert.equal(job.status, "queued");
  const invoice = writeTo(fake.writes, "invoiceReferences/final_p")!;
  const review = invoice.sendReview as Doc;
  assert.equal(review.state, "releasing");
  assert.deepEqual((review.request as Doc).by, "u1");
  assert.equal(invoice.status, undefined, "still held until QuickBooks has done it");
  const audit = fake.writes.find(([, path]) => path.startsWith("auditEvents/"))![2];
  assert.equal(audit.action, "invoice.sent_without_tax");
  assert.equal(audit.actorId, "u1");
  assert.equal(audit.timestamp, "2026-10-01T12:00:00.000Z");
  assert.deepEqual((audit.before as Doc).taxCents, 28875);
  assert.deepEqual((audit.after as Doc).taxCents, 0);
});

test("the same request twice is one send; a different one while it's going is refused", async () => {
  const fake = fakeFirestore(heldStore());
  const first = await sendHeldInvoiceIn(fake.db as never, fake.transaction as never, context(), {
    projectId: "p",
    invoiceId: "final_p",
    action: "send_with_tax",
    confirmAmountCents: 378875,
  });
  fake.commit();
  const again = await sendHeldInvoiceIn(fake.db as never, fake.transaction as never, context(), {
    projectId: "p",
    invoiceId: "final_p",
    action: "send_with_tax",
    confirmAmountCents: 378875,
  });
  assert.equal(again.jobId, first.jobId);
  assert.equal(fake.writes.length, 0, "no second job, no second audit");
  const audit = Object.entries(fake.store).find(([path]) => path.startsWith("auditEvents/"))![1];
  assert.equal(audit.action, "invoice.sent_with_tax");
  await assert.rejects(
    sendHeldInvoiceIn(fake.db as never, fake.transaction as never, context({ idempotencyKey: "key-00000002" }), {
      projectId: "p",
      invoiceId: "final_p",
      action: "send_without_tax",
      confirmAmountCents: 350000,
    }),
    /INVOICE_ACTION_IN_PROGRESS/,
  );
});

test("a held retainer is sent as it stands, audited as the retainer released", async () => {
  const retainer = {
    ...heldFinal({ reason: "retainer", strategy: "none", taxStrategy: { kind: "none" }, taxCents: 0, subtotalCents: 200000, totalCents: 200000 }),
    kind: "retainer",
    amountCents: 200000,
    balanceCents: 200000,
    taxCents: 0,
  };
  const fake = fakeFirestore({ ...heldStore(), "invoiceReferences/final_p": retainer });
  const result = await sendHeldInvoiceIn(fake.db as never, fake.transaction as never, context(), {
    projectId: "p",
    invoiceId: "final_p",
    action: "send_with_tax",
    confirmAmountCents: 200000,
  });
  assert.equal(result.state, "releasing");
  const audit = fake.writes.find(([, path]) => path.startsWith("auditEvents/"))![2];
  assert.equal(audit.action, "invoice.retainer_released");
});

// ── 6. Raising and approving a final for a switched-on studio ──────────────

function finalStore(extra: Record<string, Doc> = {}) {
  return {
    "projects/p": { tenantId: "t", name: "Smith wedding", state: "PLANNING", eventDate: "2026-10-20", packageSnapshotId: "s" },
    "packageSnapshots/s": { tenantId: "t", totalCents: 541250, taxCents: 41250, retainerCents: 200000, currency: "USD" },
    "proposals/pr": {
      tenantId: "t",
      projectId: "p",
      status: "accepted",
      version: 1,
      // An older booking: StudioCue's own 8.25% inside the signed total.
      pricingSnapshot: { totalCents: 541250, taxCents: 41250 },
      paymentSchedule: [{ label: "Retainer", amountCents: 200000 }, { label: "Balance", amountCents: 341250 }],
    },
    "invoiceReferences/r": { tenantId: "t", projectId: "p", kind: "retainer", status: "paid", amountCents: 200000, balanceCents: 0, provider: "quickbooks", providerCustomerId: "c1" },
    ...extra,
  };
}

test("a switched-on studio's final is raised pre-tax — QuickBooks adds the tax — and off it is raised as before", async () => {
  const on = fakeFirestore(finalStore({ "tenantFeatures/t": { quickbooksItemisedInvoices: true } }));
  const raised = await raiseFinalInvoice(on.db as never, on.transaction as never, on.snap("projects/p") as never, {
    invoiceId: "final_p",
    actor: "u1",
    now: "2026-10-01T00:00:00.000Z",
    provider: "quickbooks",
  });
  assert.deepEqual(raised, { raised: true, invoiceId: "final_p", amountCents: 300000, reviewRequired: false });
  const created = writeTo(on.writes, "invoiceReferences/final_p")!;
  const calculation = created.calculation as Doc;
  assert.equal(calculation.taxAuthority, "quickbooks");
  assert.equal(calculation.taxCents, 0);
  assert.equal(calculation.packageTotalCents, 500000);
  assert.equal(calculation.agreedTaxExcludedCents, 41250);
  assert.match(JSON.stringify(calculation.lines), /calculated by QuickBooks/);
  // The worker then makes it in QuickBooks and holds it (it is queued, not sent).
  assert.equal(writeTo(on.writes, "providerJobs/invoice_final_p")!.type, "create_quickbooks_invoice");

  const off = fakeFirestore(finalStore());
  const before = await raiseFinalInvoice(off.db as never, off.transaction as never, off.snap("projects/p") as never, {
    invoiceId: "final_p",
    actor: "u1",
    now: "2026-10-01T00:00:00.000Z",
    provider: "quickbooks",
  });
  assert.deepEqual(before, { raised: true, invoiceId: "final_p", amountCents: 341250, reviewRequired: false });
  const offCalculation = writeTo(off.writes, "invoiceReferences/final_p")!.calculation as Doc;
  assert.equal(offCalculation.taxAuthority, undefined);
  assert.equal(offCalculation.taxCents, 41250);
});

test("approving a discrepancy-held final uses the pre-tax balance; one already in QuickBooks goes by Send with/without tax", async () => {
  const held = {
    tenantId: "t",
    projectId: "p",
    kind: "final",
    provider: "quickbooks",
    status: "review_required",
    providerState: "review_required",
    providerInvoiceId: null,
    amountCents: 300000,
    balanceCents: 300000,
    calculation: { discrepancies: ["RETAINER_EVIDENCE_MISMATCH"], taxAuthority: "quickbooks" },
  };
  const fake = fakeFirestore(
    finalStore({ "tenantFeatures/t": { quickbooksItemisedInvoices: true }, "invoiceReferences/final_p": held }),
  );
  const result = await approveFinalInvoiceIn(fake.db as never, fake.transaction as never, context(), {
    projectId: "p",
    invoiceId: "final_p",
    confirmAmountCents: 300000,
  });
  assert.equal(result.amountCents, 300000);
  assert.equal(((writeTo(fake.writes, "invoiceReferences/final_p")!.calculation as Doc).taxAuthority), "quickbooks");
  // The screens confirm the same pre-tax figure.
  const store = finalStore({ "invoiceReferences/final_p": held });
  const invoices = Object.entries(store)
    .filter(([path]) => path.startsWith("invoiceReferences/"))
    .map(([path, data]) => ({ id: path.split("/")[1]!, ...data }));
  const proposals = [{ id: "pr", ...store["proposals/pr"] }];
  assert.equal(outstandingFinalBalance({ projectId: "p", proposals, invoices, excludeAgreedTax: true }).cents, 300000);
  assert.equal(outstandingFinalBalance({ projectId: "p", proposals, invoices }).cents, 341250, "unchanged without the option");

  const atQuickBooks = fakeFirestore(finalStore({ "invoiceReferences/final_p": heldFinal() }));
  await assert.rejects(
    approveFinalInvoiceIn(atQuickBooks.db as never, atQuickBooks.transaction as never, context(), {
      projectId: "p",
      invoiceId: "final_p",
      confirmAmountCents: 378875,
    }),
    /INVOICE_HELD_FOR_TAX_CHECK/,
  );
});

// ── 7. Nothing reaches the couple while it is held ─────────────────────────

test("QuickBooks' create webhook does not turn a held bill into a sent one; paid or voided still win", () => {
  const current = { status: "review_required", balanceCents: 378875 };
  assert.deepEqual(providerReportedInvoice({ current, reported: { status: "sent", balanceCents: 378875 } }), {
    status: "review_required",
    balanceCents: 378875,
    keptReason: "held_for_studio_review",
  });
  assert.equal(providerReportedInvoice({ current, reported: { status: "paid", balanceCents: 0 } }).status, "paid");
  assert.equal(providerReportedInvoice({ current, reported: { status: "voided", balanceCents: 0 } }).status, "voided");
});

test("the couple's portal reads a held bill as being prepared, never as payable", () => {
  const portal = read("app/api/client/portal/route.ts");
  assert.match(portal, /sanitized\.atProvider = invoiceRaisedAtProvider\(value\) && value\.status !== "review_required";/);
});

test("the gated worker never overrides tax, never asks QuickBooks to email, and holds before any link or email", () => {
  const worker = read("functions/src/operations/quickbooks-held-invoice.ts");
  assert.doesNotMatch(worker, /TotalTax/);
  assert.doesNotMatch(worker, /`[^`\n]*\/send[^`\n]*`/, "never the QuickBooks send endpoint");
  assert.match(worker, /EmailStatus: "NotSet"/);
  // The link and the email only for an invoice not held.
  assert.match(worker, /if \(providerInvoiceId && !hold\) \{[\s\S]{0,200}deps\.invoiceLink\([\s\S]{0,400}deps\.enqueueInvoiceEmail\(/);
  assert.match(worker, /status: hold \? "review_required"/);
});

// ── 8. Off means exactly today's behaviour ─────────────────────────────────

test("switched off, the invoice worker takes the path it always did", () => {
  const plan = read("functions/src/operations/quickbooks-invoice-plan.ts");
  // The flag is read first; off returns the single line with no `gated`.
  assert.match(plan, /if \(features\.get\(QUICKBOOKS_ITEMISED_FLAG\) !== true\) return single;/);
  const runtime = read("functions/src/operations/provider-runtime.ts");
  assert.match(runtime, /if\(plan\.gated\)return createGatedQuickBooksInvoice\(/);
  // The pre-switch path below it is unchanged.
  assert.match(runtime, /taxMode=plan\.itemised\?quickBooksTaxMode\(preferences\):"none";/);
  const jobs = read("functions/src/operations/jobs.ts");
  assert.match(jobs, /type === HELD_INVOICE_JOB_TYPE\)\s*return releaseQuickBooksHeldInvoice\(document\)/);
  assert.match(jobs, /HELD_INVOICE_JOB_TYPE &&\s*!retryable[\s\S]{0,80}recordHeldInvoiceActionFailed\(/);
});

// ── 9. What the studio sees ────────────────────────────────────────────────

test("Check and send reads Packages · Discount · Retainer received · Sales tax (calculated by QuickBooks for the place) · Balance due", () => {
  const view = heldInvoiceView({ id: "final_p", ...heldFinal() })!;
  assert.deepEqual(
    view.rows.map((row) => [row.label, row.cents, row.note]),
    [
      ["Packages", 580000, null],
      ["Discount", -30000, null],
      ["Retainer received", -200000, null],
      ["Sales tax", 28875, "calculated by QuickBooks for Austin, TX"],
      ["Balance due", 378875, null],
    ],
  );
  assert.equal(view.offerWithoutTax, true);
  assert.equal(view.subtotalCents, 350000);
  assert.equal(salesTaxNote({ strategy: "estimate", rateBasisPoints: 825 }), "your estimate at 8.25%");
  assert.equal(salesTaxNote({ strategy: "none" }), "not charged on this job");
  // Sent: no longer a decision.
  assert.equal(heldInvoiceView({ id: "x", ...heldFinal({ state: "sent" }), status: "awaiting_delivery" }), null);
  // A discrepancy-held bill that never reached QuickBooks has no sendReview.
  assert.equal(heldInvoiceView({ id: "x", status: "review_required", kind: "final" }), null);
});

test("Today asks the studio to check a held final with QuickBooks' figure, and a held retainer too", () => {
  const projects = [{ id: "p", tenantId: "t", name: "Smith wedding", state: "PLANNING", eventDate: "2026-10-20" }];
  const proposals = [
    { id: "pr", projectId: "p", status: "accepted", version: 1, pricingSnapshot: { totalCents: 541250, taxCents: 41250 } },
  ];
  const inbox = todayInbox({
    now: "2026-10-01T12:00:00Z",
    projects,
    proposals,
    invoiceReferences: [
      { id: "r", tenantId: "t", projectId: "p", kind: "retainer", status: "paid", amountCents: 200000, balanceCents: 0 },
      { id: "final_p", ...heldFinal() },
    ],
  } as never);
  const card = inbox.act.find((item) => item.id === "final-balance-review-p")!;
  assert.equal(card.title, "Check and send Smith's final bill · $3,788.75");
  assert.match(card.detail ?? "", /QuickBooks with the sales tax worked out/);

  const retainerInbox = todayInbox({
    now: "2026-10-01T12:00:00Z",
    projects: [{ ...projects[0], state: "RETAINER_PENDING" }],
    proposals,
    invoiceReferences: [
      {
        id: "r",
        ...heldFinal({ reason: "retainer", strategy: "none", taxCents: 0, subtotalCents: 200000, totalCents: 200000 }),
        kind: "retainer",
        amountCents: 200000,
        balanceCents: 200000,
        providerLines: { lines: [{ kind: "retainer", amountCents: 200000 }] },
      },
    ],
  } as never);
  const retainerCard = retainerInbox.act.find((item) => item.id === "retainer-review-r")!;
  assert.equal(retainerCard.title, "Check and send Smith's retainer · $2,000");
  assert.equal((retainerCard.action as { href?: string }).href, "/studio/booking?project=p");
});
