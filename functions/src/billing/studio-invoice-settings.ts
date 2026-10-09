/**
 * The functions copy of features/billing/studio-invoice-settings.ts.
 *
 * functions/ is a separate package with no "@/features" path, so the rules
 * are duplicated here. Everything below the marker must match the features
 * copy exactly; tests/studio-invoice-settings.test.ts fails on a drift.
 */

// --- shared with functions/src/billing/studio-invoice-settings.ts ---
export type StudioInvoiceSettings = {
  /** The name printed at the top. Null: the studio's own name. */
  businessName: string | null;
  /** Postal address, as lines. */
  businessAddress: string | null;
  businessEmail: string | null;
  businessPhone: string | null;
  /** How the client pays: "Zelle to …", "Checks payable to …". */
  paymentInstructions: string | null;
  /** The studio's own pay link (Square, PayPal, a Stripe Payment Link). https only. */
  payLinkUrl: string | null;
  /** Days from the invoice date to its due date, when nothing else sets one. */
  dueDays: number;
  /** Sales tax on invoices the studio issues. Null rate: no tax. */
  tax: { rateBasisPoints: number | null; label: string | null };
  /** A line at the bottom: thanks, a late-fee note, a tax id. */
  footer: string | null;
};

export const STUDIO_INVOICE_DEFAULT_DUE_DAYS = 14;
export const STUDIO_INVOICE_MAX_DUE_DAYS = 120;
export const STUDIO_INVOICE_MAX_TAX_BASIS_POINTS = 2500;
export const STUDIO_INVOICE_TEXT_LIMITS = {
  businessName: 120,
  businessAddress: 400,
  businessEmail: 200,
  businessPhone: 40,
  paymentInstructions: 1000,
  payLinkUrl: 500,
  taxLabel: 40,
  footer: 500,
} as const;

/** Quick picks offered beside the payment instructions box, as starter text. */
export const PAYMENT_INSTRUCTION_PICKS = [
  { id: "zelle", label: "Zelle", text: "Zelle to " },
  { id: "venmo", label: "Venmo", text: "Venmo @" },
  { id: "check", label: "Check", text: "Checks payable to " },
  { id: "bank_transfer", label: "Bank transfer", text: "Bank transfer — account details on request" },
  { id: "cash", label: "Cash", text: "Cash at your session" },
] as const;

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function text(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\r\n/g, "\n").trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

/** An https address, or null. Anything else is refused at save and dropped at read. */
export function normalisePayLink(value: unknown): string | null {
  const raw = text(value, STUDIO_INVOICE_TEXT_LIMITS.payLinkUrl);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Whole days in 0–120, or the default. */
export function normaliseDueDays(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number)) {
    return STUDIO_INVOICE_DEFAULT_DUE_DAYS;
  }
  return Math.min(STUDIO_INVOICE_MAX_DUE_DAYS, Math.max(0, Math.round(number)));
}

/** A whole number of basis points in 0–25%, or null (no tax). Zero is no tax. */
export function normaliseTaxRate(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const rounded = Math.round(number);
  return rounded > STUDIO_INVOICE_MAX_TAX_BASIS_POINTS ? null : rounded;
}

export function defaultStudioInvoiceSettings(): StudioInvoiceSettings {
  return {
    businessName: null,
    businessAddress: null,
    businessEmail: null,
    businessPhone: null,
    paymentInstructions: null,
    payLinkUrl: null,
    dueDays: STUDIO_INVOICE_DEFAULT_DUE_DAYS,
    tax: { rateBasisPoints: null, label: null },
    footer: null,
  };
}

/**
 * The `studioInvoices` part of a billingSettings document (pass the whole
 * document), as the exact shape. Unknown fields are dropped and anything
 * malformed falls back to its default.
 */
export function normaliseStudioInvoiceSettings(billingSettings: unknown): StudioInvoiceSettings {
  const raw = record(record(billingSettings).studioInvoices);
  const tax = record(raw.tax);
  const limits = STUDIO_INVOICE_TEXT_LIMITS;
  const rateBasisPoints = normaliseTaxRate(tax.rateBasisPoints);
  return {
    businessName: text(raw.businessName, limits.businessName),
    businessAddress: text(raw.businessAddress, limits.businessAddress),
    businessEmail: text(raw.businessEmail, limits.businessEmail),
    businessPhone: text(raw.businessPhone, limits.businessPhone),
    paymentInstructions: text(raw.paymentInstructions, limits.paymentInstructions),
    payLinkUrl: normalisePayLink(raw.payLinkUrl),
    dueDays: normaliseDueDays(raw.dueDays),
    tax: {
      rateBasisPoints,
      label: rateBasisPoints === null ? null : (text(tax.label, limits.taxLabel) ?? "Sales tax"),
    },
    footer: text(raw.footer, limits.footer),
  };
}

/** Tax on a subtotal at the studio's own rate, rounded to the cent. Zero with no rate. */
export function studioInvoiceTaxCents(subtotalCents: number, settings: Pick<StudioInvoiceSettings, "tax">): number {
  const rate = settings.tax.rateBasisPoints;
  if (rate === null) return 0;
  const subtotal = Number.isFinite(subtotalCents) ? Math.max(0, Math.round(subtotalCents)) : 0;
  return Math.round((subtotal * rate) / 10000);
}

/** The client can be told how to pay: instructions, or a pay link. */
export function studioInvoicePaymentReady(settings: Pick<StudioInvoiceSettings, "paymentInstructions" | "payLinkUrl">): boolean {
  return settings.paymentInstructions !== null || settings.payLinkUrl !== null;
}
