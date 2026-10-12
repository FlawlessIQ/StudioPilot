/**
 * Group events: one event, many paying clients (docs/group-events-design-2026-10-04.md).
 *
 * A cheer day where each parent pays for their own athlete's photos is one
 * job — one date, one venue, one crew — with a roster of participants, not
 * sixty jobs. Phase 1 is the roster the studio keeps: who is coming, what
 * each owes, who has paid and how, and a receipt for each parent. Sign-up
 * links, per-participant delivery and reviews come after.
 *
 * Minors: the athlete is usually a child, so the parent is the client. Only
 * the athlete's name (and team) is kept — what the studio needs to sort
 * photos — never a birthdate, a child's contact details or a photo of them.
 *
 * Pure. The commands live in functions/src/crm/commands.ts.
 */

import { jobKindOf } from "@/features/job-kinds/job-kinds";
import type { ParticipantInvoiceState } from "@/features/group-events/signup";
import type { ParticipantDelivery, ParticipantReviewAsk } from "@/features/group-events/delivery";

export type ParticipantStatus = "unpaid" | "pay_on_day" | "paid" | "cancelled";

// Check, Venmo and Zelle: what parents actually pay with at a cheer day
// (docs/group-event-signup-plan-2026-10-10.md).
export const PARTICIPANT_PAYMENT_METHODS = ["cash", "check", "venmo", "zelle", "card", "online", "other"] as const;
export type ParticipantPaymentMethod = (typeof PARTICIPANT_PAYMENT_METHODS)[number];

export const PARTICIPANT_LIMITS = {
  name: 120,
  team: 80,
  packageName: 120,
  phone: 40,
  /** $10,000 — far past any one parent's order; a typo guard, not a policy. */
  maxAmountCents: 1_000_000,
} as const;

export type Participant = {
  id: string;
  tenantId: string;
  projectId: string;
  parentName: string;
  email: string | null;
  phone: string | null;
  athleteName: string;
  team: string | null;
  packageName: string | null;
  amountCents: number;
  status: ParticipantStatus;
  payment: {
    amountCents: number;
    method: ParticipantPaymentMethod;
    paidAt: string;
    recordedBy: string;
  } | null;
  receiptQueuedAt: string | null;
  createdAt: string;
  /** Signed up themselves from the event's link (signup.ts), or added by the studio. */
  source?: "signup_link" | "studio";
  /** The event package they picked, and how they said they'd pay. */
  optionId?: string | null;
  chosenMethod?: string | null;
  /** What they show at the field. */
  confirmationCode?: string | null;
  /** The time they booked on a mini-session day ("09:20", the event's clock). */
  slot?: string | null;
  /**
   * Their own QuickBooks invoice, when they pay that way (Phase 4b,
   * functions/src/group-events/participant-invoices.ts). Never one of the
   * job's invoices.
   */
  qbInvoice?: {
    state: ParticipantInvoiceState;
    attempt?: number;
    providerInvoiceId?: string | null;
    docNumber?: string | null;
    hostedUrl?: string | null;
    balanceCents?: number | null;
    error?: { code: string; message: string } | null;
  } | null;
  /** Their own link after the day, and what was released to them (features/group-events/delivery.ts). */
  delivery?: ParticipantDelivery | null;
  /** Their one review ask, some days after their delivery. */
  reviewAsk?: ParticipantReviewAsk | null;
};

export type RosterSummary = {
  /** Everyone not cancelled. */
  total: number;
  paid: number;
  unpaid: number;
  payOnDay: number;
  cancelled: number;
  collectedCents: number;
  /** What the not-yet-paid still owe. */
  outstandingCents: number;
};

const cents = (value: unknown): number => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
};

export function rosterSummary(participants: readonly Pick<Participant, "status" | "amountCents" | "payment">[]): RosterSummary {
  const summary: RosterSummary = { total: 0, paid: 0, unpaid: 0, payOnDay: 0, cancelled: 0, collectedCents: 0, outstandingCents: 0 };
  for (const participant of participants) {
    if (participant.status === "cancelled") {
      summary.cancelled += 1;
      continue;
    }
    summary.total += 1;
    if (participant.status === "paid") {
      summary.paid += 1;
      summary.collectedCents += cents(participant.payment?.amountCents ?? participant.amountCents);
    } else {
      if (participant.status === "pay_on_day") summary.payOnDay += 1;
      else summary.unpaid += 1;
      summary.outstandingCents += cents(participant.amountCents);
    }
  }
  return summary;
}

