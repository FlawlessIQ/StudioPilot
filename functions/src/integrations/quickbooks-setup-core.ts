/**
 * Managing QuickBooks from inside StudioCue: the pure half.
 *
 * Settings → Integrations → QuickBooks reads the connected company (its name,
 * how it does sales tax, whether it can take payments online), sets up the two
 * items StudioCue invoices with, and sends a $1.00 test invoice it voids
 * straight away. Everything here is pure — no Firestore, no fetch — so
 * tests/billing-settings.test.ts pins every rule. The I/O is in
 * quickbooks-items.ts (items) and quickbooks-setup.ts (the Function).
 */
import { quickBooksBillEmail, quickBooksTaxMode, type InvoiceLineKind } from "../operations/quickbooks-invoice-lines.js";
import type { SalesTaxMode } from "../billing/sales-tax-settings.js";

type Json = Record<string, unknown>;
const record = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * The two items every StudioCue invoice line is sold as.
 *
 * A retainer is a deposit against the work, not a taxable sale, so its item
 * is non-taxable; the package is the taxable service. Found by name first, so
 * a studio that already has a "Retainer" item keeps using it.
 */
export const STUDIOCUE_QUICKBOOKS_ITEMS = {
  retainer: { name: "Retainer", taxable: false, description: "Retainer to secure the date" },
  package: { name: "Photography package", taxable: true, description: "Photography package" },
} as const;

export type StudioCueItemKey = keyof typeof STUDIOCUE_QUICKBOOKS_ITEMS;

export type StudioCueItemIds = { retainerItemId: string | null; packageItemId: string | null };

/** A string inside a QuickBooks query: single quotes escaped with a backslash. */
export function quickBooksQueryLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Find an item by its exact name. Name is a filterable Item property. */
export function itemByNameQuery(name: string): string {
  return `select Id, Name, Type, Active, Taxable from Item where Name = ${quickBooksQueryLiteral(name)}`;
}

/** Re-read stored items by id, to see they still exist and are active. */
export function itemsByIdQuery(ids: readonly string[]): string {
  const list = ids.filter(Boolean).map(quickBooksQueryLiteral).join(", ");
  return `select Id, Name, Type, Active, Taxable from Item where Id in (${list})`;
}

/** The first income account, which a new service item posts to. */
export const INCOME_ACCOUNT_QUERY = "select Id, Name from Account where AccountType = 'Income' and Active = true maxresults 1";

/** A customer by display name — how the test customer is found again. */
export function customerByNameQuery(name: string): string {
  return `select Id, DisplayName, SyncToken from Customer where DisplayName = ${quickBooksQueryLiteral(name)}`;
}

/** Unfiltered on purpose: a short list, and no filter QuickBooks could refuse. */
export const TAX_RATE_QUERY = "select Id, Name, RateValue, Active from TaxRate maxresults 100";

/** An active, sellable item from a query response, or null. */
export function usableItem(response: unknown): { id: string; name: string; taxable: boolean | null } | null {
  const items = record(record(response).QueryResponse).Item;
  if (!Array.isArray(items)) return null;
  for (const entry of items) {
    const item = record(entry);
    const id = text(item.Id);
    if (!id || item.Active === false) continue;
    // A category groups items; it cannot be sold on a line.
    if (text(item.Type) === "Category") continue;
    return { id, name: text(item.Name), taxable: typeof item.Taxable === "boolean" ? item.Taxable : null };
  }
  return null;
}

/** Which of the stored ids came back active from itemsByIdQuery. */
export function activeItemIds(response: unknown): Set<string> {
  const items = record(record(response).QueryResponse).Item;
  if (!Array.isArray(items)) return new Set();
  return new Set(
    items
      .map(record)
      .filter((item) => item.Active !== false && text(item.Type) !== "Category")
      .map((item) => text(item.Id))
      .filter(Boolean),
  );
}

/**
 * The body for a new StudioCue item.
 *
 * `Taxable` is a US-company field; a company that refuses it is asked again
 * without it (withTaxable false), so the item still exists.
 */
export function itemCreateBody(key: StudioCueItemKey, incomeAccountId: string, options: { withTaxable: boolean }): Json {
  const item = STUDIOCUE_QUICKBOOKS_ITEMS[key];
  return {
    Name: item.name,
    Type: "Service",
    Description: item.description,
    IncomeAccountRef: { value: incomeAccountId },
    ...(options.withTaxable ? { Taxable: item.taxable } : {}),
  };
}

