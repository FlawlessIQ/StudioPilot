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
  /** The standing retainer invoice, or null when none has been raised. */
  retainer: { status: string; balanceCents: number; hostedUrl: string | null } | null;
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
  const accepted = input.proposalStatus === "accepted";
  const signed = input.contractStatus !== null && SIGNED.has(input.contractStatus);
  const paid =
    input.retainer !== null &&
    (input.retainer.status === "paid" || input.retainer.balanceCents <= 0);
  const booked = accepted && signed && paid;

  const state = (done: boolean, reachable: boolean, actionable: boolean): BookingStepState =>
    done ? "done" : !reachable ? "upcoming" : actionable ? "current" : "waiting";

  const agreementSent = input.contractStatus !== null && !SIGNED.has(input.contractStatus);
  const invoiceReady = input.retainer !== null && !paid && Boolean(input.retainer.hostedUrl);

  const steps: BookingStep[] = [
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
      label: "Pay your deposit",
      state: state(paid, signed, invoiceReady),
    },
    {
      key: "booked",
      label: "Your date is booked",
      state: booked ? "done" : "upcoming",
    },
  ];

  const next: BookingStepsView["next"] = booked
    ? {
        title: "Your date is booked",
        detail: "Your agreement is signed and your deposit is in. Planning details will appear here as the day gets closer.",
        href: null,
        actionLabel: null,
      }
    : !accepted
      ? input.proposalStatus !== null && OPEN_PROPOSAL.has(input.proposalStatus)
        ? {
            title: "Review and accept your proposal",
            detail: "It's the first of three short steps to reserve your date.",
            href: "/client/proposal",
            actionLabel: "Review proposal",
          }
        : {
            title: "Your proposal is being prepared",
            detail: "Your studio will share it here. Reserving your date takes three short steps once it arrives.",
            href: null,
            actionLabel: null,
          }
      : !signed
        ? agreementSent
          ? {
              title: "Sign your agreement",
              detail: "Your agreement has been sent for signature. Look for the email with your secure signing link.",
              href: "/client/contract",
              actionLabel: "Agreement status",
            }
          : {
              title: "Your agreement is on its way",
              detail: "You accepted your proposal. Your agreement will arrive by email for signature shortly.",
              href: null,
              actionLabel: null,
            }
        : invoiceReady
          ? {
              title: "Pay your deposit",
              detail: "The last step. Your date is secured the moment it's paid.",
              href: "/client/payments",
              actionLabel: "Pay deposit",
            }
          : {
              title: "Your deposit invoice is being prepared",
              detail: "Your agreement is signed. The deposit invoice will appear here shortly.",
              href: null,
              actionLabel: null,
            };

  return { steps, booked, next };
}
