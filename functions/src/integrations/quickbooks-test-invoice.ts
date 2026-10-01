import {
  STUDIOCUE_QUICKBOOKS_ITEMS,
  TEST_CUSTOMER_NAME,
  companyBillAddr,
  customerByNameQuery,
  providerErrorDetail,
  quickBooksCompanyStatus,
  testCustomerBody,
  testInvoiceBody,
  testInvoiceChecks,
  type StudioCueItemIds,
  type TestInvoiceOutcome,
  type TestInvoiceResult,
} from "./quickbooks-setup-core.js";
import { ensureStudioCueItems, verifiedStoredItemIds, type QuickBooksCompany } from "./quickbooks-items.js";
import type { SalesTaxMode } from "../billing/sales-tax-settings.js";
import { quickBooksTaxMode } from "../operations/quickbooks-invoice-lines.js";
import {
  chooseQuickBooksTaxStrategy,
  quickBooksDefaultTaxCode,
  quickBooksSalesTaxCodes,
} from "../operations/quickbooks-final-tax.js";

/**
 * The "Send a test invoice" run against one QuickBooks company: no Firestore,
 * so quickbooksSetupCommand and the sandbox walk
 * (scripts/uat/quickbooks-sandbox-walk.mts) run exactly the same steps.
 *
 *   customer  "StudioCue test (you)", found by name or made, at the studio's
 *             own address (so Automated Sales Tax has an address to use)
 *   invoice   $1.00 of the Photography package item, online payment on
 *   tax       what QuickBooks calculated, when the studio adds sales tax
 *   pay link  read back with include=invoiceLink — proves QuickBooks Payments
 *   void      straight away; nothing is ever emailed
 */

const optional = async <T>(work: () => Promise<T>): Promise<T | null> => {
  try {
    return await work();
  } catch {
    return null;
  }
};

/** CompanyInfo (required) and Preferences (best effort). */
export async function readQuickBooksCompany(company: QuickBooksCompany, realmId: string) {
  const companyInfo = await company.get(`companyinfo/${encodeURIComponent(realmId)}`, "QUICKBOOKS_COMPANY_READ_FAILED");
  const preferences = (await optional(() => company.get("preferences", "QUICKBOOKS_PREFERENCES_FAILED")))?.Preferences ?? null;
  return { companyInfo, preferences };
}