/**
 * The item a StudioCue invoice line is sold as.
 *
 * Retainer lines, and the "Retainer received" / "Payments received" credits
 * on a final invoice, use the Retainer item: the credit undoes the retainer's
 * income, so the books end with the full package as package income. Every
 * other line — packages, extras, a discount, a one-line balance, a manual tax
 * line — is the package.
 */
export function itemKeyForLine(kind: InvoiceLineKind): StudioCueItemKey {
  return kind === "retainer" || kind === "retainer_received" || kind === "payments_received" ? "retainer" : "package";
}

/** How the connected company does sales tax, in the studio's words. */
export type QuickBooksSalesTaxSetup = "automatic" | "manual" | "off";

export function quickBooksSalesTaxSetup(preferences: unknown): QuickBooksSalesTaxSetup {
  const mode = quickBooksTaxMode(preferences);
  return mode === "automated" ? "automatic" : mode === "manual" ? "manual" : "off";
}

/**
 * The company's one sales tax rate, when it tracks tax by hand with a single
 * rate: a sensible prefill for the proposal estimate. Null for anything else
 * — an automatic company's rate depends on each couple's address.
 */
export function singleTaxRateBasisPoints(setup: QuickBooksSalesTaxSetup, response: unknown): number | null {
  if (setup !== "manual") return null;
  const rates = record(record(response).QueryResponse).TaxRate;
  if (!Array.isArray(rates)) return null;
  const values = new Set(
    rates
      .map(record)
      .filter((rate) => rate.Active !== false)
      .map((rate) => Number(rate.RateValue))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.round(value * 100)),
  );
  if (values.size !== 1) return null;
  const only = [...values][0]!;
  return only > 0 && only <= 2500 ? only : null;
}

export type QuickBooksPaymentsState = "on" | "off" | "unknown";

/**
 * Whether the company can take a card online, as best StudioCue can tell.
 *
 * Only a pay link on a real invoice proves it (the test invoice); the
 * Preferences flag is a hint. Without either, it is "unknown", not "off".
 */
export function quickBooksPaymentsState(input: {
  preferences: unknown;
  lastTest: { payLink: boolean; at: string } | null;
}): { state: QuickBooksPaymentsState; source: "test_invoice" | "preferences" | null } {
  if (input.lastTest) return { state: input.lastTest.payLink ? "on" : "off", source: "test_invoice" };
  const sales = record(record(input.preferences).SalesFormsPrefs);
  if (sales.ETransactionPaymentEnabled === true) return { state: "on", source: "preferences" };
  return { state: "unknown", source: null };
}

export type QuickBooksCompanyStatus = {
  companyName: string | null;
  country: string | null;
  salesTax: QuickBooksSalesTaxSetup;
  /** Prefill for "Estimated rate for proposals", in basis points. */
  suggestedEstimateRateBasisPoints: number | null;
  payments: { state: QuickBooksPaymentsState; source: "test_invoice" | "preferences" | null };
};

export function quickBooksCompanyStatus(input: {
  companyInfo: unknown;
  preferences: unknown;
  taxRates: unknown;
  lastTest: { payLink: boolean; at: string } | null;
}): QuickBooksCompanyStatus {
  const info = record(record(input.companyInfo).CompanyInfo);
  const salesTax = quickBooksSalesTaxSetup(input.preferences);
  return {
    companyName: text(info.CompanyName) || text(info.LegalName) || null,
    country: text(info.Country) || null,
    salesTax,
    suggestedEstimateRateBasisPoints: singleTaxRateBasisPoints(salesTax, input.taxRates),
    payments: quickBooksPaymentsState({ preferences: input.preferences, lastTest: input.lastTest }),
  };
}

// --- the test invoice ------------------------------------------------------

/** Who the test invoice is made out to. Reused every time it is run. */
export const TEST_CUSTOMER_NAME = "StudioCue test (you)";
export const TEST_INVOICE_CENTS = 100;

/** The studio's own address, so Automated Sales Tax has somewhere to work from. */
export function companyBillAddr(companyInfo: unknown): Json | null {
  const info = record(record(companyInfo).CompanyInfo);
  const address = record(info.CompanyAddr);
  if (!text(address.Line1) || !text(address.City)) return null;
  const out: Json = {};
  for (const key of ["Line1", "Line2", "City", "CountrySubDivisionCode", "PostalCode", "Country"]) {
    const value = text(address[key]);
    if (value) out[key] = value;
  }
  return out;
}

