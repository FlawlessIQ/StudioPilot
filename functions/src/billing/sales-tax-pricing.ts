/**
 * The functions copy of features/billing/sales-tax-pricing.ts: whether a job's
 * price is pre-tax "plus sales tax" (QuickBooks works the tax out on the final
 * invoice), the decision a snapshot records, and the words every document
 * uses for it. functions/ has no "@/features" path, so everything below the
 * marker must match the features copy exactly; tests/sales-tax-wording.test.ts
 * fails on a drift.
 */
import { normaliseBillingSettings, salesTaxApplies } from "./sales-tax-settings.js";
import type { PricedSalesTax, SalesTaxTreatment } from "../pricing/package-price.js";

// ── mirrored below ──

/** `tenantFeatures/{tenantId}` field that switches a studio on. */
export const QUICKBOOKS_SALES_TAX_FEATURE = "quickbooksItemisedInvoices";

const plainRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * How a job is priced now: null for the old way (the package's tax rate in
 * the total), or the QuickBooks treatment. Pass the two documents' data as
 * read (undefined when missing).
 */
export function salesTaxTreatment(input: {
  tenantId: string;
  billingSettings: unknown;
  tenantFeatures: unknown;
  project: { salesTaxExempt?: unknown } | null | undefined;
}): SalesTaxTreatment | null {
  const settings = normaliseBillingSettings(input.billingSettings, input.tenantId);
  if (settings.salesTax.mode !== "quickbooks") return null;
  if (plainRecord(input.tenantFeatures)[QUICKBOOKS_SALES_TAX_FEATURE] !== true) return null;
  const exempt = !salesTaxApplies(settings, input.project);
  return { exempt, rateBasisPoints: exempt ? null : settings.salesTax.estimateRateBasisPoints };
}

/** A stored decision (a snapshot's or a proposal's `salesTax`), or null. */
export function readPricedSalesTax(value: unknown): PricedSalesTax | null {
  const record = plainRecord(value);
  if (record.mode !== "quickbooks") return null;
  const exempt = record.exempt === true;
  const estimate = Number(record.estimatedCents);
  const rate = record.rateBasisPoints;
  return {
    mode: "quickbooks",
    exempt,
    estimatedCents: exempt || !Number.isFinite(estimate) ? 0 : Math.max(0, Math.round(estimate)),
    rateBasisPoints:
      exempt || typeof rate !== "number" || !Number.isFinite(rate) ? null : Math.max(0, Math.round(rate)),
  };
}

/** The treatment a stored decision was priced with, to price it again the same way. */
export function treatmentOf(salesTax: PricedSalesTax | null): SalesTaxTreatment | null {
  return salesTax ? { exempt: salesTax.exempt, rateBasisPoints: salesTax.rateBasisPoints } : null;
}

/**
 * Several packages' decisions as one proposal's: the estimates added up.
 * Null when none was priced this way. Exempt only when every one is.
 */
export function combinePricedSalesTax(
  entries: ReadonlyArray<PricedSalesTax | null | undefined>,
): PricedSalesTax | null {
  const decided = entries.filter((entry): entry is PricedSalesTax => Boolean(entry));
  if (!decided.length) return null;
  const taxed = decided.filter((entry) => !entry.exempt);
  if (!taxed.length) return { mode: "quickbooks", exempt: true, estimatedCents: 0, rateBasisPoints: null };
  return {
    mode: "quickbooks",
    exempt: false,
    estimatedCents: taxed.reduce((sum, entry) => sum + entry.estimatedCents, 0),
    rateBasisPoints: taxed.find((entry) => entry.rateBasisPoints !== null)?.rateBasisPoints ?? null,
  };
}

// The words. One copy, so every page, the PDF and the agreement say the same.

export const SALES_TAX_ESTIMATE_LABEL = "Estimated sales tax (on final invoice)";
export const NO_SALES_TAX_NOTE = "No sales tax on this booking.";

/** 825 → "8.25%"; 600 → "6%". */
export function salesTaxRateText(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

/** An estimate in whole currency units: "$583". */
export function salesTaxEstimateMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "USD").toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(cents) / 100);
}

/**
 * What follows a total: "plus sales tax (about $583 at 6.63%, worked out on
 * your final invoice)", or without a rate "plus sales tax, worked out on your
 * final invoice". Empty when no tax is added later.
 */
export function plusSalesTaxPhrase(salesTax: PricedSalesTax | null, currency: string): string {
  if (!salesTax || salesTax.exempt) return "";
  if (salesTax.rateBasisPoints === null) return "plus sales tax, worked out on your final invoice";
  return `plus sales tax (about ${salesTaxEstimateMoney(salesTax.estimatedCents, currency)} at ${salesTaxRateText(
    salesTax.rateBasisPoints,
  )}, worked out on your final invoice)`;
}

/** A total as it is agreed: "$8,798.00 plus sales tax (about …)". Unchanged for a job priced the old way. */
export function totalWithSalesTax(totalText: string, salesTax: PricedSalesTax | null, currency: string): string {
  if (!salesTax) return totalText;
  if (salesTax.exempt) return `${totalText} (no sales tax on this booking)`;
  return `${totalText} ${plusSalesTaxPhrase(salesTax, currency)}`;
}

/** A balance or a final payment: "$4,399.00 plus sales tax". */
export function balanceWithSalesTax(amountText: string, salesTax: PricedSalesTax | null): string {
  return salesTax && !salesTax.exempt ? `${amountText} plus sales tax` : amountText;
}

/** The value beside SALES_TAX_ESTIMATE_LABEL: "about $583", or no rate set. Null: no such row. */
export function salesTaxEstimateText(salesTax: PricedSalesTax | null, currency: string): string | null {
  if (!salesTax || salesTax.exempt) return null;
  return salesTax.rateBasisPoints === null
    ? "On your final invoice"
    : `about ${salesTaxEstimateMoney(salesTax.estimatedCents, currency)}`;
}

/** One sentence under a total. Null for a job priced the old way. */
export function salesTaxSentence(salesTax: PricedSalesTax | null, currency: string): string | null {
  if (!salesTax) return null;
  if (salesTax.exempt) return NO_SALES_TAX_NOTE;
  if (salesTax.rateBasisPoints === null) return "Plus sales tax, worked out on your final invoice.";
  return `Plus sales tax: about ${salesTaxEstimateMoney(salesTax.estimatedCents, currency)} at ${salesTaxRateText(
    salesTax.rateBasisPoints,
  )}, worked out on your final invoice. It isn't included in the total.`;
}
