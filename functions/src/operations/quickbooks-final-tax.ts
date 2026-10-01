import {
  qbDollars,
  quickBooksAmountCheck,
  quickBooksFinalLines,
  type FinalLinesResult,
  type InvoiceLine,
  type JobPackageItem,
  type QuickBooksTaxMode,
} from "./quickbooks-invoice-lines.js";

/**
 * QuickBooks as the sales-tax authority (owner decision, 2026-10-01).
 *
 * For a studio switched on to itemised invoices
 * (`tenantFeatures/{tenantId}.quickbooksItemisedInvoices`), StudioCue no
 * longer tells QuickBooks what the tax is. It sends every package and extra
 * at its pre-tax price, marked taxable, and lets QuickBooks' Automated Sales
 * Tax work the tax out from the couple's billing address. What QuickBooks
 * computed is read back and becomes the bill; the studio confirms it before
 * anything reaches the couple ("Send with tax" / "Send without tax" / "Edit").
 *
 *   Final invoice:  packages (pre-tax, taxable) − discount
 *                   − retainer received (non-taxable) − other payments
 *                   + tax QuickBooks computes
 *   Retainer:       never taxed
 *
 * Everything here is pure; the worker that calls QuickBooks is
 * quickbooks-held-invoice.ts. tests/quickbooks-final-tax.test.ts pins it.
 */

/** How the tax on one invoice is worked out. */
export type QuickBooksTaxStrategy =
  /** No sales tax on this invoice: every line non-taxable, nothing computed. */
  | { kind: "none" }
  /** US company on Automated Sales Tax: QuickBooks computes from the address. */
  | { kind: "automated" }
  /** Older (manual) US sales tax: the company's one default tax code. */
  | { kind: "company_code"; taxCodeId: string; taxCodeName: string | null }
  /**
   * QuickBooks cannot work it out (manual tax with no single default code,
   * or sales tax off in QuickBooks): the studio's estimate rate as an
   * explicit "Sales tax" line, said so on the review.
   */
  | { kind: "estimate"; rateBasisPoints: number; reason: NoQuickBooksTaxReason }
  /** The studio charges tax, but neither QuickBooks nor an estimate rate can give a figure. */
  | { kind: "unavailable"; reason: NoQuickBooksTaxReason };

/** Why QuickBooks could not work the tax out itself. */
export type NoQuickBooksTaxReason =
  /** Manual (older) US sales tax with no single default code. */
  | "no_default_code"
  /** Sales tax off in QuickBooks, a non-US company, or Preferences unreadable. */
  | "no_sales_tax_in_quickbooks"
  /** QuickBooks refused the invoice with tax codes on it (the 400 retry). */
  | "tax_codes_refused";

export type QuickBooksTaxCode = { id: string; name: string | null };

/** Why an invoice is held for the studio before it goes. */
export type HoldReason = "final_tax" | "retainer";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const cents = (value: unknown): number => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number) : 0;
};
const dollarsToCents = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
};
const sum = (lines: readonly { amountCents: number }[]) => lines.reduce((total, line) => total + line.amountCents, 0);

/**
 * Held for the studio, or sent as before.
 *
 * Every final invoice of a switched-on studio waits for "Send with tax" /
 * "Send without tax": QuickBooks' tax is a figure nobody has seen until it
 * exists. A retainer waits only when the studio asked (billingSettings
 * .holdRetainerForReview).
 */
export function quickBooksHoldReason(input: {
  kind: unknown;
  gated: boolean;
  holdRetainerForReview: boolean;
}): HoldReason | null {
  if (!input.gated) return null;
  if (input.kind === "final") return "final_tax";
  if (input.kind === "retainer" && input.holdRetainerForReview) return "retainer";
  return null;
}