export function testCustomerBody(email: string, address: Json | null): Json {
  return {
    DisplayName: TEST_CUSTOMER_NAME,
    GivenName: "StudioCue",
    FamilyName: "Test",
    ...(email ? { PrimaryEmailAddr: { Address: email } } : {}),
    ...(address ? { BillAddr: address } : {}),
    Notes: "Made by StudioCue's \"Send a test invoice\". Its invoices are voided right away.",
  };
}

/**
 * The $1.00 test invoice. Online payment is asked for, as on every real
 * invoice, so a pay link proves QuickBooks Payments. With StudioCue's sales
 * tax on QuickBooks and an automatic company, the line is marked TAX with no
 * override, so QuickBooks works the tax out itself — the thing being tested.
 * An older manual-tax company is taxed the way its real finals are: TAX on
 * the line under the company's own code (`companyTaxCode`, chosen by
 * chooseQuickBooksTaxStrategy). Nothing is emailed: StudioCue never asks QuickBooks to send it.
 */
export function testInvoiceBody(input: {
  customerId: string;
  itemRef: { value: string; name?: string };
  salesTax: SalesTaxMode;
  companySalesTax: QuickBooksSalesTaxSetup;
  /** A manual-tax company's code, when its finals would be taxed with it. */
  companyTaxCode?: string | null;
  today: string;
  withOnlinePayment: boolean;
  /** The studio's own email: a pay link needs one on the invoice. */
  email?: string | null;
}): Json {
  const taxed =
    input.salesTax === "quickbooks" &&
    (input.companySalesTax === "automatic" || (input.companySalesTax === "manual" && Boolean(input.companyTaxCode)));
  const taxCode = input.companySalesTax === "off" ? {} : { TaxCodeRef: { value: taxed ? "TAX" : "NON" } };
  return {
    CustomerRef: { value: input.customerId },
    TxnDate: input.today,
    DueDate: input.today,
    PrivateNote: "StudioCue test invoice — voided automatically",
    ...quickBooksBillEmail(input.email),
    CustomerMemo: { value: "A test from StudioCue. Nothing to pay; it has already been voided." },
    ...(input.withOnlinePayment ? { AllowOnlineCreditCardPayment: true, AllowOnlineACHPayment: true } : {}),
    ...(taxed && input.companySalesTax === "manual" ? { TxnTaxDetail: { TxnTaxCodeRef: { value: input.companyTaxCode } } } : {}),
    Line: [
      {
        Amount: TEST_INVOICE_CENTS / 100,
        DetailType: "SalesItemLineDetail",
        Description: "StudioCue test — voided automatically",
        SalesItemLineDetail: { ItemRef: input.itemRef, Qty: 1, UnitPrice: TEST_INVOICE_CENTS / 100, ...taxCode },
      },
    ],
  };
}

export type TestCheckKey = "customer" | "invoice" | "tax" | "pay_link" | "void";

export type TestCheck = {
  key: TestCheckKey;
  label: string;
  /** null: not checked (doesn't apply, or an earlier step failed). */
  ok: boolean | null;
  detail: string;
};

export type TestInvoiceResult = {
  passed: boolean;
  at: string;
  mock: boolean;
  invoiceId: string | null;
  docNumber: string | null;
  checks: TestCheck[];
};

export type TestInvoiceOutcome = {
  customer: { ok: boolean; created?: boolean; error?: string };
  invoice: { ok: boolean; id?: string | null; docNumber?: string | null; totalCents?: number | null; taxCents?: number | null; error?: string } | null;
  payLink: string | null;
  void: { ok: boolean; error?: string } | null;
  salesTax: SalesTaxMode;
  companySalesTax: QuickBooksSalesTaxSetup;
  /** Manual-tax company: the rate its invoices use, when it has one. */
  companyTaxCode?: { id: string; name: string | null } | null;
};

const dollars = (amountCents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amountCents / 100);

/**
 * Pass or fail, check by check, in words the studio can act on. The test
 * passes when every check that applies passed; a check that doesn't apply
 * (tax with sales tax off) never fails it.
 */
