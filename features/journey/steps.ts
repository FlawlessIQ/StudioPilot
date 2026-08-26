import type { ProjectState } from "@/features/projects/schema";

/**
 * The Journey — Gabriel's easy flow as a deterministic engine.
 *
 * A photographer thinks in one thread per couple: inquiry → reply → consult →
 * proposal → contract → retainer → schedule form → run of show → crew → COI →
 * final balance → day-before → event → delivery → album & review. This module
 * turns the project's actual records into that thread: every step gets a
 * status, and exactly ONE step is "current" — the single next thing the
 * studio should do. Pure function, no I/O; the UI feeds it plain values.
 */

export type JourneyStepKey =
  | "inquiry"
  | "first_reply"
  | "consultation"
  | "proposal"
  | "contract"
  | "retainer"
  | "schedule_form"
  | "run_of_show"
  | "crew"
  | "coi"
  | "final_balance"
  | "day_before"
  | "event_day"
  | "delivery"
  | "album_review";

export type JourneyStepStatus =
  | "complete"
  | "current"
  | "waiting_client"
  | "waiting_other"
  | "upcoming";

export type JourneyAction =
  | { kind: "link"; label: string; href: string }
  | {
      kind: "draft";
      label: string;
      trigger: "inquiry_reply" | "day_before_checklist" | "review_request";
    };

/** Who the journey is waiting on for this step. */
export type JourneyOwner = "studio" | "client" | "provider";

export type JourneyStep = {
  key: JourneyStepKey;
  title: string;
  detail: string;
  status: JourneyStepStatus;
  action: JourneyAction | null;
  /**
   * Every step is a door: the place where this step's record lives, whatever
   * its status. Complete steps open their evidence, waiting steps open the
   * thing being waited on, upcoming steps open the surface where the work
   * will happen.
   */
  record: { label: string; href: string } | null;
  /** Owner chip: null for complete/upcoming, set while a step is in play. */
  owner: JourneyOwner | null;
  /** For upcoming steps: one plain sentence on what unlocks it. */
  unlock: string | null;
  /**
   * Manual advance for steps whose completion is a plain state transition
   * (never for evidence-controlled ones): "this already happened outside
   * StudioCue — mark it done."
   */
  advance: { targetState: string; label: string } | null;
};

export type JourneyInput = {
  projectId: string;
  state: ProjectState | string;
  eventDate: string | null; // YYYY-MM-DD
  today: string; // YYYY-MM-DD
  lead: { id: string; status: string } | null;
  hasConsultation: boolean;
  proposalStatus: string | null;
  contractStatus: string | null;
  retainerInvoiceStatus: string | null;
  finalInvoiceStatus: string | null;
  /**
   * True when the final balance is past its due date. Status alone cannot
   * say this, and it changes whose job the step is: an invoice merely sent
   * is with the client, but one that has gone past its date is the studio's
   * to chase.
   */
  finalInvoiceOverdue?: boolean;
  questionnaireStatus: string | null;
  /**
   * Whether the submitted questionnaire actually carries answers. Required, not
   * optional: `status: "submitted"` with `answers: {}` was ticking this step in
   * production, so a caller must not be able to omit the substance check by
   * forgetting a field. Compute with `questionnaireIsAnswered`.
   */
  questionnaireHasAnswers: boolean;
  scheduleStatus: string | null;
  /**
   * Whether the settled schedule holds at least one item a person could read.
   * Same reasoning: "approved" with unreadable items ticked Run of show while
   * the couple's brief showed "Invalid Date" six times. Compute with
   * `scheduleIsUsable`.
   */
  scheduleHasUsableItems: boolean;
  crewAccepted: number;
  crewCascadeActive: boolean;
  coiStatus: string | null;
  dayBeforeDraftStatus: string | null;
  hasDelivery: boolean;
  albumOrReviewDone: boolean;
};

