import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as features from "../features/billing/sales-tax-settings.ts";
import * as functionsCopy from "../functions/src/billing/sales-tax-settings.ts";
import {
  INCOME_ACCOUNT_QUERY,
  STUDIOCUE_QUICKBOOKS_ITEMS,
  TAX_RATE_QUERY,
  activeItemIds,
  companyBillAddr,
  customerByNameQuery,
  itemByNameQuery,
  itemCreateBody,
  itemKeyForLine,
  itemsByIdQuery,
  mockTestInvoiceResult,
  providerErrorDetail,
  quickBooksCompanyStatus,
  quickBooksPaymentsState,
  quickBooksQueryLiteral,
  quickBooksSalesTaxSetup,
  singleTaxRateBasisPoints,
  testCustomerBody,
  testInvoiceBody,
  testInvoiceChecks,
  usableItem,
  type TestInvoiceOutcome,
} from "../functions/src/integrations/quickbooks-setup-core.ts";
import { ensureStudioCueItems, verifiedStoredItemIds, type QuickBooksCompany } from "../functions/src/integrations/quickbooks-items.ts";
import { runQuickBooksTestInvoice } from "../functions/src/integrations/quickbooks-test-invoice.ts";
import { quickBooksLinePayload, type InvoiceLine } from "../functions/src/operations/quickbooks-invoice-lines.ts";
import {
  QUICKBOOKS_MONEY_ENTITIES,
  invoiceIdsLinkedTo,
  quickBooksEntityGone,
  refundRecordedTask,
  refundSummary,
  reopenedByProvider,
  reopenedInvoiceTask,
} from "../functions/src/booking/quickbooks-money-events-core.ts";
import { providerReportedInvoice } from "../functions/src/booking/invoice-standing.ts";
import { setJobSalesTaxExempt } from "../functions/src/booking/job-sales-tax.ts";

const read = (path: string) => readFileSync(path, "utf8");

// --- the settings shape ------------------------------------------------------

