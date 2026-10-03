import { FileCheck2, FileSignature, HandCoins, Receipt, RefreshCw } from "lucide-react";
import { SCHEDULE } from "@/features/journey/expected-timeline";

/**
 * Getting paid, as a diagram built in the page: one wedding's money from the
 * proposal to the last payment, with the Harts' own numbers — the same ones on
 * Ella's payments screen beside it (public/marketing/portal-payment.webp) and
 * in the film. Through QuickBooks only: Stripe client payments aren't offered
 * to studios (tests/marketing-claims.test.ts).
 *
 * The final balance's timing is read from the schedule the product runs on,
 * not typed in.
 */
const HARTS_TOTAL_CENTS = 650_000;
const HARTS_RETAINER_CENTS = 195_000;
const HARTS_FINAL_CENTS = HARTS_TOTAL_CENTS - HARTS_RETAINER_CENTS;

const dollars = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);

const STEPS = [
  {
    icon: FileCheck2,
    title: "Proposal",
    amount: dollars(HARTS_TOTAL_CENTS),
    text: "Priced from your package. Accepted online.",
  },
  {
    icon: FileSignature,
    title: "Agreement",
    amount: "Signed",
    status: true,
    text: "Written from the proposal and signed online in StudioCue.",
  },
  {
    icon: Receipt,
    title: "Retainer",
    amount: dollars(HARTS_RETAINER_CENTS),
    text: "Invoiced from your QuickBooks the moment they sign. Paid, and the date is theirs.",
  },
  {
    icon: HandCoins,
    title: "Final balance",
    amount: dollars(HARTS_FINAL_CENTS),
    text: `Invoiced ${SCHEDULE.finalInvoiceRaisedDaysBefore / 7} weeks before the day, due ${SCHEDULE.finalInvoiceDueDaysBefore / 7} weeks before.`,
  },
  {
    icon: RefreshCw,
    title: "Autopay",
    amount: "Optional",
    status: true,
    text: "With QuickBooks Payments, a saved card pays the balance when it's due.",
  },
] as const;

export function PaymentTrack() {
  return (
    <figure className="mk-track">
      <ol aria-label="The Harts' payments, from proposal to paid in full">
        {STEPS.map((step) => {
          const Icon = step.icon;
          return (
            <li key={step.title}>
              <span aria-hidden="true" className="mk-track-node">
                <Icon size={16} />
              </span>
              <span className="mk-track-copy">
                <strong>{step.title}</strong>
                <small>{step.text}</small>
              </span>
              <span className="mk-track-amount" data-status={"status" in step ? "true" : undefined}>
                {step.amount}
              </span>
            </li>
          );
        })}
      </ol>
      <figcaption>
        <span>Paid in full</span>
        <strong>{`${dollars(HARTS_RETAINER_CENTS)} + ${dollars(HARTS_FINAL_CENTS)} = ${dollars(HARTS_TOTAL_CENTS)}`}</strong>
        <small>In your QuickBooks, with nothing to chase.</small>
      </figcaption>
    </figure>
  );
}