/** The company's default sales tax code (Preferences → TaxPrefs.TaxGroupCodeRef), if it names one. */
export function quickBooksDefaultTaxCode(preferences: unknown): QuickBooksTaxCode | null {
  const ref = record(record(record(preferences).TaxPrefs).TaxGroupCodeRef);
  const id = text(ref.value);
  return id ? { id, name: text(ref.name) || null } : null;
}

/**
 * The company's sales tax codes that actually charge tax: active, taxable,
 * with a sales rate behind them. TAX/NON are pseudo-codes and never listed.
 */
export function quickBooksSalesTaxCodes(queryResponse: unknown): QuickBooksTaxCode[] {
  const codes = record(record(queryResponse).QueryResponse).TaxCode;
  if (!Array.isArray(codes)) return [];
  return codes
    .map(record)
    .filter((code) => {
      if (code.Active === false || code.Taxable === false) return false;
      const rates = record(code.SalesTaxRateList).TaxRateDetail;
      return Array.isArray(rates) && rates.length > 0;
    })
    .map((code) => ({ id: text(code.Id), name: text(code.Name) || null }))
    .filter((code) => code.id && code.id !== "TAX" && code.id !== "NON");
}

/**
 * How this invoice's tax is worked out.
 *
 *   not taxed (retainer, exempt job, studio tax off) → none
 *   Automated Sales Tax                              → automated
 *   manual US tax: default code, else the only code  → company_code
 *   otherwise: the studio's estimate rate            → estimate
 *   and with no estimate rate either                 → unavailable (no tax, said so)
 */
export function chooseQuickBooksTaxStrategy(input: {
  taxApplies: boolean;
  companyMode: QuickBooksTaxMode;
  defaultTaxCode: QuickBooksTaxCode | null;
  salesTaxCodes: readonly QuickBooksTaxCode[];
  estimateRateBasisPoints: number | null;
  /** Set on the 400 retry, when QuickBooks refused the tax codes. */
  codesRefused?: boolean;
}): QuickBooksTaxStrategy {
  if (!input.taxApplies) return { kind: "none" };
  if (input.codesRefused !== true && input.companyMode === "automated") return { kind: "automated" };
  const reason: NoQuickBooksTaxReason =
    input.codesRefused === true
      ? "tax_codes_refused"
      : input.companyMode === "manual"
        ? "no_default_code"
        : "no_sales_tax_in_quickbooks";
  if (input.codesRefused !== true && input.companyMode === "manual") {
    const only = input.salesTaxCodes.length === 1 ? input.salesTaxCodes[0]! : null;
    const code = input.defaultTaxCode ?? only;
    if (code) return { kind: "company_code", taxCodeId: code.id, taxCodeName: code.name };
  }
  const rate = input.estimateRateBasisPoints;
  if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) return { kind: "estimate", rateBasisPoints: Math.round(rate), reason };
  return { kind: "unavailable", reason };
}

/**
 * The final invoice's lines at pre-tax prices, marked taxable where tax applies.
 *
 * `preTaxTotalCents` is what the couple agreed before any tax: for a booking
 * signed under StudioCue's own tax (older bookings, whose total included it)
 * that is total − the agreed tax, so tax is never counted twice; for one signed
 * pre-tax it is the total. `amountCents` is that less everything paid.
 */
export function gatedFinalLines(input: {
  amountCents: number;
  preTaxTotalCents: number;
  discountCents: number;
  items: readonly JobPackageItem[];
  retainerPaidCents: number | null;
  taxApplies: boolean;
}): FinalLinesResult {
  const built = quickBooksFinalLines({
    amountCents: input.amountCents,
    packageTotalCents: input.preTaxTotalCents,
    taxCents: 0,
    discountCents: input.discountCents,
    items: input.items,
    retainerPaidCents: input.retainerPaidCents,
  });
  const lines = built.lines.map((line, index): InvoiceLine => {
    if (!input.taxApplies) return { ...line, taxable: false };
    if (built.itemised && index < input.items.length) return { ...line, taxable: input.items[index]!.taxable };
    if (line.kind === "discount") return { ...line, taxable: true };
    // One "Packages" line standing in for an amendment: the agreed price, taxable.
    if (line.kind === "package") return { ...line, taxable: true };
    // "Final balance" (the lines could not be built): the balance is net of
    // the retainer, so taxing it would under-charge. Left untaxed and the
    // review says so.
    return { ...line, taxable: false };
  });
  return { lines, taxCents: 0, itemised: built.itemised };
}