for (const [name, module] of [
  ["features", features],
  ["functions", functionsCopy],
] as const) {
  test(`${name}: a studio with no settings adds no sales tax`, () => {
    const settings = module.normaliseBillingSettings(null, "tenant-a");
    assert.deepEqual(settings, {
      tenantId: "tenant-a",
      salesTax: { mode: "none", estimateRateBasisPoints: null },
      holdRetainerForReview: false,
      quickbooksItems: { retainerItemId: null, packageItemId: null },
      updatedAt: null,
      updatedBy: null,
    });
    assert.deepEqual(module.defaultBillingSettings("tenant-a"), settings);
  });

  test(`${name}: a QuickBooks company with sales tax on suggests QuickBooks, until the studio chooses`, () => {
    assert.equal(module.normaliseBillingSettings(null, "t", { quickBooksSalesTax: true }).salesTax.mode, "quickbooks");
    assert.equal(module.normaliseBillingSettings({ tenantId: "t" }, "t", { quickBooksSalesTax: true }).salesTax.mode, "quickbooks");
    // A saved choice always wins over the suggestion.
    assert.equal(
      module.normaliseBillingSettings({ salesTax: { mode: "none" } }, "t", { quickBooksSalesTax: true }).salesTax.mode,
      "none",
    );
    assert.equal(module.normaliseBillingSettings({ salesTax: { mode: "quickbooks" } }, "t").salesTax.mode, "quickbooks");
  });

  test(`${name}: anything malformed falls back, and unknown fields are dropped`, () => {
    const settings = module.normaliseBillingSettings(
      {
        tenantId: "tenant-a",
        salesTax: { mode: "stripe", estimateRateBasisPoints: 99999 },
        holdRetainerForReview: "yes",
        quickbooksItems: { retainerItemId: "  ", packageItemId: 7 },
        updatedAt: "2026-10-01T00:00:00.000Z",
        updatedBy: "owner-a",
        secret: "never",
      },
      "tenant-a",
    );
    assert.deepEqual(settings, {
      tenantId: "tenant-a",
      salesTax: { mode: "none", estimateRateBasisPoints: null },
      holdRetainerForReview: false,
      quickbooksItems: { retainerItemId: null, packageItemId: null },
      updatedAt: "2026-10-01T00:00:00.000Z",
      updatedBy: "owner-a",
    });
    assert.equal(module.normaliseBillingSettings({ salesTax: { estimateRateBasisPoints: 825.4 } }, "t").salesTax.estimateRateBasisPoints, 825);
    assert.equal(module.normaliseBillingSettings({ salesTax: { estimateRateBasisPoints: -1 } }, "t").salesTax.estimateRateBasisPoints, null);
    assert.equal(module.normaliseBillingSettings({ salesTax: { estimateRateBasisPoints: 0 } }, "t").salesTax.estimateRateBasisPoints, 0);
  });

  test(`${name}: sales tax applies only on QuickBooks, and never to an exempt job`, () => {
    const on = module.normaliseBillingSettings({ salesTax: { mode: "quickbooks" } }, "t");
    const off = module.normaliseBillingSettings({ salesTax: { mode: "none" } }, "t");
    assert.equal(module.salesTaxApplies(on, {}), true);
    assert.equal(module.salesTaxApplies(on, { salesTaxExempt: false }), true);
    assert.equal(module.salesTaxApplies(on, null), true);
    assert.equal(module.salesTaxApplies(on, { salesTaxExempt: true }), false);
    // Only a real true exempts: a stray string is not a decision.
    assert.equal(module.salesTaxApplies(on, { salesTaxExempt: "true" }), true);
    assert.equal(module.salesTaxApplies(off, {}), false);
    assert.equal(module.salesTaxApplies(off, { salesTaxExempt: false }), false);
  });

  test(`${name}: the proposal estimate is the subtotal at the estimated rate, else nothing`, () => {
    const at = (mode: string, rate: number | null) =>
      module.normaliseBillingSettings({ salesTax: { mode, estimateRateBasisPoints: rate } }, "t");
    assert.equal(module.estimatedSalesTaxCents(500000, at("quickbooks", 825)), 41250);
    assert.equal(module.estimatedSalesTaxCents(333, at("quickbooks", 825)), 27); // 27.47 rounds
    assert.equal(module.estimatedSalesTaxCents(500000, at("quickbooks", null)), 0);
    assert.equal(module.estimatedSalesTaxCents(500000, at("none", 825)), 0);
    assert.equal(module.estimatedSalesTaxCents(-5, at("quickbooks", 825)), 0);
    assert.equal(module.estimatedSalesTaxCents(Number.NaN, at("quickbooks", 825)), 0);
  });

  test(`${name}: a typed percentage becomes basis points and back`, () => {
    assert.equal(module.percentToBasisPoints("8.25"), 825);
    assert.equal(module.percentToBasisPoints("8.25%"), 825);
    assert.equal(module.percentToBasisPoints(" 7 "), 700);
    assert.equal(module.percentToBasisPoints("8.875"), 888);
    assert.equal(module.percentToBasisPoints(""), null);
    assert.equal(module.percentToBasisPoints("abc"), null);
    assert.equal(module.percentToBasisPoints("30"), null);
    assert.equal(module.percentToBasisPoints("-1"), null);
    assert.equal(module.basisPointsToPercent(825), "8.25");
    assert.equal(module.basisPointsToPercent(700), "7");
    assert.equal(module.basisPointsToPercent(null), "");
  });
}

test("the functions copy of the billing settings matches features/ exactly", () => {
  const body = (path: string) => {
    const source = read(path);
    const marker = source.indexOf("// --- shared with functions/src/billing/sales-tax-settings.ts ---");
    assert.ok(marker >= 0, `${path} lost its marker`);
    return source.slice(marker);
  };
  assert.equal(body("functions/src/billing/sales-tax-settings.ts"), body("features/billing/sales-tax-settings.ts"));
});

// --- who may change them -----------------------------------------------------

test("billing settings are saved by an owner/admin command that audits, and never set the item ids", () => {
  const source = read("functions/src/integrations/commands.ts");
  assert.match(source, /const allowedRoles = \["studio_owner", "studio_admin"\];/);
  assert.match(source, /type: z\.literal\("setBillingSettings"\)/);
  const block = source.slice(source.indexOf('z.literal("setBillingSettings")'));
  const schema = block.slice(0, block.indexOf("}),\n]);"));
  assert.match(schema, /mode: z\.enum\(\["quickbooks", "none"\]\)/);
  assert.doesNotMatch(schema, /quickbooksItems/, "item ids are StudioCue's to keep, not the browser's to set");
  const handler = source.slice(source.indexOf('command.type === "setBillingSettings"'));
  assert.match(handler.slice(0, 2500), /action: "billing\.settings_set"/);
  assert.match(handler.slice(0, 2500), /quickbooksItems: before\.quickbooksItems/);
});