export async function runQuickBooksTestInvoice(input: {
  company: QuickBooksCompany;
  realmId: string;
  salesTax: SalesTaxMode;
  storedItems: StudioCueItemIds;
  email: string;
  idempotencyKey: string;
  now?: string;
}): Promise<{ result: TestInvoiceResult; items: StudioCueItemIds; itemsChanged: boolean }> {
  const { company, idempotencyKey } = input;
  const at = input.now ?? new Date().toISOString();
  const { companyInfo, preferences } = await readQuickBooksCompany(company, input.realmId);
  const companySalesTax = quickBooksCompanyStatus({ companyInfo, preferences, taxRates: null, lastTest: null }).salesTax;
  // A manual-tax company: the code its real finals would carry, chosen the same way.
  let companyTaxCode: { id: string; name: string | null } | null = null;
  if (input.salesTax === "quickbooks" && companySalesTax === "manual") {
    const codes = await optional(async () =>
      quickBooksSalesTaxCodes(await company.query("select * from TaxCode", "QUICKBOOKS_TAXCODE_READ_FAILED")),
    );
    const strategy = chooseQuickBooksTaxStrategy({
      taxApplies: true,
      companyMode: quickBooksTaxMode(preferences),
      defaultTaxCode: quickBooksDefaultTaxCode(preferences),
      salesTaxCodes: codes ?? [],
      estimateRateBasisPoints: null,
    });
    if (strategy.kind === "company_code")
      companyTaxCode = {
        id: strategy.taxCodeId,
        // Preferences name the default code by id only; the code list has its name.
        name: strategy.taxCodeName ?? codes?.find((code) => code.id === strategy.taxCodeId)?.name ?? null,
      };
  }

  // The package item: the line is the taxable service a real final bills.
  let items = await optional(() => verifiedStoredItemIds(company, input.storedItems));
  const itemsChanged = !items;
  if (!items) items = (await ensureStudioCueItems(company, `${idempotencyKey}-items`)).ids;

  const outcome: TestInvoiceOutcome = {
    customer: { ok: false },
    invoice: null,
    payLink: null,
    void: null,
    salesTax: input.salesTax,
    companySalesTax,
    companyTaxCode,
  };

  let customerId = "";
  try {
    const found = await company.query(customerByNameQuery(TEST_CUSTOMER_NAME), "QUICKBOOKS_CUSTOMER_SEARCH_FAILED");
    const list = (found.QueryResponse as { Customer?: Array<{ Id?: unknown }> } | undefined)?.Customer;
    customerId = Array.isArray(list) && typeof list[0]?.Id === "string" ? list[0].Id : "";
    if (customerId) outcome.customer = { ok: true, created: false };
    else {
      const created = await company.post(
        "customer",
        testCustomerBody(input.email, companyBillAddr(companyInfo)),
        "QUICKBOOKS_CUSTOMER_CREATE_FAILED",
        `${idempotencyKey}-customer`,
      );
      customerId = String((created.Customer as { Id?: unknown } | undefined)?.Id ?? "");
      outcome.customer = customerId ? { ok: true, created: true } : { ok: false, error: "no customer id came back" };
    }
  } catch (caught: unknown) {
    outcome.customer = { ok: false, error: providerErrorDetail(caught) };
  }

  if (outcome.customer.ok) {
    const packageItem = { value: items.packageItemId!, name: STUDIOCUE_QUICKBOOKS_ITEMS.package.name };
    const body = (withOnlinePayment: boolean) =>
      testInvoiceBody({
        customerId,
        itemRef: packageItem,
        salesTax: input.salesTax,
        companySalesTax,
        companyTaxCode: companyTaxCode?.id ?? null,
        today: at.slice(0, 10),
        withOnlinePayment,
        email: input.email,
      });
    let invoiceId = "";
    let syncToken = "0";
    try {
      // A 400 created nothing, so asking again without online payment
      // cannot make a second invoice.
      const created = await company
        .post("invoice", body(true), "QUICKBOOKS_CREATE_FAILED", `${idempotencyKey}-test`)
        .catch((caught: unknown) => {
          if (/^QUICKBOOKS_CREATE_FAILED:400:/.test(caught instanceof Error ? caught.message : ""))
            return company.post("invoice", body(false), "QUICKBOOKS_CREATE_FAILED", `${idempotencyKey}-test-offline`);
          throw caught;
        });
      const invoice = (created.Invoice ?? {}) as Record<string, unknown>;
      invoiceId = String(invoice.Id ?? "");
      syncToken = String(invoice.SyncToken ?? "0");
      const taxDetail = invoice.TxnTaxDetail as { TotalTax?: unknown } | undefined;
      const tax = Number(taxDetail?.TotalTax);
      const total = Number(invoice.TotalAmt);
      outcome.invoice = invoiceId
        ? {
            ok: true,
            id: invoiceId,
            docNumber: typeof invoice.DocNumber === "string" ? invoice.DocNumber : null,
            totalCents: Number.isFinite(total) ? Math.round(total * 100) : null,
            taxCents: taxDetail?.TotalTax !== undefined && Number.isFinite(tax) ? Math.round(tax * 100) : null,
          }
        : { ok: false, error: "no invoice id came back" };
    } catch (caught: unknown) {
      outcome.invoice = { ok: false, error: providerErrorDetail(caught) };
    }
    if (invoiceId) {
      const read = await optional(() =>
        company.get(`invoice/${encodeURIComponent(invoiceId)}?include=invoiceLink`, "QUICKBOOKS_INVOICE_LINK_FAILED"),
      );
      const current = (read?.Invoice ?? {}) as Record<string, unknown>;
      outcome.payLink = typeof current.InvoiceLink === "string" && current.InvoiceLink ? current.InvoiceLink : null;
      if (current.SyncToken !== undefined) syncToken = String(current.SyncToken);
      try {
        await company.post("invoice?operation=void", { Id: invoiceId, SyncToken: syncToken }, "QUICKBOOKS_VOID_FAILED", `${idempotencyKey}-void`);
        outcome.void = { ok: true };
      } catch (caught: unknown) {
        outcome.void = { ok: false, error: providerErrorDetail(caught) };
      }
    }
  }
  return { result: testInvoiceChecks(outcome, at, false), items, itemsChanged };
}
