"use client";

import { CircleAlert } from "lucide-react";
import { taxPlace } from "@/features/billing/held-invoice-review";

/**
 * The invoice as QuickBooks received it, line by line.
 *
 * GR Productions checks every invoice against how he builds them by hand:
 * the retainer as crew × $1,000 with the packages at $0, and the final as
 * the packages less the retainer plus tax on the full package (2026-10-01).
 * The worker records the lines it sent (`providerLines`) and what QuickBooks
 * billed (`providerTotals`); this shows both, and says so plainly when they
 * disagree (`providerAmountMismatch`). Display only — the figures were
 * decided server-side (functions/src/operations/quickbooks-invoice-lines.ts).
 */

type Line = {
  kind?: string;
  title?: string;
  description?: string;
  quantity?: number;
  unitPriceCents?: number;
  amountCents?: number;
  taxable?: boolean;
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const money = (value: unknown, currency: unknown) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: String(currency || "USD") }).format(
    Number(value ?? 0) / 100,
  );

/** The first line of a description: "Gold Photo Package — 2 photographers, 8 hours". */
const headline = (line: Line) => String(line.description ?? line.title ?? "").split("\n")[0] ?? "";

export function ProviderInvoiceLines({ invoice }: { invoice: Record<string, unknown> }) {
  const sent = record(invoice.providerLines);
  const lines = (Array.isArray(sent.lines) ? sent.lines : []).map((line) => record(line) as Line);
  if (!lines.length) return null;
  const currency = invoice.currency;
  const provider = invoice.provider === "stripe" ? "Stripe" : "QuickBooks";
  const taxCents = Number(sent.taxCents ?? 0);
  const totals = record(invoice.providerTotals);
  const mismatch = record(invoice.providerAmountMismatch);
  const expected = Number(sent.expectedTotalCents ?? invoice.amountCents ?? 0);
  // QuickBooks as the sales-tax authority: it worked the tax out from the
  // couple's billing address (functions/src/operations/quickbooks-held-invoice.ts).
  const quickBooksTax = sent.taxAuthority === "quickbooks";
  const place = taxPlace(sent.taxLocation);
  // The studio's estimate went as its own line; it is not shown twice.
  const taxIsALine = lines.some((line) => line.kind === "sales_tax");
  return (
    <div className="invoice-calculation-lines">
      <span>
        <small>
          {`Sent to ${provider} as`}
          <em>
            {invoice.kind === "final"
              ? quickBooksTax
                ? "Packages − retainer; QuickBooks adds the sales tax"
                : "Packages − retainer + tax"
              : "Retainer, then the packages at $0"}
          </em>
        </small>
      </span>
      {lines.map((line, index) => {
        const quantity = Number(line.quantity ?? 1);
        return (
          <span key={`${index}-${String(line.title)}`}>
            <small>
              {headline(line)}
              {quantity !== 1 ? (
                <em>{`${quantity} × ${money(line.unitPriceCents, currency)}`}</em>
              ) : line.taxable ? (
                <em>Taxable</em>
              ) : null}
            </small>
            <strong>{money(line.amountCents, currency)}</strong>
          </span>
        );
      })}
      {taxCents > 0 && !taxIsALine ? (
        <span>
          {/* The small is a grid: the label and its note sit on two rows. */}
          <small>
            {"Sales tax"}
            <em>
              {quickBooksTax
                ? place
                  ? `Calculated by QuickBooks for ${place}`
                  : "Calculated by QuickBooks"
                : "On the full package amount"}
            </em>
          </small>
          <strong>{money(taxCents, currency)}</strong>
        </span>
      ) : null}
      <span>
        <small>{`Total ${provider} billed`}</small>
        <strong>{money(typeof totals.totalCents === "number" ? totals.totalCents : expected, currency)}</strong>
      </span>
      {typeof mismatch.providerTotalCents === "number" && mismatch.basis === "pre_tax" ? (
        <p className="booking-delivery-warning" role="alert">
          <CircleAlert aria-hidden="true" size={14} />
          <span>
            {`Before tax, ${provider}'s invoice comes to ${money(mismatch.providerSubtotalCents, currency)}, but StudioCue expected ${money(
              mismatch.expectedCents,
              currency,
            )}. Check the lines in ${provider}; if they're wrong, void it here and send it again.`}
          </span>
        </p>
      ) : typeof mismatch.providerTotalCents === "number" ? (
        <p className="booking-delivery-warning" role="alert">
          <CircleAlert aria-hidden="true" size={14} />
          <span>
            {`${provider} billed ${money(mismatch.providerTotalCents, currency)}, but StudioCue expected ${money(
              mismatch.expectedCents,
              currency,
            )}${
              typeof mismatch.providerTaxCents === "number"
                ? ` (${provider} charged ${money(mismatch.providerTaxCents, currency)} tax)`
                : ""
            }. The couple is asked for ${provider}'s figure. Check the invoice's sales tax there; if it's wrong, void it here and send it again.`}
          </span>
        </p>
      ) : null}
    </div>
  );
}