test("the QuickBooks setup Function is owner/admin, gated, and holds the QuickBooks credentials", () => {
  const source = read("functions/src/integrations/quickbooks-setup.ts");
  assert.match(source, /const allowedRoles = \["studio_owner", "studio_admin"\];/);
  assert.match(source, /requireActiveSubscription\(/);
  assert.match(source, /secrets: \["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET"\]/);
  assert.match(source, /invoker: "private"/);
  assert.match(read("functions/src/index.ts"), /export \{ quickbooksSetupCommand \}/);
  assert.match(read("app/api/functions/[functionName]/route.ts"), /"quickbooksSetupCommand"/);
  assert.match(read("scripts/configure-production-function-invokers.sh"), /^\s*quickbookssetupcommand\s*$/m);
});

test("a coordinator cannot exempt a job from sales tax", async () => {
  await assert.rejects(
    setJobSalesTaxExempt(
      {
        tenantId: "tenant-a",
        membership: { role: "studio_coordinator" },
        actorId: "coordinator-a",
        timestamp: "2026-10-01T00:00:00.000Z",
        idempotencyKey: "sales-tax-1",
        ipAddress: null,
        userAgent: null,
      },
      { projectId: "project-a", exempt: true },
    ),
    /SALES_TAX_PERMISSION_REQUIRED/,
  );
  const booking = read("functions/src/booking/commands.ts");
  assert.match(booking, /type: z\.literal\("setJobSalesTaxExempt"\)/);
  assert.match(read("firestore.rules"), /affectedKeys\(\)\.hasAny\(\["salesTaxExempt"\]\)/);
});

// --- the two StudioCue items -------------------------------------------------

test("a retainer is sold as the non-taxable Retainer item, everything else as the taxable package", () => {
  assert.equal(STUDIOCUE_QUICKBOOKS_ITEMS.retainer.name, "Retainer");
  assert.equal(STUDIOCUE_QUICKBOOKS_ITEMS.package.name, "Photography package");
  assert.deepEqual(itemCreateBody("retainer", "79", { withTaxable: true }), {
    Name: "Retainer",
    Type: "Service",
    Description: "Retainer to secure the date",
    IncomeAccountRef: { value: "79" },
    Taxable: false,
  });
  assert.equal(itemCreateBody("package", "79", { withTaxable: true }).Taxable, true);
  assert.equal("Taxable" in itemCreateBody("package", "79", { withTaxable: false }), false);
  for (const kind of ["retainer", "retainer_received", "payments_received"] as const) assert.equal(itemKeyForLine(kind), "retainer");
  for (const kind of ["package", "add_on", "discount", "sales_tax", "amount"] as const) assert.equal(itemKeyForLine(kind), "package");
});

test("an existing item is found by name; inactive items and categories don't count", () => {
  assert.equal(usableItem({ QueryResponse: {} }), null);
  assert.equal(usableItem({ QueryResponse: { Item: [{ Id: "1", Active: false }] } }), null);
  assert.equal(usableItem({ QueryResponse: { Item: [{ Id: "2", Type: "Category" }] } }), null);
  assert.deepEqual(usableItem({ QueryResponse: { Item: [{ Id: "3", Name: "Retainer", Active: true, Taxable: false }] } }), {
    id: "3",
    name: "Retainer",
    taxable: false,
  });
  assert.deepEqual([...activeItemIds({ QueryResponse: { Item: [{ Id: "1" }, { Id: "2", Active: false }] } })], ["1"]);
  assert.equal(quickBooksQueryLiteral("Gabe's"), "'Gabe\\'s'");
  assert.equal(itemByNameQuery("Retainer"), "select Id, Name, Type, Active, Taxable from Item where Name = 'Retainer'");
  assert.equal(itemsByIdQuery(["1", "2"]), "select Id, Name, Type, Active, Taxable from Item where Id in ('1', '2')");
});

/** A QuickBooks company that answers from a script, recording what was asked. */
function fakeCompany(answers: { query?: (sql: string) => unknown; post?: (path: string, body: Record<string, unknown>) => unknown }) {
  const calls: Array<{ kind: string; target: string; body?: Record<string, unknown>; requestId?: string }> = [];
  const company: QuickBooksCompany = {
    async query(sql) {
      calls.push({ kind: "query", target: sql });
      return (answers.query?.(sql) ?? { QueryResponse: {} }) as Record<string, unknown>;
    },
    async get(path) {
      calls.push({ kind: "get", target: path });
      return {};
    },
    async post(path, body, code, requestId) {
      calls.push({ kind: "post", target: path, body: body as Record<string, unknown>, requestId });
      const answer = answers.post?.(path, body as Record<string, unknown>);
      if (answer instanceof Error) throw answer;
      return (answer ?? {}) as Record<string, unknown>;
    },
  };
  return { company, calls };
}

test("setting up items reuses what the studio has and makes only what is missing", async () => {
  const { company, calls } = fakeCompany({
    query: (sql) =>
      sql.includes("'Retainer'")
        ? { QueryResponse: { Item: [{ Id: "11", Name: "Retainer", Type: "Service" }] } }
        : sql.includes("from Account")
          ? { QueryResponse: { Account: [{ Id: "79" }] } }
          : { QueryResponse: {} },
    post: () => ({ Item: { Id: "12", Name: "Photography package" } }),
  });
  const result = await ensureStudioCueItems(company, "key-123456");
  assert.deepEqual(result, { ids: { retainerItemId: "11", packageItemId: "12" }, created: ["package"] });
  const created = calls.filter((call) => call.kind === "post");
  assert.equal(created.length, 1);
  assert.equal(created[0]!.body!.Name, "Photography package");
  assert.equal(created[0]!.body!.Taxable, true);
  assert.equal(created[0]!.requestId, "key-123456-package");
});

test("a company that refuses Taxable still gets its item, asked again without it", async () => {
  let attempts = 0;
  const { company, calls } = fakeCompany({
    query: (sql) => (sql.includes("from Account") ? { QueryResponse: { Account: [{ Id: "79" }] } } : { QueryResponse: {} }),
    post: (_path, body) => {
      attempts += 1;
      if ("Taxable" in body) return new Error("QUICKBOOKS_ITEM_CREATE_FAILED:400:Taxable not supported");
      return { Item: { Id: `item-${attempts}` } };
    },
  });
  const result = await ensureStudioCueItems(company, "key-123456");
  assert.equal(result.created.length, 2);
  assert.ok(result.ids.retainerItemId && result.ids.packageItemId);
  assert.equal(calls.filter((call) => call.kind === "post").length, 4);
});

test("no income account: nothing is made and the studio is told why", async () => {
  const { company } = fakeCompany({ query: () => ({ QueryResponse: {} }) });
  await assert.rejects(ensureStudioCueItems(company, "key-123456"), /QUICKBOOKS_INCOME_ACCOUNT_MISSING/);
});

test("stored item ids are used only while both are still active in QuickBooks", async () => {
  const both = fakeCompany({ query: () => ({ QueryResponse: { Item: [{ Id: "1" }, { Id: "2" }] } }) });
  assert.deepEqual(await verifiedStoredItemIds(both.company, { retainerItemId: "1", packageItemId: "2" }), {
    retainerItemId: "1",
    packageItemId: "2",
  });
  const one = fakeCompany({ query: () => ({ QueryResponse: { Item: [{ Id: "1" }, { Id: "2", Active: false }] } }) });
  assert.equal(await verifiedStoredItemIds(one.company, { retainerItemId: "1", packageItemId: "2" }), null);
  const none = fakeCompany({});
  assert.equal(await verifiedStoredItemIds(none.company, { retainerItemId: null, packageItemId: "2" }), null);
  assert.equal(none.calls.length, 0, "nothing stored, nothing asked");
});

test("each invoice line carries its own item when the worker has the StudioCue items", () => {
  const lines: InvoiceLine[] = [
    { kind: "retainer", title: "Retainer", description: "Retainer", quantity: 2, unitPriceCents: 100000, amountCents: 200000, taxable: false },
    { kind: "package", title: "Gold", description: "Gold", quantity: 1, unitPriceCents: 0, amountCents: 0, taxable: true },
  ];
  const payload = quickBooksLinePayload({
    lines,
    taxCents: 0,
    mode: "none",
    itemRef: (line) => (line.kind === "retainer" ? { value: "11", name: "Retainer" } : { value: "12", name: "Photography package" }),
  });
  const refs = payload.Line.map((line) => (line.SalesItemLineDetail as { ItemRef: { value: string } }).ItemRef.value);
  assert.deepEqual(refs, ["11", "12"]);
  // The old single-item shape still works.
  const single = quickBooksLinePayload({ lines, taxCents: 0, mode: "none", itemRef: { value: "9" } });
  assert.deepEqual(single.Line.map((line) => (line.SalesItemLineDetail as { ItemRef: { value: string } }).ItemRef.value), ["9", "9"]);
});

test("the invoice worker asks for the StudioCue items and falls back to the old single item", () => {
  const runtime = read("functions/src/operations/provider-runtime.ts");
  assert.match(runtime, /studioCueInvoiceItemRefs\(\{tenantId,company:quickBooksCompany\(/);
  assert.match(runtime, /\?\?await quickBooksItemRef\(base,realmId,credential,itemKey\)/);
});

/**
 * Same rule as tests/quickbooks-query-fields.test.ts: QuickBooks 400s a query
 * on a property it won't filter, so every filter the setup builds must be on
 * the filterable list (Intuit's entity reference).
 */
test("every setup query filters only on properties QuickBooks will filter on", () => {
  const filterable: Record<string, Set<string>> = {
    Item: new Set(["Id", "Name", "Type", "Active"]),
    Account: new Set(["Id", "Name", "AccountType", "Active"]),
    Customer: new Set(["Id", "DisplayName", "PrimaryEmailAddr", "Active"]),
    TaxRate: new Set<string>(),
  };
  for (const query of [itemByNameQuery("Retainer"), itemsByIdQuery(["1", "2"]), INCOME_ACCOUNT_QUERY, customerByNameQuery("StudioCue test (you)"), TAX_RATE_QUERY]) {
    const match = /^select .+? from (\w+)(.*)$/i.exec(query);
    assert.ok(match, query);
    const allowed = filterable[match[1]!];
    assert.ok(allowed, `no filterable list for ${match[1]}`);
    const fields = [...match[2]!.matchAll(/(?:where|and)\s+([A-Za-z][\w.]*)\s*(?:=|!=|<|>|\blike\b|\bin\b)/gi)].map((found) => found[1]!);
    if (/\bwhere\b/i.test(match[2]!)) assert.ok(fields.length, `parsed no filter from ${query}`);
    for (const field of fields) assert.ok(allowed.has(field), `${match[1]}.${field} is not filterable`);
  }
});

// --- what the connected company does ------------------------------------------

test("the company's sales tax and payments, in the studio's words", () => {
  assert.equal(quickBooksSalesTaxSetup({ TaxPrefs: { UsingSalesTax: true, PartnerTaxEnabled: true } }), "automatic");
  assert.equal(quickBooksSalesTaxSetup({ TaxPrefs: { UsingSalesTax: true } }), "manual");
  assert.equal(quickBooksSalesTaxSetup({ TaxPrefs: { UsingSalesTax: false } }), "off");
  assert.equal(quickBooksSalesTaxSetup(null), "off");
  const rates = { QueryResponse: { TaxRate: [{ RateValue: 8.25, Active: true }, { RateValue: 8.25 }, { RateValue: 0 }] } };
  assert.equal(singleTaxRateBasisPoints("manual", rates), 825);
  assert.equal(singleTaxRateBasisPoints("automatic", rates), null, "an automatic rate depends on the address");
  assert.equal(
    singleTaxRateBasisPoints("manual", { QueryResponse: { TaxRate: [{ RateValue: 8.25 }, { RateValue: 6 }] } }),
    null,
    "two rates: no single guess",
  );
  assert.deepEqual(quickBooksPaymentsState({ preferences: null, lastTest: null }), { state: "unknown", source: null });
  assert.deepEqual(quickBooksPaymentsState({ preferences: { SalesFormsPrefs: { ETransactionPaymentEnabled: true } }, lastTest: null }), {
    state: "on",
    source: "preferences",
  });
  // A real pay link (or its absence) outranks the preference hint.
  assert.deepEqual(
    quickBooksPaymentsState({ preferences: { SalesFormsPrefs: { ETransactionPaymentEnabled: true } }, lastTest: { payLink: false, at: "x" } }),
    { state: "off", source: "test_invoice" },
  );
  const status = quickBooksCompanyStatus({
    companyInfo: { CompanyInfo: { CompanyName: "GR Productions", Country: "US" } },
    preferences: { TaxPrefs: { UsingSalesTax: true } },
    taxRates: rates,
    lastTest: null,
  });
  assert.equal(status.companyName, "GR Productions");
  assert.equal(status.salesTax, "manual");
  assert.equal(status.suggestedEstimateRateBasisPoints, 825);
});

// --- the test invoice ------------------------------------------------------------

const passing: TestInvoiceOutcome = {
  customer: { ok: true, created: true },
  invoice: { ok: true, id: "130", docNumber: "1042", totalCents: 108, taxCents: 8 },
  payLink: "https://connect.intuit.com/pay/abc",
  void: { ok: true },
  salesTax: "quickbooks",
  companySalesTax: "automatic",
};

test("a test invoice that works passes every check", () => {
  const result = testInvoiceChecks(passing, "2026-10-01T12:00:00.000Z");
  assert.equal(result.passed, true);
  assert.deepEqual(result.checks.map((check) => [check.key, check.ok]), [
    ["customer", true],
    ["invoice", true],
    ["tax", true],
    ["pay_link", true],
    ["void", true],
  ]);
  assert.match(result.checks[2]!.detail, /\$0\.08 tax/);
  assert.equal(result.invoiceId, "130");
});

test("tax isn't checked for a studio that adds none, and doesn't fail the test", () => {
  const result = testInvoiceChecks({ ...passing, salesTax: "none", invoice: { ...passing.invoice!, taxCents: null } }, "t");
  assert.equal(result.checks.find((check) => check.key === "tax")!.ok, null);
  assert.equal(result.passed, true);
});

test("each failure is named, and a later step that never ran is not blamed", () => {
  const noPayments = testInvoiceChecks({ ...passing, payLink: null }, "t");
  assert.equal(noPayments.passed, false);
  assert.match(noPayments.checks.find((check) => check.key === "pay_link")!.detail, /QuickBooks Payments/);
  const manual = testInvoiceChecks({ ...passing, companySalesTax: "manual" }, "t");
  assert.equal(manual.checks.find((check) => check.key === "tax")!.ok, false);
  assert.match(manual.checks.find((check) => check.key === "tax")!.detail, /Automated Sales Tax/);
  const stuck = testInvoiceChecks({ ...passing, void: { ok: false, error: "stale SyncToken" } }, "t");
  assert.equal(stuck.passed, false);
  assert.match(stuck.checks.find((check) => check.key === "void")!.detail, /Void it yourself/);
  const noCustomer = testInvoiceChecks(
    { ...passing, customer: { ok: false, error: "Duplicate Name Exists Error" }, invoice: null, payLink: null, void: null },
    "t",
  );
  assert.equal(noCustomer.passed, false);
  assert.deepEqual(noCustomer.checks.map((check) => check.ok), [false, null, null, null, null]);
});

test("mock mode passes deterministically without contacting QuickBooks", () => {
  const first = mockTestInvoiceResult("2026-10-01T00:00:00.000Z", "quickbooks");
  assert.equal(first.passed, true);
  assert.equal(first.mock, true);
  assert.deepEqual(first, mockTestInvoiceResult("2026-10-01T00:00:00.000Z", "quickbooks"));
});

test("the test invoice is $1.00, asks for online payment, and lets QuickBooks work out the tax", () => {
  const body = testInvoiceBody({
    customerId: "58",
    itemRef: { value: "12" },
    salesTax: "quickbooks",
    companySalesTax: "automatic",
    today: "2026-10-01",
    withOnlinePayment: true,
  });
  assert.equal(body.AllowOnlineCreditCardPayment, true);
  assert.equal(body.AllowOnlineACHPayment, true);
  assert.equal("TxnTaxDetail" in body, false, "no override: QuickBooks calculates");
  const line = (body.Line as Array<Record<string, unknown>>)[0]!;
  assert.equal(line.Amount, 1);
  assert.deepEqual((line.SalesItemLineDetail as Record<string, unknown>).TaxCodeRef, { value: "TAX" });
  const untaxed = testInvoiceBody({ customerId: "58", itemRef: { value: "12" }, salesTax: "none", companySalesTax: "automatic", today: "2026-10-01", withOnlinePayment: false });
  assert.deepEqual(((untaxed.Line as Array<Record<string, unknown>>)[0]!.SalesItemLineDetail as Record<string, unknown>).TaxCodeRef, { value: "NON" });
  assert.equal("AllowOnlineCreditCardPayment" in untaxed, false);
  const noTaxCompany = testInvoiceBody({ customerId: "58", itemRef: { value: "12" }, salesTax: "quickbooks", companySalesTax: "off", today: "2026-10-01", withOnlinePayment: true });
  assert.equal("TaxCodeRef" in (((noTaxCompany.Line as Array<Record<string, unknown>>)[0]!.SalesItemLineDetail) as Record<string, unknown>), false);
});

test("the test customer is the studio, at the studio's own address", () => {
  const address = companyBillAddr({ CompanyInfo: { CompanyAddr: { Line1: "1 Main St", City: "Austin", CountrySubDivisionCode: "TX", PostalCode: "78701" } } });
  assert.deepEqual(address, { Line1: "1 Main St", City: "Austin", CountrySubDivisionCode: "TX", PostalCode: "78701" });
  assert.equal(companyBillAddr({ CompanyInfo: {} }), null);
  const body = testCustomerBody("owner@studio.test", address);
  assert.equal(body.DisplayName, "StudioCue test (you)");
  assert.deepEqual(body.PrimaryEmailAddr, { Address: "owner@studio.test" });
  assert.deepEqual(body.BillAddr, address);
  assert.equal(providerErrorDetail(new Error("QUICKBOOKS_CREATE_FAILED:400:Invalid Reference Id")), "Invalid Reference Id");
});

// --- money moving back in QuickBooks ------------------------------------------------

test("payments, credit memos and refunds are no longer ignored by the webhook", () => {
  assert.deepEqual([...QUICKBOOKS_MONEY_ENTITIES].sort(), ["creditmemo", "payment", "refundreceipt"]);
  const webhook = read("functions/src/booking/webhooks.ts");
  assert.match(webhook, /QUICKBOOKS_MONEY_ENTITIES\.has\(event\.entityName\)/);
  assert.match(webhook, /type: RECONCILE_MONEY_EVENT_JOB/);
  assert.match(read("functions/src/operations/jobs.ts"), /type === "reconcile_quickbooks_money_event"\)\s*return reconcileQuickBooksMoneyEvent/);
  assert.equal(quickBooksEntityGone("Delete"), true);
  assert.equal(quickBooksEntityGone("deleted"), true);
  assert.equal(quickBooksEntityGone("void"), false, "a voided payment can still be read");
});

test("a payment names the invoices it was applied to", () => {
  assert.deepEqual(
    invoiceIdsLinkedTo({
      Line: [
        { LinkedTxn: [{ TxnType: "Invoice", TxnId: "130" }] },
        { LinkedTxn: [{ TxnType: "CreditMemo", TxnId: "9" }, { TxnType: "Invoice", TxnId: "131" }, { TxnType: "Invoice", TxnId: "130" }] },
      ],
    }),
    ["130", "131"],
  );
  assert.deepEqual(invoiceIdsLinkedTo({}), []);
});

test("an invoice QuickBooks no longer shows paid reopens, and only then", () => {
  // A provider-paid retainer whose payment was deleted in QuickBooks: the
  // reconcile's own rule lets QuickBooks' balance through...
  const decided = providerReportedInvoice({
    current: { status: "paid", completionAuthority: "provider_verified", balanceCents: 0 },
    reported: { status: "sent", balanceCents: 200000 },
  });
  assert.deepEqual(decided, { status: "sent", balanceCents: 200000, keptReason: null });
  // ...and that is a reopen the studio must hear about.
  assert.equal(reopenedByProvider({ before: { status: "paid", balanceCents: 0 }, after: decided }), true);
  assert.equal(reopenedByProvider({ before: { status: "paid", balanceCents: 0 }, after: { status: "partially_paid", balanceCents: 50000 } }), true);
  // Not a reopen: never paid, still paid, or voided.
  assert.equal(reopenedByProvider({ before: { status: "sent", balanceCents: 200000 }, after: { status: "sent", balanceCents: 200000 } }), false);
  assert.equal(reopenedByProvider({ before: { status: "paid", balanceCents: 0 }, after: { status: "paid", balanceCents: 0 } }), false);
  assert.equal(reopenedByProvider({ before: { status: "paid", balanceCents: 0 }, after: { status: "voided", balanceCents: 0 } }), false);
  // A payment the studio recorded by hand is kept, so nothing reopens.
  const kept = providerReportedInvoice({
    current: { status: "paid", completionAuthority: "manual_attested", balanceCents: 0 },
    reported: { status: "sent", balanceCents: 200000 },
  });
  assert.equal(reopenedByProvider({ before: { status: "paid", balanceCents: 0 }, after: kept }), false);
  // The reconcile raises the task.
  const runtime = read("functions/src/operations/provider-runtime.ts");
  assert.match(runtime, /if\(reopenedByProvider\(\{before:\{status:invoice\.get\("status"\)/);
});

test("the reopen task says what happened and what to do, once per invoice", () => {
  const task = reopenedInvoiceTask({
    invoiceId: "invoice_a",
    tenantId: "tenant-a",
    projectId: "project-a",
    kind: "retainer",
    docNumber: "1042",
    balanceCents: 200000,
    currency: "USD",
    now: "2026-10-01T12:00:00.000Z",
  });
  assert.equal(task.id, "invoice_reopened_invoice_a");
  assert.equal(task.title, "QuickBooks no longer shows the retainer paid");
  assert.match(task.description, /\$2,000\.00 is owing again/);
  assert.match(task.description, /1042/);
  assert.equal(task.priority, "high");
  assert.equal(task.status, "not_started");
  assert.equal(task.dueDate, "2026-10-01");
  assert.equal(task.source, "quickbooks_reopened");
});

test("a refund is reported to the studio, and does not reopen the invoice", () => {
  const summary = refundSummary({ CustomerRef: { value: "58", name: "Ana & Ben" }, TotalAmt: 500, DocNumber: "R-7", CurrencyRef: { value: "USD" } });
  assert.deepEqual(summary, { customerId: "58", customerName: "Ana & Ben", amountCents: 50000, docNumber: "R-7", currency: "USD" });
  const task = refundRecordedTask({ refundId: "77", tenantId: "t", projectId: "p", ...summary, now: "2026-10-01T00:00:00.000Z" });
  assert.equal(task.id, "quickbooks_refund_77");
  assert.equal(task.title, "Refund of $500.00 recorded in QuickBooks");
  assert.match(task.description, /doesn't reopen an invoice/);
  assert.match(task.description, /to Ana & Ben/);
  // The worker only queues invoice reconciles; it never writes a balance itself.
  const worker = read("functions/src/booking/quickbooks-money-events.ts");
  assert.doesNotMatch(worker, /balanceCents:/);
  assert.match(worker, /type: "reconcile_quickbooks_invoice"/);
  assert.match(worker, /operation: "update"/);
});

test("the test invoice run: customer, invoice, tax, pay link and void, nothing emailed", async () => {
  const { company, calls } = fakeCompany({
    query: (sql) =>
      sql.includes("from Item where Id in") ? { QueryResponse: { Item: [{ Id: "11" }, { Id: "12" }] } } : { QueryResponse: {} },
    post: (path) =>
      path === "customer"
        ? { Customer: { Id: "58" } }
        : path === "invoice"
          ? { Invoice: { Id: "130", SyncToken: "0", DocNumber: "1042", TotalAmt: 1.08, TxnTaxDetail: { TotalTax: 0.08 } } }
          : {},
  });
  company.get = async (path) => {
    calls.push({ kind: "get", target: path });
    if (path.startsWith("companyinfo/"))
      return { CompanyInfo: { CompanyName: "GR Productions", CompanyAddr: { Line1: "1 Main St", City: "Austin" } } };
    if (path === "preferences") return { Preferences: { TaxPrefs: { UsingSalesTax: true, PartnerTaxEnabled: true } } };
    if (path.startsWith("invoice/130")) return { Invoice: { Id: "130", SyncToken: "1", InvoiceLink: "https://connect.intuit.com/pay/x" } };
    return {};
  };
  const run = await runQuickBooksTestInvoice({
    company,
    realmId: "9130",
    salesTax: "quickbooks",
    storedItems: { retainerItemId: "11", packageItemId: "12" },
    email: "owner@studio.test",
    idempotencyKey: "qbo_test_123456",
    now: "2026-10-01T12:00:00.000Z",
  });
  assert.equal(run.result.passed, true, JSON.stringify(run.result.checks));
  assert.equal(run.itemsChanged, false);
  const posts = calls.filter((call) => call.kind === "post");
  assert.deepEqual(posts.map((call) => call.target), ["customer", "invoice", "invoice?operation=void"]);
  assert.deepEqual(posts[2]!.body, { Id: "130", SyncToken: "1" }, "voided at the SyncToken just read");
  assert.equal(posts[0]!.body!.DisplayName, "StudioCue test (you)");
  assert.deepEqual(posts[0]!.body!.BillAddr, { Line1: "1 Main St", City: "Austin" });
  assert.ok(!calls.some((call) => call.target.includes("/send")), "nothing is emailed");
});