/** "8.25%" from 825. */
export function ratePercent(basisPoints: number): string {
  return `${Math.round(basisPoints) / 100}%`;
}

/** The description of the studio's estimated tax line. Recognised again by quickBooksLinesWithoutTax. */
export const ESTIMATED_TAX_PREFIX = "Sales tax (estimated";

export type GatedPayload = {
  Line: Record<string, unknown>[];
  TxnTaxDetail?: Record<string, unknown>;
  /** The lines as sent, the estimate line included when there is one. */
  sentLines: InvoiceLine[];
  /** The pre-tax total StudioCue expects QuickBooks to show. */
  expectedSubtotalCents: number;
  /** The studio's estimated tax, sent as its own line (estimate strategy only). */
  estimateTaxCents: number;
};

/**
 * The invoice body's `Line` and tax detail for a switched-on studio.
 *
 * Never a `TxnTaxDetail.TotalTax` override: QuickBooks is the authority.
 *   automated:    TAX on taxable lines, NON elsewhere; QuickBooks computes.
 *   company_code: the same, plus TxnTaxCodeRef = the company's code.
 *   estimate:     every line NON (or no codes), and "Sales tax (estimated at
 *                 8.25%)" as a non-taxable line.
 *   none / unavailable: every line NON (or no codes); no tax.
 * `companyMode` "none" (no sales tax in QuickBooks, non-US, or unreadable
 * preferences) sends no tax codes at all, as StudioCue always did.
 */
export function quickBooksGatedPayload(input: {
  lines: readonly InvoiceLine[];
  strategy: QuickBooksTaxStrategy;
  companyMode: QuickBooksTaxMode;
  itemRef: { value: string; name?: string } | ((line: InvoiceLine) => { value: string; name?: string });
}): GatedPayload {
  const { strategy } = input;
  const computes = strategy.kind === "automated" || strategy.kind === "company_code";
  const taxableBase = sum(input.lines.filter((line) => line.taxable));
  const estimateTaxCents =
    strategy.kind === "estimate" ? Math.max(0, Math.round((taxableBase * strategy.rateBasisPoints) / 10000)) : 0;
  const estimateLine: InvoiceLine[] =
    estimateTaxCents > 0 && strategy.kind === "estimate"
      ? [
          {
            kind: "sales_tax",
            title: "Sales tax",
            description: `${ESTIMATED_TAX_PREFIX} at ${ratePercent(strategy.rateBasisPoints)})`,
            quantity: 1,
            unitPriceCents: estimateTaxCents,
            amountCents: estimateTaxCents,
            taxable: false,
          },
        ]
      : [];
  const sentLines = [...input.lines, ...estimateLine];
  const code = (line: InvoiceLine) =>
    input.companyMode === "none" ? {} : { TaxCodeRef: { value: computes && line.taxable ? "TAX" : "NON" } };
  return {
    Line: sentLines.map((entry) => ({
      Amount: qbDollars(entry.amountCents),
      DetailType: "SalesItemLineDetail",
      Description: entry.description,
      SalesItemLineDetail: {
        ItemRef: typeof input.itemRef === "function" ? input.itemRef(entry) : input.itemRef,
        Qty: entry.quantity,
        UnitPrice: qbDollars(entry.unitPriceCents),
        ...code(entry),
      },
    })),
    ...(strategy.kind === "company_code" && input.companyMode !== "none"
      ? { TxnTaxDetail: { TxnTaxCodeRef: { value: strategy.taxCodeId } } }
      : {}),
    sentLines,
    expectedSubtotalCents: sum(input.lines),
    estimateTaxCents,
  };
}

