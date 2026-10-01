/**
 * How a couple pays one invoice: online, directly to the studio, or not yet.
 *
 * The portal used to know only "has a pay link" or "doesn't", and read the
 * second as "still syncing". But a QuickBooks company without online
 * payments (QuickBooks Payments) creates the invoice and never returns a pay
 * link. That retainer sat on GR Productions' couple portal as "being
 * prepared" and "Refresh in a moment" for an invoice that already existed
 * and would never get a link — the couple had no way to pay and was told to
 * wait for something that was never coming.
 *
 * So the server says whether the invoice exists in the studio's books
 * (`atProvider`, a boolean — never the provider's own state), and this
 * decides what the couple is told.
 */

export type InvoicePayRoute = "online" | "direct" | "preparing";

/** Ids written before the accounting system has made the invoice. */
const PLACEHOLDER_ID = /^(pending_|qbo_invoice_|stripe_invoice_)/;

/**
 * Server side: the invoice has been created in QuickBooks or Stripe — a
 * completed provider job with a real id, not a placeholder.
 */
export function invoiceRaisedAtProvider(invoice: {
  providerState?: unknown;
  providerInvoiceId?: unknown;
}): boolean {
  const id = typeof invoice.providerInvoiceId === "string" ? invoice.providerInvoiceId : "";
  return invoice.providerState === "completed" && id.length > 0 && !PLACEHOLDER_ID.test(id);
}

/** Which of the three the couple is looking at. */
export function invoicePayRoute(invoice: { hostedUrl?: unknown; atProvider?: unknown }): InvoicePayRoute {
  if (typeof invoice.hostedUrl === "string" && invoice.hostedUrl) return "online";
  return invoice.atProvider === true ? "direct" : "preparing";
}

/**
 * Studio side: a QuickBooks invoice the couple cannot pay online — it is in
 * QuickBooks and still owed, but QuickBooks gave no pay link because online
 * payments are off for the company.
 */
export function quickBooksInvoiceWithoutPayLink(invoice: {
  provider?: unknown;
  providerState?: unknown;
  providerInvoiceId?: unknown;
  hostedUrl?: unknown;
  balanceCents?: unknown;
  // Any stored invoice record: only the fields above are read.
  [field: string]: unknown;
}): boolean {
  return (
    invoice.provider === "quickbooks" &&
    Number(invoice.balanceCents ?? 0) > 0 &&
    invoicePayRoute({ hostedUrl: invoice.hostedUrl, atProvider: invoiceRaisedAtProvider(invoice) }) === "direct"
  );
}

/** What the studio is told about that invoice, beside "Record a payment". */
export const QUICKBOOKS_NO_PAY_LINK_NOTE =
  "The couple can't pay this online: online payments aren't turned on in QuickBooks. Turn on QuickBooks Payments to send them a pay link, or record a check or cash payment here when it arrives.";

/**
 * The line under the amount on the couple's Payments page.
 *
 * `invoiceName` is the couple's word for it ("Retainer", "Final balance").
 */
export function invoicePayNote(
  route: InvoicePayRoute,
  input: { studioName: string | null; invoiceName: string; providerName: string | null },
): string {
  if (route === "online")
    return `Secure payment opens in ${input.providerName ?? "your studio's payment page"}. StudioCue never receives your card or bank details.`;
  if (route === "preparing")
    return "Secure payment link is still syncing. Refresh in a moment, or message your studio if you need to pay now.";
  const studio = input.studioName ?? "Your studio";
  const them = input.studioName ?? "them";
  return `Your ${input.invoiceName.toLowerCase()} invoice is ready. ${studio} takes this payment directly — by check, cash or bank transfer. Message ${them} to arrange it.`;
}