export function testInvoiceChecks(outcome: TestInvoiceOutcome, at: string, mock = false): TestInvoiceResult {
  const checks: TestCheck[] = [];
  checks.push({
    key: "customer",
    label: "Customer",
    ok: outcome.customer.ok,
    detail: outcome.customer.ok
      ? `${outcome.customer.created ? "Made" : "Found"} "${TEST_CUSTOMER_NAME}" in QuickBooks.`
      : `QuickBooks wouldn't make the test customer: ${outcome.customer.error ?? "no reason given"}.`,
  });
  const invoice = outcome.invoice;
  checks.push({
    key: "invoice",
    label: "Invoice",
    ok: invoice ? invoice.ok : null,
    detail: !invoice
      ? "Not tried — the customer step failed."
      : invoice.ok
        ? `Made a ${dollars(TEST_INVOICE_CENTS)} invoice${invoice.docNumber ? ` (no. ${invoice.docNumber})` : ""}. Nothing was emailed.`
        : `QuickBooks refused the invoice: ${invoice.error ?? "no reason given"}.`,
  });
  const taxApplies = outcome.salesTax === "quickbooks";
  const taxCents = invoice?.taxCents ?? null;
  const manualCode = outcome.companySalesTax === "manual" ? (outcome.companyTaxCode ?? null) : null;
  const taxable = outcome.companySalesTax === "automatic" || manualCode !== null;
  checks.push({
    key: "tax",
    label: "Sales tax",
    ok: !taxApplies || !invoice?.ok ? null : taxable && taxCents !== null && taxCents > 0,
    detail: !taxApplies
      ? "Not checked — you've chosen not to add sales tax."
      : !invoice?.ok
        ? "Not checked — there was no invoice."
        : outcome.companySalesTax === "manual" && !manualCode
          ? "Your QuickBooks sets sales tax by hand and has no default rate to charge. Set a default sales tax rate in QuickBooks (Taxes → Sales tax), or choose \"Don't add sales tax\"."
          : !taxable
            ? "QuickBooks doesn't calculate sales tax automatically for your company. Turn on Automated Sales Tax in QuickBooks (Taxes → Sales tax), or choose \"Don't add sales tax\"."
            : taxCents === null || taxCents <= 0
              ? "QuickBooks didn't add any sales tax to the invoice."
              : manualCode
                ? `QuickBooks charged ${dollars(taxCents)} tax on ${dollars(TEST_INVOICE_CENTS)} at your ${manualCode.name ? `"${manualCode.name}"` : "default"} rate. Every couple pays that rate; turn on Automated Sales Tax in QuickBooks to charge by their address instead.`
                : `QuickBooks calculated ${dollars(taxCents)} tax on ${dollars(TEST_INVOICE_CENTS)} at your own address.`,
  });
  checks.push({
    key: "pay_link",
    label: "Pay online link",
    ok: invoice?.ok ? outcome.payLink !== null : null,
    detail: !invoice?.ok
      ? "Not checked — there was no invoice."
      : outcome.payLink
        ? "QuickBooks gave the invoice a pay-online link, so couples can pay by card or bank."
        : "QuickBooks gave no pay-online link. QuickBooks Payments may not be set up on your company yet.",
  });
  checks.push({
    key: "void",
    label: "Void",
    ok: outcome.void ? outcome.void.ok : null,
    detail: !outcome.void
      ? "Not needed — no invoice was made."
      : outcome.void.ok
        ? "Voided the test invoice in QuickBooks."
        : `The test invoice couldn't be voided: ${outcome.void.error ?? "no reason given"}. Void it yourself in QuickBooks.`,
  });
  return {
    passed: checks.every((check) => check.ok !== false),
    at,
    mock,
    invoiceId: invoice?.id ?? null,
    docNumber: invoice?.docNumber ?? null,
    checks,
  };
}

/** Mock mode: the same checks, all passing, nothing contacted. */
export function mockTestInvoiceResult(at: string, salesTax: SalesTaxMode): TestInvoiceResult {
  return testInvoiceChecks(
    {
      customer: { ok: true, created: false },
      invoice: { ok: true, id: "mock_qbo_test_invoice", docNumber: "TEST-1", totalCents: 108, taxCents: 8 },
      payLink: "https://invoice.example.test/mock_qbo_test_invoice",
      void: { ok: true },
      salesTax,
      companySalesTax: "automatic",
    },
    at,
    true,
  );
}

/** A provider error, without its code prefix, short enough to show. */
export function providerErrorDetail(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught);
  const parts = message.split(":");
  const detail = parts.length >= 3 ? parts.slice(2).join(":").trim() : message;
  return detail.slice(0, 240) || "no reason given";
}