const STATE_RANK: Record<string, number> = {
  LEAD: 0,
  CONSULTATION: 1,
  PROPOSAL: 2,
  CONTRACT_PENDING: 3,
  RETAINER_PENDING: 4,
  BOOKED: 5,
  PLANNING: 6,
  READY: 7,
  EVENT_COMPLETE: 8,
  POST_PRODUCTION: 9,
  DELIVERED: 10,
  REVIEW_REQUESTED: 11,
  CLOSED: 12,
};

const rank = (state: string): number => STATE_RANK[state] ?? 0;

const daysUntil = (eventDate: string | null, today: string): number | null => {
  if (!eventDate) return null;
  const event = Date.parse(`${eventDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(event) || !Number.isFinite(now)) return null;
  return Math.round((event - now) / 86_400_000);
};

/**
 * An unpaid invoice past its due date. Shared so every caller of
 * projectJourney decides this the same way — the surfaces disagreeing about
 * one job was the whole reason the step gained this input.
 */
export function invoiceIsOverdue(
  invoice: Record<string, unknown> | null | undefined,
  today: string,
): boolean {
  if (!invoice) return false;
  const status = typeof invoice.status === "string" ? invoice.status : "";
  if (["paid", "voided", "refunded"].includes(status)) return false;
  if (Number(invoice.balanceCents ?? 0) <= 0 && status !== "sent") return false;
  const due = typeof invoice.dueDate === "string" ? invoice.dueDate.slice(0, 10) : "";
  return Boolean(due) && due < today;
}

export function projectJourney(input: JourneyInput): {
  steps: JourneyStep[];
  current: JourneyStep | null;
} {
  const stateRank = rank(String(input.state));
  const days = daysUntil(input.eventDate, input.today);
  const afterEvent = days !== null && days < 0;
  const project = (suffix: string) => `${suffix}?project=${input.projectId}`;

  const steps: JourneyStep[] = [];
  const push = (
    step: Omit<JourneyStep, "record" | "owner" | "unlock" | "advance"> &
      Partial<Pick<JourneyStep, "record" | "owner" | "unlock" | "advance">>,
  ) =>
    steps.push({
      record: null,
      owner: null,
      unlock: null,
      advance: null,
      ...step,
    });

  push({
    key: "inquiry",
    title: "Inquiry received",
    detail: input.lead ? "From your inquiry form" : "Project created",
    status: "complete",
    action: null,
  });

  // First reply only exists when the project came from a lead.
  if (input.lead) {
    const replied = input.lead.status !== "new" || stateRank >= 1;
    push({
      key: "first_reply",
      title: "First reply",
      detail: replied
        ? "The client heard back from you"
        : "A personalized reply is one approval away",
      status: replied ? "complete" : "current",
      action: replied
        ? null
        : { kind: "link", label: "Review reply", href: `/studio/leads/${input.lead.id}` },
    });
  }

  const consulted = input.hasConsultation || stateRank >= 2;
  push({
    key: "consultation",
    title: "Consultation",
    // Honesty: a stage advanced by hand is not a booked meeting. Say what
    // actually happened instead of claiming a record that doesn't exist.
    detail: input.hasConsultation
      ? "Meeting booked"
      : consulted
        ? "Marked done — no meeting was recorded"
        : "Find a time that works",
    status: consulted ? "complete" : "current",
    action: consulted
      ? null
      : {
          kind: "link",
          label: "Schedule consultation",
          href: project("/studio/calendar"),
        },
    // Consultations often happen over the phone; completing this step is a
    // plain state transition, so offer marking it done in place. Evidence-
    // controlled steps (proposal, contract, retainer) never get this.
    advance:
      !consulted && String(input.state) === "LEAD"
        ? {
            targetState: "CONSULTATION",
            label: "It already happened — mark done",
          }
        : null,
  });

  const proposalDone =
    input.proposalStatus === "accepted" || stateRank >= 3;
  const proposalWaiting = ["sent", "viewed"].includes(
    input.proposalStatus ?? "",
  );
  push({
    key: "proposal",
    title: "Proposal",
    detail: proposalDone
      ? "Accepted"
      : proposalWaiting
        ? "With the client to decide"
        : "Packages and pricing, ready to send",
    status: proposalDone
      ? "complete"
      : proposalWaiting
        ? "waiting_client"
        : "current",
    action: proposalDone
      ? null
      : {
          kind: "link",
          label: proposalWaiting ? "View proposal" : "Prepare proposal",
          // No proposal yet → straight into the guided composer (which also
          // locks a package when one is missing). An existing proposal →
          // the project's proposal list.
          href: proposalWaiting
            ? project("/studio/proposals")
            : project("/studio/proposals/new"),
        },
  });

  const contractDone = input.contractStatus === "completed" || stateRank >= 4;
  const contractWaiting = [
    "sent",
    "delivered",
    "viewed",
    "partially_signed",
  ].includes(input.contractStatus ?? "");
  push({
    key: "contract",
    title: "Contract signed",
    detail: contractDone
      ? "Fully signed"
      : contractWaiting
        ? "Out for signature"
        : "Built from the accepted proposal — no retyping",
    status: contractDone
      ? "complete"
      : contractWaiting
        ? "waiting_client"
        : "current",
    action: contractDone
      ? null
      : {
          kind: "link",
          label: contractWaiting ? "Check signature status" : "Send contract",
          href: project("/studio/contracts"),
        },
  });

  const retainerDone =
    input.retainerInvoiceStatus === "paid" || stateRank >= 5;
  const retainerWaiting = [
    "sent",
    "viewed",
    "partially_paid",
    "overdue",
  ].includes(input.retainerInvoiceStatus ?? "");
  push({
    key: "retainer",
    title: "Retainer paid",
    detail: retainerDone
      ? "Booking locked in"
      : retainerWaiting
        ? "Invoice with the client"
        : "Computed from your retainer rule",
    status: retainerDone
      ? "complete"
      : retainerWaiting
        ? "waiting_client"
        : "current",
    action: retainerDone
      ? null
      : {
          kind: "link",
          label: retainerWaiting ? "Check payment status" : "Create retainer invoice",
          href: project("/studio/contracts"),
        },
  });

  const formSubmitted = ["submitted", "locked"].includes(
    input.questionnaireStatus ?? "",
  );
  // Submitted and empty is neither done nor not-started: the client thinks they
  // sent it and the studio has nothing. It stays the studio's to chase.
  const formEmptyButSubmitted = formSubmitted && !input.questionnaireHasAnswers;
  const formDone = formSubmitted && input.questionnaireHasAnswers;
  const formWaiting = ["assigned", "not_started", "in_progress"].includes(
    input.questionnaireStatus ?? "",
  );
  push({
    key: "schedule_form",
    title: "Wedding details form",
    detail: formDone
      ? "Client completed it"
      : formEmptyButSubmitted
        ? "Marked submitted, but no answers came through"
        : formWaiting
          ? "With the client to fill out"
          : "Prep locations, times, and family names",
    status: formDone
      ? "complete"
      : formWaiting && !formEmptyButSubmitted
        ? "waiting_client"
        : "current",
    action: formDone
      ? null
      : {
          kind: "link",
          label: formEmptyButSubmitted
            ? "Check the form"
            : formWaiting
              ? "Nudge or review"
              : "Send the form",
          href: project("/studio/questionnaires"),
        },
  });

  const scheduleSettled = ["approved", "published"].includes(
    input.scheduleStatus ?? "",
  );
  // Approved with nothing readable in it. Must not report complete — this is the
  // state that let a wedding reach 100% readiness with no run of show.
  const scheduleEmptyButSettled = scheduleSettled && !input.scheduleHasUsableItems;
  const scheduleDone = scheduleSettled && input.scheduleHasUsableItems;
  const scheduleWaiting = ["client_review", "changes_requested"].includes(
    input.scheduleStatus ?? "",
  );
  push({
    key: "run_of_show",
    title: "Run of show",
    detail: scheduleDone
      ? "Approved and shared"
      : scheduleEmptyButSettled
        ? "Approved, but it has no times in it yet"
        : scheduleWaiting
          ? "With the client to approve"
          : "Drafted from the form using your timing rules",
    status: scheduleDone
      ? "complete"
      : scheduleWaiting && !scheduleEmptyButSettled
        ? "waiting_client"
        : "current",
    action: scheduleDone
      ? null
      : {
          kind: "link",
          label: scheduleEmptyButSettled
            ? "Add the times"
            : scheduleWaiting
              ? "Open schedule"
              : "Draft the schedule",
          href: scheduleWaiting
            ? project("/studio/schedules")
            : `/studio/schedules/new?project=${input.projectId}`,
        },
  });

  const crewDone = input.crewAccepted > 0;
  push({
    key: "crew",
    title: "Crew confirmed",
    detail: crewDone
      ? `${input.crewAccepted} accepted`
      : input.crewCascadeActive
        ? "Offer cascading through your ranked list"
        : "Offer each role to one person at a time",
    status: crewDone
      ? "complete"
      : input.crewCascadeActive
        ? "waiting_other"
        : "current",
    action: crewDone
      ? null
      : {
          kind: "link",
          label: input.crewCascadeActive
            ? "See who has been asked"
            : "Fill crew roles",
          href: project("/studio/crew"),
        },
  });

  const coiDone = ["approved", "sent_to_venue", "venue_acknowledged", "waived"].includes(
    input.coiStatus ?? "",
  );
  const coiWaiting = ["requested", "awaiting_response", "received", "under_review", "correction_required"].includes(
    input.coiStatus ?? "",
  );
  push({
    key: "coi",
    title: "Insurance to venue",
    detail: coiDone
      ? "Certificate handled"
      : coiWaiting
        ? "Requested — chasing automatically"
        : "Request the certificate for the venue",
    status: coiDone ? "complete" : coiWaiting ? "waiting_other" : "current",
    action: coiDone
      ? null
      : {
          kind: "link",
          label: coiWaiting ? "Check COI status" : "Request COI",
          href: project("/studio/insurance"),
        },
  });

  const finalDone = input.finalInvoiceStatus === "paid";
  const finalWaiting = ["sent", "viewed", "partially_paid", "overdue"].includes(
    input.finalInvoiceStatus ?? "",
  );
  const finalDue = days !== null && days <= 45 && days >= 0;
  // An invoice that has gone past its date stops being the client's move and
  // becomes the studio's: somebody has to chase it. Without this the job
  // page said "nothing for you right now" on a wedding four days out with
  // $6,265 outstanding, while Today ranked that same balance as the single
  // most urgent thing in the studio.
  const finalOverdue = Boolean(input.finalInvoiceOverdue) && !finalDone;
  push({
    key: "final_balance",
    title: "Final balance",
    detail: finalDone
      ? "Paid in full"
      : finalOverdue
        ? "Past its due date — worth a nudge"
        : finalWaiting
          ? "Invoice with the client"
          : "Total − retainer, computed exactly · one month out",
    status: finalDone
      ? "complete"
      : finalOverdue
        ? "current"
        : finalWaiting
          ? "waiting_client"
          : finalDue
            ? "current"
            : "upcoming",
    action:
      finalDone || (!finalWaiting && !finalDue && !finalOverdue)
        ? null
        : {
            kind: "link",
            label: finalOverdue
              ? "Chase payment"
              : finalWaiting
                ? "Check payment status"
                : "Send final invoice",
            href: project("/studio/invoices"),
          },
  });

  const dayBeforeDone = ["approved", "executed"].includes(
    input.dayBeforeDraftStatus ?? "",
  );
  const dayBeforeDue = days !== null && days <= 2 && days >= 0;
  push({
    key: "day_before",
    title: "Day-before checklist",
    detail: dayBeforeDone
      ? "Sent — saves 20 minutes on site"
      : "Dress, shoes, flowers, rings, invitations ready",
    status: dayBeforeDone ? "complete" : dayBeforeDue ? "current" : "upcoming",
    action:
      dayBeforeDone || !dayBeforeDue
        ? null
        : input.dayBeforeDraftStatus === "review_required"
          ? { kind: "link", label: "Approve the checklist", href: "/studio/ai-queue" }
          : {
              kind: "draft",
              label: "Draft the checklist",
              trigger: "day_before_checklist",
            },
  });

  push({
    key: "event_day",
    title: "Event day",
    detail: afterEvent || stateRank >= 8 ? "Covered" : input.eventDate ?? "Date pending",
    status: afterEvent || stateRank >= 8 ? "complete" : "upcoming",
    action: null,
  });

  const deliveryDone = input.hasDelivery || stateRank >= 10;
  push({
    key: "delivery",
    title: "Gallery delivered",
    detail: deliveryDone
      ? "Delivered with follow-ups running"
      : "Record the gallery — the email drafts itself",
    status: deliveryDone
      ? "complete"
      : afterEvent || stateRank >= 8
        ? "current"
        : "upcoming",
    action:
      deliveryDone || !(afterEvent || stateRank >= 8)
        ? null
        : { kind: "link", label: "Record delivery", href: "/studio/delivery" },
  });

  push({
    key: "album_review",
    title: "Album & review",
    detail: input.albumOrReviewDone
      ? "Selections and review requested"
      : "Selection reminders, then a Google review ask",
    status: input.albumOrReviewDone
      ? "complete"
      : deliveryDone
        ? "current"
        : "upcoming",
    action:
      input.albumOrReviewDone || !deliveryDone
        ? null
        : {
            kind: "draft",
            label: "Draft the review request",
            trigger: "review_request",
          },
  });

  // Exactly one current step: the first one. Later "current" steps stay
  // visible but wait their turn, so the page always has one primary action.
  let currentFound = false;
  for (const step of steps) {
    if (step.status === "current") {
      if (currentFound) {
        step.status = "upcoming";
        step.action = null;
      } else {
        currentFound = true;
      }
    }
  }

  // Every step is a door: fill in where its record lives, who owns it right
  // now, and — for upcoming steps — what unlocks it.
  const recordHrefs: Record<
    JourneyStepKey,
    { label: string; href: string } | null
  > = {
    inquiry: input.lead
      ? { label: "Open inquiry", href: `/studio/leads/${input.lead.id}` }
      : null,
    first_reply: input.lead
      ? { label: "Open inquiry", href: `/studio/leads/${input.lead.id}` }
      : null,
    consultation: { label: "Open calendar", href: project("/studio/calendar") },
    proposal: { label: "Open proposal", href: project("/studio/proposals") },
    contract: { label: "Open contract", href: project("/studio/booking") },
    retainer: { label: "Open retainer", href: project("/studio/booking") },
    schedule_form: {
      label: "Open form",
      href: project("/studio/questionnaires"),
    },
    run_of_show: { label: "Open schedule", href: project("/studio/schedules") },
    crew: { label: "Open crew", href: project("/studio/crew") },
    coi: { label: "Open insurance", href: project("/studio/insurance") },
    final_balance: { label: "Open invoices", href: project("/studio/invoices") },
    day_before: { label: "Open review queue", href: "/studio/ai-queue" },
    event_day: { label: "Open event day", href: project("/studio/event-day") },
    delivery: { label: "Open delivery", href: project("/studio/delivery") },
    album_review: { label: "Open reviews", href: project("/studio/reviews") },
  };
  const unlockCopy: Partial<Record<JourneyStepKey, string>> = {
    final_balance: "Unlocks about 45 days before the event.",
    day_before: "Unlocks two days before the event.",
    event_day: input.eventDate
      ? `The live plan opens on ${input.eventDate}.`
      : "Set an event date to plan the day.",
    delivery: "Unlocks after the event is covered.",
    album_review: "Unlocks after the gallery is delivered.",
  };
  for (const step of steps) {
    step.record = step.record ?? recordHrefs[step.key];
    if (step.status === "waiting_client") step.owner = "client";
    else if (step.status === "waiting_other") step.owner = "provider";
    else if (step.status === "current") step.owner = "studio";
    else step.owner = null;
    step.unlock =
      step.status === "upcoming"
        ? (unlockCopy[step.key] ?? "Unlocks when the steps above are done.")
        : null;
    if (step.status !== "current") step.advance = null;
  }

  return { steps, current: steps.find((step) => step.status === "current") ?? null };
}