export type TaxLocation = { city: string | null; region: string | null };

export type TaxReadBack = {
  totalCents: number;
  /** Tax on the invoice: QuickBooks' computed tax, or the estimate line. */
  taxCents: number;
  /** Total less tax. */
  subtotalCents: number;
  balanceCents: number;
  billingAddressMissing: boolean;
  taxLocation: TaxLocation | null;
  /** Pre-tax: did QuickBooks bill the packages StudioCue expected? */
  preTaxMatches: boolean;
  preTaxDifferenceCents: number;
};

/**
 * What QuickBooks made of the invoice.
 *
 * The tax is QuickBooks' figure, not a "mismatch": only the pre-tax subtotal
 * is checked against StudioCue's. An invoice with no street, city or postal
 * code on its BillAddr is one Automated Sales Tax had nothing to work from.
 */
export function quickBooksTaxReadBack(invoice: unknown, expected: { expectedSubtotalCents: number }): TaxReadBack {
  const value = record(invoice);
  const totalCents = dollarsToCents(value.TotalAmt) ?? 0;
  const computedTax = dollarsToCents(record(value.TxnTaxDetail).TotalTax) ?? 0;
  // The studio's estimate, when it went as its own line: read from the
  // invoice itself, so an invoice adopted from an earlier attempt reads the
  // same as one just made.
  const estimateCents = (Array.isArray(value.Line) ? value.Line.map(record) : [])
    .filter((line) => text(line.Description).startsWith(ESTIMATED_TAX_PREFIX))
    .reduce((total, line) => total + (dollarsToCents(line.Amount) ?? 0), 0);
  const taxCents = Math.max(0, computedTax) + Math.max(0, estimateCents);
  const subtotalCents = totalCents - taxCents;
  const balanceCents = dollarsToCents(value.Balance) ?? totalCents;
  const bill = record(value.BillAddr);
  const billingAddressMissing = !["Line1", "City", "PostalCode"].some((key) => text(bill[key]));
  const city = text(bill.City) || null;
  const region = text(bill.CountrySubDivisionCode) || null;
  const check = quickBooksAmountCheck(expected.expectedSubtotalCents, subtotalCents);
  return {
    totalCents,
    taxCents,
    subtotalCents,
    balanceCents,
    billingAddressMissing,
    taxLocation: city || region ? { city, region } : null,
    preTaxMatches: check.matches,
    preTaxDifferenceCents: check.differenceCents,
  };
}

/** "Austin, TX", "TX", or null. */
export function taxLocationLabel(location: TaxLocation | null | undefined): string | null {
  if (!location) return null;
  const parts = [location.city, location.region].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(", ") : null;
}

/**
 * The note the studio reads beside the tax, or null when there is nothing to
 * add to "calculated by QuickBooks for Austin, TX".
 */
export function quickBooksTaxNote(input: {
  strategy: QuickBooksTaxStrategy;
  billingAddressMissing: boolean;
  /** False when one untaxed "Final balance" line stands in for the packages. */
  itemised: boolean;
}): string | null {
  const { strategy } = input;
  if (strategy.kind === "automated" && input.billingAddressMissing)
    return "Add the couple's billing address so QuickBooks can work out the tax.";
  const why = (reason: NoQuickBooksTaxReason) =>
    reason === "no_default_code"
      ? "QuickBooks has no single default sales tax rate"
      : reason === "tax_codes_refused"
        ? "QuickBooks wouldn't take sales tax codes on this invoice"
        : "Sales tax is off in QuickBooks";
  if (strategy.kind === "estimate")
    return `${why(strategy.reason)}, so this is your estimate of ${ratePercent(strategy.rateBasisPoints)}, shown as its own line. Check it before you send.`;
  if (strategy.kind === "unavailable")
    return `${why(strategy.reason)} and you haven't set an estimate rate, so no tax is on this bill. Set up sales tax in QuickBooks, or add an estimate rate under Integrations → QuickBooks, then use Edit to send a corrected one.`;
  if (!input.itemised && strategy.kind !== "none")
    return "StudioCue couldn't list the packages on this bill, so QuickBooks charged no tax on it. Use Edit to send a corrected one.";
  return null;
}

