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

export type ParticipantStatus = "unpaid" | "pay_on_day" | "paid" | "cancelled";

export const PARTICIPANT_PAYMENT_METHODS = ["cash", "card", "online", "other"] as const;
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
  cancelled: "Cancelled",
};

export const PAYMENT_METHOD_LABEL: Record<ParticipantPaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  online: "Paid online",
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
  // or the label (features/job-kinds/job-kinds.ts).
  return enabled || jobKindOf(project) === "sports";
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
