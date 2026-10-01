/**
 * The functions copy of features/billing/sales-tax-settings.ts.
 *
 * functions/ is a separate package with no "@/features" path, so the rules
 * are duplicated here. Everything below the marker must match the features
 * copy exactly; tests/billing-settings.test.ts fails on a drift.
 */

// --- shared with functions/src/billing/sales-tax-settings.ts ---
export type SalesTaxMode = "quickbooks" | "none";

export type BillingSettings = {
  tenantId: string;
  salesTax: {
    mode: SalesTaxMode;
    /** Estimate for proposals only, in basis points (8.25% = 825). Null: none set. */
    estimateRateBasisPoints: number | null;
  };
  /** Retainer invoices wait for the studio's review before they go. */
  holdRetainerForReview: boolean;
  /** The StudioCue items in the studio's QuickBooks, once set up. */
  quickbooksItems: {
    retainerItemId: string | null;
    packageItemId: string | null;
  };
  updatedAt: string | null;
  updatedBy: string | null;
};

/** What a settings read can say about the connected QuickBooks company. */
export type BillingSettingsHint = {
  /** The connected QuickBooks company has sales tax switched on. */
  quickBooksSalesTax?: boolean;
};

export const MAX_ESTIMATE_RATE_BASIS_POINTS = 2500;

const settingsRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const settingsText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** A whole number of basis points in 0–25%, or null. */
export function normaliseEstimateRate(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  const rounded = Math.round(number);
  return rounded > MAX_ESTIMATE_RATE_BASIS_POINTS ? null : rounded;
}

/**
 * Settings for a studio that has saved none: no sales tax, unless the
 * connected QuickBooks company already charges it, in which case QuickBooks
 * is suggested as the authority.
 */
export function defaultBillingSettings(tenantId: string, hint: BillingSettingsHint = {}): BillingSettings {
  return {
    tenantId,
    salesTax: { mode: hint.quickBooksSalesTax === true ? "quickbooks" : "none", estimateRateBasisPoints: null },
    holdRetainerForReview: false,
    quickbooksItems: { retainerItemId: null, packageItemId: null },
    updatedAt: null,
    updatedBy: null,
  };
}

/**
 * Any stored (or missing) document, as the exact shape. Unknown fields are
 * dropped; anything malformed falls back to its default. The mode falls back
 * to the default (and its hint) only when none was ever saved.
 */
export function normaliseBillingSettings(
  raw: unknown,
  tenantId: string,
  hint: BillingSettingsHint = {},
): BillingSettings {
  const record = settingsRecord(raw);
  const fallback = defaultBillingSettings(settingsText(record.tenantId) ?? tenantId, hint);
  const salesTax = settingsRecord(record.salesTax);
  const items = settingsRecord(record.quickbooksItems);
  const mode: SalesTaxMode =
    salesTax.mode === "quickbooks" || salesTax.mode === "none" ? salesTax.mode : fallback.salesTax.mode;
  return {
    tenantId: fallback.tenantId,
    salesTax: { mode, estimateRateBasisPoints: normaliseEstimateRate(salesTax.estimateRateBasisPoints) },
    holdRetainerForReview: record.holdRetainerForReview === true,
    quickbooksItems: {
      retainerItemId: settingsText(items.retainerItemId),
      packageItemId: settingsText(items.packageItemId),
    },
    updatedAt: settingsText(record.updatedAt),
    updatedBy: settingsText(record.updatedBy),
  };
}

/** Sales tax is charged on this job: QuickBooks is the authority and the job isn't exempt. */
export function salesTaxApplies(
  settings: Pick<BillingSettings, "salesTax">,
  project: { salesTaxExempt?: unknown } | null | undefined,
): boolean {
  return settings.salesTax.mode === "quickbooks" && project?.salesTaxExempt !== true;
}

/**
 * The estimate a proposal can show: the subtotal at the studio's estimated
 * rate. Zero when StudioCue adds no sales tax or no rate is set. Never the
 * figure billed — QuickBooks works that out on the final invoice.
 */
export function estimatedSalesTaxCents(
  subtotalCents: number,
  settings: Pick<BillingSettings, "salesTax">,
): number {
  const rate = settings.salesTax.estimateRateBasisPoints;
  if (settings.salesTax.mode !== "quickbooks" || rate === null) return 0;
  const subtotal = Number.isFinite(subtotalCents) ? Math.max(0, Math.round(subtotalCents)) : 0;
  return Math.round((subtotal * rate) / 10000);
}

/** "8.25" (percent, as typed) to 825 basis points; null for blank or out of range. */
export function percentToBasisPoints(input: string): number | null {
  const cleaned = input.replace(/%/g, "").trim();
  if (!cleaned) return null;
  if (!/^\d{1,2}(\.\d{1,4})?$/.test(cleaned)) return null;
  return normaliseEstimateRate(Number(cleaned) * 100);
}

/** 825 basis points to "8.25" for a field. */
export function basisPointsToPercent(basisPoints: number | null): string {
  if (basisPoints === null) return "";
  return String(Math.round(basisPoints) / 100);
}