export type SendReview = {
  state: "awaiting_studio";
  reason: HoldReason;
  strategy: QuickBooksTaxStrategy["kind"];
  /** The whole decision, so a recalculation can say the same things again. */
  taxStrategy: QuickBooksTaxStrategy;
  /** The studio's estimate rate, when the tax is an estimate. */
  rateBasisPoints: number | null;
  taxCodeName: string | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  taxLocation: TaxLocation | null;
  billingAddressMissing: boolean;
  /** "Send with tax" is refused while QuickBooks had no address to tax from. */
  sendWithTaxBlocked: boolean;
  note: string | null;
  heldAt: string;
};

/** What the invoice record carries while the studio checks it. */
export function sendReviewRecord(input: {
  reason: HoldReason;
  strategy: QuickBooksTaxStrategy;
  readBack: TaxReadBack;
  itemised: boolean;
  now: string;
}): SendReview {
  const { strategy, readBack } = input;
  const blocked = strategy.kind === "automated" && readBack.billingAddressMissing;
  return {
    state: "awaiting_studio",
    reason: input.reason,
    strategy: strategy.kind,
    taxStrategy: strategy,
    rateBasisPoints: strategy.kind === "estimate" ? strategy.rateBasisPoints : null,
    taxCodeName: strategy.kind === "company_code" ? strategy.taxCodeName : null,
    subtotalCents: readBack.subtotalCents,
    taxCents: readBack.taxCents,
    totalCents: readBack.totalCents,
    taxLocation: readBack.taxLocation,
    billingAddressMissing: strategy.kind === "automated" ? readBack.billingAddressMissing : false,
    sendWithTaxBlocked: blocked,
    note:
      input.reason === "retainer"
        ? null
        : quickBooksTaxNote({ strategy, billingAddressMissing: readBack.billingAddressMissing, itemised: input.itemised }),
    heldAt: input.now,
  };
}

/** A QuickBooks invoice line, as read back. */
type QuickBooksLine = Record<string, unknown>;

/** Lines QuickBooks computes itself and refuses (or ignores) on an update. */
const GENERATED_LINE_TYPES = new Set(["SubTotalLineDetail", "TaxLineDetail"]);

/**
 * The invoice's lines with the tax taken off, for "Send without tax".
 *
 * Every sales line becomes NON (where it carried a code), the studio's
 * estimated tax line is dropped, and QuickBooks' own subtotal lines are left
 * for it to rebuild. Everything else is sent back exactly as read, Id
 * included, so a sparse update changes the tax and nothing more.
 */
export function quickBooksLinesWithoutTax(lines: unknown): QuickBooksLine[] {
  if (!Array.isArray(lines)) return [];
  return lines
    .map(record)
    .filter((line) => !GENERATED_LINE_TYPES.has(text(line.DetailType)))
    .filter((line) => !text(line.Description).startsWith(ESTIMATED_TAX_PREFIX))
    .map((line) => {
      const detail = record(line.SalesItemLineDetail);
      if (text(line.DetailType) !== "SalesItemLineDetail" || !("TaxCodeRef" in detail)) return line;
      return { ...line, SalesItemLineDetail: { ...detail, TaxCodeRef: { value: "NON" } } };
    });
}

/**
 * The sparse-update changes for "Send without tax".
 *
 * NON lines alone are enough on Automated Sales Tax. An older manual-tax
 * company also carries its tax code on the invoice (`TxnTaxCodeRef`), and
 * QuickBooks refuses NON lines under it ("encountered an error while
 * calculating tax") — found against Intuit's sandbox, 2026-10-01. An empty
 * `TxnTaxDetail` clears the code; it is sent only when there is one.
 */