export const PARTICIPANT_STATUS_LABEL: Record<ParticipantStatus, string> = {
  unpaid: "Not paid",
  pay_on_day: "Pays on the day",
  paid: "Paid",
  cancelled: "Canceled",
};

export const PAYMENT_METHOD_LABEL: Record<ParticipantPaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  venmo: "Venmo",
  zelle: "Zelle",
  card: "Card",
  online: "Online",
  other: "Other",
};

/**
 * Whether the job page offers a roster. Sports days are where parents pay
 * separately (GR Productions, 2026-10-02); any job that has turned one on
 * keeps it.
 */
export function rosterOffered(project: { eventKind?: unknown; groupEvent?: unknown } | null | undefined): boolean {
  if (!project) return false;
  const enabled = (project.groupEvent as { enabled?: unknown } | undefined)?.enabled === true;
  // jobKindOf, not the raw field: older jobs carry their kind in eventTypeId
  // or the label (features/job-kinds/job-kinds.ts). Family & portraits for
  // mini-session days: one date, many families, each booking a time.
  const kind = jobKindOf(project);
  return enabled || kind === "sports" || kind === "portraits";
}

/**
 * Whether the roster's invitation is the full card or one quiet line. A
 * sports job is usually a team day; a portraits job is usually one family,
 * and a mini-session day is the exception — unless its type or name says so.
 */
export function rosterProminent(project: Record<string, unknown> | null | undefined): boolean {
  if (!project) return false;
  if (jobKindOf(project) === "sports") return true;
  const named = [project.eventTypeLabel, project.eventType, project.eventTypeId, project.name]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return /\bmini\b|mini[- ]?session/i.test(named);
}

export function rosterEnabled(project: { groupEvent?: unknown } | null | undefined): boolean {
  return (project?.groupEvent as { enabled?: unknown } | undefined)?.enabled === true;
}

/** Sorted for the day: unpaid first (what needs doing), then by athlete. */
export function rosterOrder<T extends Pick<Participant, "status" | "athleteName">>(participants: readonly T[]): T[] {
  const rank: Record<ParticipantStatus, number> = { unpaid: 0, pay_on_day: 1, paid: 2, cancelled: 3 };
  return [...participants].sort(
    (left, right) =>
      rank[left.status] - rank[right.status] ||
      left.athleteName.localeCompare(right.athleteName, undefined, { sensitivity: "base" }),
  );
}

/**
 * A mini-session day in the order it happens: by booked time, then the
 * unbooked, with cancelled places last. What matters at the field is who's
 * next, not who owes.
 */
export function rosterBySlot<T extends Pick<Participant, "status" | "athleteName"> & { slot?: string | null }>(
  participants: readonly T[],
): T[] {
  return [...participants].sort(
    (left, right) =>
      Number(left.status === "cancelled") - Number(right.status === "cancelled") ||
      (left.slot ?? "99:99").localeCompare(right.slot ?? "99:99") ||
      left.athleteName.localeCompare(right.athleteName, undefined, { sensitivity: "base" }),
  );
}

/**
 * Why QuickBooks refused a parent's invoice, in words the studio can act on
 * (`qbInvoice.error`). Found on the prod walk (2026-10-10): a company whose
 * QuickBooks subscription had ended showed only "QuickBooks invoice failed".
 */
export function participantInvoiceProblem(error: { code?: string; message?: string } | null | undefined): string | null {
  if (!error?.message) return null;
  const message = error.message;
  const status = Number(message.split(":")[1] ?? 0);
  const said = message.split(":").slice(2).join(":").trim();
  if (/subscription period has ended|billing problem|trial or subscription/i.test(said))
    return "QuickBooks says your subscription has ended or has a billing problem, so it won't add anything. Sort that out in QuickBooks, then send it again.";
  if (status === 401 || status === 403 || /REAUTH|NOT_CONNECTED|CREDENTIAL/.test(error.code ?? ""))
    return "QuickBooks rejected the connection. Reconnect it in Integrations, then send it again.";
  if (/EMAIL_REQUIRED/.test(error.code ?? "")) return "Add the parent's email, then send it again.";
  if (said && /[a-z]/.test(said) && !/^[A-Z0-9_]+$/.test(said)) return `QuickBooks refused it: ${said.slice(0, 200)}`;
  return "QuickBooks refused it. Check the connection in Integrations, then send it again.";
}
