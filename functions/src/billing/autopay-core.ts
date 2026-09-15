/**
 * Autopay: the final balance collects itself from a card the couple saved.
 *
 * The couple saves a card once, at the deposit, and agrees in words to one
 * charge: the final balance on its due date, with one retry if it is declined.
 * On the due date a scheduler charges that card through QuickBooks Payments and
 * records the payment against the QuickBooks invoice, so the books and the
 * booking both follow without anyone chasing. See
 * docs/autopay-spike-2026-09-15.md.
 *
 * It needs two things a studio has to arrange with Intuit, which is why every
 * surface says so: a QuickBooks Payments merchant account on the studio's
 * company, and the payments permission on the StudioCue connection.
 *
 * Pure, no I/O.
 */

export const QUICKBOOKS_PAYMENTS_SCOPE = "com.intuit.quickbooks.payment";

/** Days between a declined charge and its one retry. */
export const AUTOPAY_RETRY_AFTER_DAYS = 3;
export const AUTOPAY_MAX_ATTEMPTS = 2;

/** Only the final balance is charged automatically. */
export const AUTOPAY_INVOICE_KINDS: readonly string[] = ["final"];

const UNPAID = new Set(["sent", "overdue", "partially_paid"]);

/**
 * The Payments API host for a connection. Intuit runs payments on a different
 * host from accounting; a sandbox accounting base means a sandbox company.
 */
export function quickBooksPaymentsBaseUrl(accountingBaseUrl?: string, override?: string): string {
  if (override) return override.replace(/\/$/, "");
  return /sandbox/i.test(accountingBaseUrl ?? "")
    ? "https://sandbox.api.intuit.com"
    : "https://api.intuit.com";
}

export function hasPaymentsScope(scopes: unknown): boolean {
  return Array.isArray(scopes) && scopes.includes(QUICKBOOKS_PAYMENTS_SCOPE);
}

/** The words the couple agrees to. Stored verbatim with their consent. */
export function autopayConsentText(input: {
  studioName: string;
  amount: string;
  dueDate: string | null;
}): string {
  const when = input.dueDate ? `on ${input.dueDate}` : "when it falls due";
  return `I authorise ${input.studioName} to charge this card ${input.amount} for my final balance ${when}, and to try once more ${AUTOPAY_RETRY_AFTER_DAYS} days later if that charge is declined. I can remove the card before then.`;
}

export type AutopayAttempt = {
  attempt: number;
  status: "succeeded" | "failed" | "pending";
  createdAt: string;
};

/**
 * Whether an invoice should be charged today, and which attempt it is.
 *
 * The first attempt is on or after the due date. A second is made only after a
 * declined first, and only once the retry gap has passed. Never more than two:
 * a card that keeps declining needs a person, not a loop.
 */
export function autopayChargeDue(input: {
  invoice: { kind: unknown; status: unknown; balanceCents: unknown; dueDate: unknown; provider: unknown };
  attempts: AutopayAttempt[];
  today: string;
}): { due: false; reason: string } | { due: true; attempt: number } {
  const { invoice, attempts, today } = input;
  if (invoice.provider !== "quickbooks") return { due: false, reason: "not_quickbooks" };
  if (!AUTOPAY_INVOICE_KINDS.includes(String(invoice.kind))) return { due: false, reason: "not_final" };
  if (!UNPAID.has(String(invoice.status))) return { due: false, reason: "not_unpaid" };
  if (!(Number(invoice.balanceCents) > 0)) return { due: false, reason: "no_balance" };
  const dueDate = typeof invoice.dueDate === "string" ? invoice.dueDate.slice(0, 10) : "";
  if (!dueDate || dueDate > today) return { due: false, reason: "not_yet_due" };
  if (attempts.some((attempt) => attempt.status !== "failed")) return { due: false, reason: "already_charged_or_pending" };
  if (attempts.length >= AUTOPAY_MAX_ATTEMPTS) return { due: false, reason: "attempts_exhausted" };
  const last = [...attempts].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (last) {
    const retryOn = new Date(`${last.createdAt.slice(0, 10)}T00:00:00Z`);
    retryOn.setUTCDate(retryOn.getUTCDate() + AUTOPAY_RETRY_AFTER_DAYS);
    if (retryOn.toISOString().slice(0, 10) > today) return { due: false, reason: "waiting_to_retry" };
  }
  return { due: true, attempt: attempts.length + 1 };
}

/** "123.45" from 12345, as the Payments API wants amounts. */
export function paymentsAmount(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

/**
 * What a Payments API refusal means for the studio.
 *
 * 401/403 on a card or charge call is Intuit saying this company cannot take
 * payments through us — the merchant application is not approved, or the
 * connection was made without the payments permission. That is the thing the
 * studio has to fix, so it gets its own code.
 */
export function paymentsFailureCode(status: number, body: string): string {
  if (status === 401 || status === 403) return "QUICKBOOKS_PAYMENTS_NOT_ACTIVE";
  if (/declin/i.test(body)) return "CARD_DECLINED";
  if (status === 400 || status === 402) return "CARD_REFUSED";
  return `QUICKBOOKS_PAYMENTS_FAILED_${status}`;
}

/** Last four digits from Intuit's masked number ("xxxxxxxxxxxx4242"). */
export function lastFour(masked: unknown): string {
  const digits = String(masked ?? "").replace(/\D/g, "");
  return digits.slice(-4);
}