export function quickBooksUntaxChanges(invoice: unknown): Record<string, unknown> {
  const value = record(invoice);
  const companyCode = text(record(record(value.TxnTaxDetail).TxnTaxCodeRef).value);
  return { Line: quickBooksLinesWithoutTax(value.Line), ...(companyCode ? { TxnTaxDetail: {} } : {}) };
}

/** The lines as read, less QuickBooks' generated ones — for an update that changes nothing but the address. */
export function quickBooksLinesAsSent(lines: unknown): QuickBooksLine[] {
  if (!Array.isArray(lines)) return [];
  return lines.map(record).filter((line) => !GENERATED_LINE_TYPES.has(text(line.DetailType)));
}

/** Any line still taxed, or an estimate line still present. */
export function quickBooksInvoiceStillTaxed(invoice: unknown): boolean {
  const value = record(invoice);
  if ((dollarsToCents(record(value.TxnTaxDetail).TotalTax) ?? 0) > 0) return true;
  const lines = Array.isArray(value.Line) ? value.Line.map(record) : [];
  return lines.some((line) => text(line.Description).startsWith(ESTIMATED_TAX_PREFIX));
}

/** The sparse update body, or null when the invoice cannot be updated (no Id / SyncToken). */
export function quickBooksSparseInvoiceUpdate(
  invoice: unknown,
  changes: Record<string, unknown>,
): Record<string, unknown> | null {
  const value = record(invoice);
  const id = text(value.Id);
  const syncToken = value.SyncToken === undefined || value.SyncToken === null ? "" : String(value.SyncToken);
  if (!id || !syncToken) return null;
  return { Id: id, SyncToken: syncToken, sparse: true, ...changes };
}

/**
 * Mock mode: the same decisions, no QuickBooks. Tax is the studio's estimate
 * on the taxable lines (zero with no rate), so the review renders with a
 * figure and the arithmetic is the real arithmetic.
 */
export function mockTaxReadBack(input: {
  lines: readonly InvoiceLine[];
  taxApplies: boolean;
  estimateRateBasisPoints: number | null;
  billingAddressKnown: boolean;
}): TaxReadBack {
  const subtotal = sum(input.lines);
  const taxable = sum(input.lines.filter((line) => line.taxable));
  const rate = input.estimateRateBasisPoints ?? 0;
  const taxCents = input.taxApplies && rate > 0 ? Math.max(0, Math.round((taxable * rate) / 10000)) : 0;
  return {
    totalCents: subtotal + taxCents,
    taxCents,
    subtotalCents: subtotal,
    balanceCents: subtotal + taxCents,
    billingAddressMissing: !input.billingAddressKnown,
    taxLocation: null,
    preTaxMatches: true,
    preTaxDifferenceCents: 0,
  };
}

/** A stored strategy, read back safely; "none" when it can't be read. */
export function taxStrategyFromRecord(value: unknown): QuickBooksTaxStrategy {
  const stored = record(value);
  const reason: NoQuickBooksTaxReason =
    stored.reason === "no_default_code" || stored.reason === "tax_codes_refused" ? stored.reason : "no_sales_tax_in_quickbooks";
  if (stored.kind === "automated") return { kind: "automated" };
  if (stored.kind === "company_code" && text(stored.taxCodeId))
    return { kind: "company_code", taxCodeId: text(stored.taxCodeId), taxCodeName: text(stored.taxCodeName) || null };
  if (stored.kind === "estimate" && cents(stored.rateBasisPoints) > 0)
    return { kind: "estimate", rateBasisPoints: cents(stored.rateBasisPoints), reason };
  if (stored.kind === "unavailable") return { kind: "unavailable", reason };
  return { kind: "none" };
}
