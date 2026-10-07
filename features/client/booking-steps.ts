/**
 * Reserve your date — the couple's booking as one sequence.
 *
 * The portal had the right pages (proposal, agreement, payments) and no thread
 * between them: accepting a proposal said "your studio can prepare the
 * agreement" and stopped, and nothing told the couple that signing and a
 * deposit were the two steps between them and a secured date. This reads the
 * records the portal already loads and names the one step that is theirs next.
 *
 * Read-only and derived. Nothing here decides a booking; the booking gate does.
 */

import { invoicePayRoute } from "@/features/client/invoice-pay-route";

export type BookingStepKey = "proposal" | "agreement" | "deposit" | "booked";
export type BookingStepState = "done" | "current" | "waiting" | "upcoming";

export type BookingStep = {
  key: BookingStepKey;
  label: string;
  state: BookingStepState;
};

export type BookingStepsInput = {
  /** The newest proposal version's status, or null when none is shared. */
  proposalStatus: string | null;
  /** The newest non-superseded contract's status, or null when none exists. */
  contractStatus: string | null;
  /**
   * The standing retainer invoice, or null when none has been raised.
   * `atProvider`: it exists in the studio's books, pay link or not
   * (features/client/invoice-pay-route.ts).
   */
  retainer: { status: string; balanceCents: number; hostedUrl: string | null; atProvider?: boolean } | null;
  /**
   * What this kind of job needs to book (features/job-kinds): a family session
   * has no agreement and is paid in full; a sports day needs neither before the
   * day. Omitted: both, as for a wedding.
   */
  needs?: { agreement: boolean; payment: boolean; paidInFull?: boolean };
};

export type BookingStepsView = {
  steps: BookingStep[];
  /** True once the date is secured: agreement signed and deposit paid. */
  booked: boolean;
  /** What the couple should do or expect now. */
  next: {
    title: string;
    detail: string;
    /** A portal page to go to, or null when the couple has nothing to press. */
    href: string | null;
    actionLabel: string | null;
  };
};

const SIGNED = new Set(["completed", "signed"]);
const OPEN_PROPOSAL = new Set(["sent", "viewed"]);

export function bookingSteps(input: BookingStepsInput): BookingStepsView {
  const needs = input.needs ?? { agreement: true, payment: true };
  const accepted = input.proposalStatus === "accepted";
  const signed = !needs.agreement || (input.contractStatus !== null && SIGNED.has(input.contractStatus));
  const paid =
    !needs.payment ||
    (input.retainer !== null && (input.retainer.status === "paid" || input.retainer.balanceCents <= 0));
  // A deposit is part of the price; a job paid in full pays the whole of it.
  const invoice = needs.paidInFull ? "invoice" : "deposit invoice";
  const booked = accepted && signed && paid;

  const state = (done: boolean, reachable: boolean, actionable: boolean): BookingStepState =>
    done ? "done" : !reachable ? "upcoming" : actionable ? "current" : "waiting";

  const agreementSent = needs.agreement && input.contractStatus !== null && !SIGNED.has(input.contractStatus);
  const payRoute = input.retainer !== null && !paid ? invoicePayRoute(input.retainer) : null;
  const invoiceReady = payRoute === "online";
  // Raised, with no pay link — and none coming until the studio turns on
  // online payments. The couple pays the studio directly. Not "being
  // prepared": that told a couple to wait for a link that was never coming.
  const payDirect = payRoute === "direct";

  const allSteps: BookingStep[] = [
    {
      key: "proposal",
      label: "Accept your proposal",
      state: state(accepted, true, input.proposalStatus !== null && OPEN_PROPOSAL.has(input.proposalStatus)),
    },
    {
      key: "agreement",
      label: "Sign the agreement",
      state: state(signed, accepted, agreementSent),
    },
    {
      key: "deposit",
      label: needs.paidInFull ? "Make your payment" : "Pay your deposit",
      state: state(paid, signed && accepted, invoiceReady || payDirect),
    },
    {
      key: "booked",
      label: "Your date is booked",
      state: booked ? "done" : "upcoming",
    },
  ];
  const steps = allSteps.filter(
    (step) => (step.key !== "agreement" || needs.agreement) && (step.key !== "deposit" || needs.payment),
  );
  const count = ["one", "two", "three"][steps.length - 2] ?? "a few";

  const next: BookingStepsView["next"] = booked
    ? {
        title: "Your date is booked",
        detail: `${[needs.agreement ? "Your agreement is signed" : null, needs.payment ? (needs.paidInFull ? "you've paid" : "your deposit is in") : null]
          .filter(Boolean)
          .join(" and ")
          .replace(/^y/, "Y") || "You're all set"}. Planning details will appear here as the day gets closer.`,
        href: null,
        actionLabel: null,
      }
    : !accepted
      ? input.proposalStatus !== null && OPEN_PROPOSAL.has(input.proposalStatus)
        ? {
            title: "Review and accept your proposal",
            detail: steps.length > 2 ? `It's the first of ${count} short steps to reserve your date.` : "Accepting it reserves your date.",
            href: "/client/proposal",
            actionLabel: "Review proposal",
          }
        : {
            title: "Your proposal is being prepared",
            detail: `Your studio will share it here. Reserving your date takes ${steps.length > 2 ? `${count} short steps` : "one step"} once it arrives.`,
            href: null,
            actionLabel: null,
          }
      : !signed
        ? agreementSent
          ? {
              title: "Sign your agreement",
              detail: "It's ready to sign. We've emailed you the link too, so you can sign here or from the email.",
              href: "/client/contract",
              actionLabel: "Sign your agreement",
            }
          : {
              title: "Your agreement is on its way",
              detail: "You accepted your proposal. Check your email: your agreement will arrive there to sign, and it will appear here too.",
              href: null,
              actionLabel: null,
            }
        : invoiceReady
          ? {
              title: needs.paidInFull ? "Make your payment" : "Pay your deposit",
              detail: "The last step. Your date is secured the moment it's paid.",
              href: "/client/payments",
              actionLabel: needs.paidInFull ? "Pay now" : "Pay deposit",
            }
          : payDirect
            ? {
                title: `Your ${invoice} is ready`,
                detail:
                  "Your studio takes this payment directly — by check, cash or bank transfer. Message them to arrange it. Your date is secured the moment it's paid.",
                href: "/client/payments",
                actionLabel: "See your invoice",
              }
            : {
                title: `Your ${invoice} is being prepared`,
                detail: `${needs.agreement ? "Your agreement is signed. " : ""}The invoice will appear here shortly.`,
                href: null,
                actionLabel: null,
              };

  return { steps, booked, next };
}
