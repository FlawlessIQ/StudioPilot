export const clientProjectStates = [
  "LEAD",
  "CONSULTATION",
  "PROPOSAL",
  "CONTRACT_PENDING",
  "RETAINER_PENDING",
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
  "CLOSED",
] as const;

export type ClientNavigation = {
  proposal: boolean;
  package: boolean;
  contract: boolean;
  payments: boolean;
  questionnaire: boolean;
  schedule: boolean;
  files: boolean;
  delivery: boolean;
  reviews: boolean;
};

export type ClientMilestone = {
  id: string;
  label: string;
  description: string;
  status: "complete" | "current" | "upcoming";
};

export type ClientNextAction = {
  name: string;
  description: string;
  dueDate: string | null;
  ownerType: string | null;
  responsibility: "client" | "studio";
  href: string;
  actionLabel: string;
};

type Availability = Partial<Record<
  | "package"
  | "proposal"
  | "contract"
  | "payments"
  | "questionnaire"
  | "schedule"
  | "files"
  | "delivery"
  | "reviews",
  boolean
>>;

type VisibleCheckpoint = {
  name: string;
  description: string | null;
  status: string;
  dueDate: string | null;
  ownerType: string | null;
  actionHref?: string | null;
  actionLabel?: string | null;
};

const stageLabels: Record<string, string> = {
  LEAD: "Getting started",
  CONSULTATION: "Consultation",
  PROPOSAL: "Reviewing your proposal",
  CONTRACT_PENDING: "Agreement",
  RETAINER_PENDING: "Booking",
  BOOKED: "Booked",
  PLANNING: "Planning",
  READY: "Ready for your event",
  EVENT_COMPLETE: "Event complete",
  POST_PRODUCTION: "Photographs in production",
  DELIVERED: "Delivered",
  REVIEW_REQUESTED: "After delivery",
  CLOSED: "Complete",
  CANCELLED: "Cancelled",
  POSTPONED: "Postponed",
  ARCHIVED: "Archived",
};

function stateIndex(state: string) {
  const index = clientProjectStates.indexOf(
    state as (typeof clientProjectStates)[number],
  );
  return index < 0 ? 0 : index;
}

const clientDestinations = new Set([
  "/client/project",
  "/client/proposal",
  "/client/package",
  "/client/contract",
  "/client/payments",
  "/client/questionnaire",
  "/client/schedule",
  "/client/documents",
  "/client/messages",
  "/client/delivery",
  "/client/reviews",
]);

function checkpointDestination(checkpoint: VisibleCheckpoint) {
  if (
    checkpoint.actionHref &&
    clientDestinations.has(checkpoint.actionHref)
  ) {
    return {
      href: checkpoint.actionHref,
      actionLabel: checkpoint.actionLabel?.trim() || "Open this step",
    };
  }
  const name = checkpoint.name;
  if (/questionnaire|form|family|vendor/i.test(name)) {
    return { href: "/client/questionnaire", actionLabel: "Open questionnaire" };
  }
  if (/schedule|timeline/i.test(name)) {
    return { href: "/client/schedule", actionLabel: "Review schedule" };
  }
  if (/contract|agreement|sign/i.test(name)) {
    return { href: "/client/contract", actionLabel: "Review contract" };
  }
  if (/invoice|payment|retainer|balance/i.test(name)) {
    return { href: "/client/payments", actionLabel: "View payments" };
  }
  if (/proposal|offer/i.test(name)) {
    return { href: "/client/proposal", actionLabel: "Review proposal" };
  }
  if (/package/i.test(name)) {
    return { href: "/client/package", actionLabel: "Review package" };
  }
  return { href: "/client/project", actionLabel: "View project" };
}

function defaultNextAction(state: string): ClientNextAction {
  const defaults: Record<string, ClientNextAction> = {
    LEAD: {
      name: "Your studio is reviewing your inquiry",
      description:
        "No action is needed from you right now. Your studio will share the next step when it is ready.",
      dueDate: null,
      ownerType: "studio",
      responsibility: "studio",
      href: "/client/project",
      actionLabel: "View project details",
    },
    CONSULTATION: {
      name: "Review your consultation details",
      description:
        "Check the details your studio has shared and send a message if anything needs to change.",
      dueDate: null,
      ownerType: "client",
      responsibility: "client",
      href: "/client/project",
      actionLabel: "Review details",
    },
    PROPOSAL: {
      name: "Review your proposal",
      description:
        "Review the exact coverage, price, payment schedule, and terms your studio prepared.",
      dueDate: null,
      ownerType: "client",
      responsibility: "client",
      href: "/client/proposal",
      actionLabel: "Review proposal",
    },
    CONTRACT_PENDING: {
      name: "Review your agreement",
      description:
        "Open your contract to review its current signing status and next step.",
      dueDate: null,
      ownerType: "client",
      responsibility: "client",
      href: "/client/contract",
      actionLabel: "Review contract",
    },
    RETAINER_PENDING: {
      name: "Review your retainer",
      description:
        "Open payments to view the amount, due date, and secure provider link.",
      dueDate: null,
      ownerType: "client",
      responsibility: "client",
      href: "/client/payments",
      actionLabel: "View payments",
    },
    BOOKED: {
      name: "Your date is booked",
      description:
        "Your studio is preparing the planning details you will need next.",
      dueDate: null,
      ownerType: "studio",
      responsibility: "studio",
      href: "/client/project",
      actionLabel: "View project details",
    },
    PLANNING: {
      name: "Continue planning your event",
      description:
        "Review the planning information and complete anything your studio has shared.",
      dueDate: null,
      ownerType: "client",
      responsibility: "client",
      href: "/client/questionnaire",
      actionLabel: "Continue planning",
    },
    READY: {
      name: "Review the final schedule",
      description:
        "Your event plan is ready. Keep the latest schedule handy for event day.",
      dueDate: null,
      ownerType: "client",
      responsibility: "client",
      href: "/client/schedule",
      actionLabel: "View schedule",
    },
    EVENT_COMPLETE: {
      name: "Your studio is backing up your photographs",
      description:
        "No action is needed while your studio secures and prepares your images.",
      dueDate: null,
      ownerType: "studio",
      responsibility: "studio",
      href: "/client/project",
      actionLabel: "View project",
    },
    POST_PRODUCTION: {
      name: "Your photographs are in production",
      description:
        "Your studio is working on your final photographs and will notify you when delivery is ready.",
      dueDate: null,
      ownerType: "studio",
      responsibility: "studio",
      href: "/client/project",
      actionLabel: "View project",
    },
    DELIVERED: {
      name: "Your photographs are ready",
      description: "Open your delivery to access the gallery shared by your studio.",
      dueDate: null,
      ownerType: "client",
      responsibility: "client",
      href: "/client/delivery",
      actionLabel: "Open delivery",
    },
    REVIEW_REQUESTED: {
      name: "Share your experience",
      description:
        "Your studio would appreciate hearing about your experience.",
      dueDate: null,
      ownerType: "client",
      responsibility: "client",
      href: "/client/reviews",
      actionLabel: "View review options",
    },
  };
  return defaults[state] ?? {
    name: state === "CLOSED" ? "Your project is complete" : "View your project",
    description:
      state === "CLOSED"
        ? "Your project information remains available here for your records."
        : "Review the latest information your studio has shared.",
    dueDate: null,
    ownerType: "studio",
    responsibility: "studio",
    href: "/client/project",
    actionLabel: "View project",
  };
}

export function buildClientMilestones(state: string): ClientMilestone[] {
  const index = stateIndex(state);
  const definitions = [
    {
      id: "inquiry",
      label: "Inquiry received",
      description: "Your project request is securely on file.",
      current: () => false,
      complete: () => true,
    },
    {
      id: "consultation",
      label: "Consultation",
      description: "Align on your plans, priorities, and coverage.",
      current: () => index <= 1,
      complete: () => index > 1,
    },
    {
      id: "booking",
      label: "Booking",
      description: "Review your offer, agreement, and retainer.",
      current: () => index >= 2 && index <= 4,
      complete: () => index >= 5,
    },
    {
      id: "planning",
      label: "Planning",
      description: "Complete details and approve the event plan.",
      // READY (7) belongs to the event milestone, not to planning: two
      // milestones read "current" at once before this.
      current: () => index >= 5 && index <= 6,
      complete: () => index >= 7,
    },
    {
      /**
       * `EVENT_COMPLETE` is index 8, and this milestone treated 8 as *current*
       * — so a couple whose wedding had been shot thirteen days earlier opened
       * their portal to "NOW · Event day · Use the final schedule and shared
       * details", directly beneath a hero saying the studio was backing up
       * their photographs. The state is named for the event having happened;
       * reaching it completes this milestone and starts the next.
       */
      id: "event",
      label: "Event day",
      description: "Use the final schedule and shared details.",
      current: () => index === 7,
      complete: () => index >= 8,
    },
    {
      id: "delivery",
      label: "Delivery",
      description: "Receive and access your finished photographs.",
      current: () => index >= 8 && index <= 11,
      complete: () => index >= 12,
    },
  ];
  return definitions.map((milestone) => ({
    id: milestone.id,
    label: milestone.label,
    description: milestone.description,
    status: milestone.complete()
      ? "complete"
      : milestone.current()
        ? "current"
        : "upcoming",
  }));
}

export function buildClientPortalExperience({
  state,
  availability,
  checkpoints,
  proposalStatus,
  outstandingBalance,
  eventDate = null,
  today = null,
  currentSchedule = null,
  questionnaireStatus = null,
}: {
  state: string;
  availability: Availability;
  checkpoints: VisibleCheckpoint[];
  proposalStatus?: string | null;
  /**
   * The day itself, and which day it is. Both optional so existing callers
   * keep working; supplying them is what lets this function know that a
   * wedding is over.
   *
   * It did not know. It derived "past" from the *stage* — whether a gating
   * milestone was complete, i.e. whether the studio had advanced the project
   * — and never from the calendar. So nineteen days after a wedding still
   * marked PLANNING, the portal's next action was "Continue planning your
   * event" and the questionnaire asked the couple for the ceremony time of a
   * day already shot. The Overview printed "19 days since your day" from
   * this very date, and used it for that counter and nothing else.
   *
   * The studio's own UI reconciles the two ("Did this go ahead? The date
   * passed N days ago and this job is still marked planning"). The couple is
   * the wrong person to ask about a stale stage, so past the date the
   * planning asks simply stop.
   *
   * Plain calendar dates, YYYY-MM-DD, compared as strings — the same way the
   * route already decides `overdue`, in the job's own timezone.
   */
  eventDate?: string | null;
  today?: string | null;
  /**
   * The run of show as it stands, so a version awaiting the couple's decision
   * becomes their next action.
   *
   * The next action read only client-owned readiness checkpoints, and
   * `schedule-approved` completes for ever on the first approval — so after
   * the studio revised the timeline and sent v4 for review, nothing here
   * knew. The one decision genuinely waiting on the couple was reachable only
   * by typing the URL, while the card pointed them at a questionnaire they
   * had already submitted.
   */
  currentSchedule?: { status: string; version: number } | null;
  /** So the fallback never sends them back to a form they have finished. */
  questionnaireStatus?: string | null;
  /**
   * What the client still owes, if anything. Optional so existing callers keep
   * working, but supplying it changes the priority: money that is past its date
   * outranks anything derived from the project state.
   *
   * Without this a wedding in READY told the couple their next action was
   * "Review the final schedule" while the studio's own next move on the same job
   * was "Chase payment" for $6,265 overdue.
   */
  outstandingBalance?: {
    amountLabel: string;
    dueDate: string | null;
    /** Already formatted for a client to read — never a raw ISO date. */
    dueDateLabel: string | null;
    overdue: boolean;
  } | null;
}) {
  const index = stateIndex(state);
  const eventHasPassed =
    Boolean(eventDate) && Boolean(today) && String(today) > String(eventDate);
  const questionnaireDone = ["submitted", "locked"].includes(
    String(questionnaireStatus ?? ""),
  );
  /**
   * A schedule waiting on the couple outranks everything but overdue money.
   * It is the one thing here that is unambiguously theirs to do, and the one
   * thing the checkpoint path could not see.
   */
  const scheduleAction: ClientNextAction | null =
    currentSchedule?.status === "client_review"
      ? {
          name: "Approve your event-day schedule",
          description: `Version ${currentSchedule.version} of your timeline is ready for you to check. Approve it, or tell your studio what to change.`,
          dueDate: null,
          ownerType: "client",
          responsibility: "client",
          href: "/client/schedule",
          actionLabel: "Review the schedule",
        }
      : null;
  const clientCheckpoint = checkpoints.find(
    (checkpoint) =>
      !["complete", "waived"].includes(checkpoint.status) &&
      (!checkpoint.ownerType ||
        ["client", "contact"].includes(checkpoint.ownerType)) &&
      // Past the day, a planning checkpoint is a question about a wedding
      // that has happened. The guard found this path first: a client-owned
      // "Questionnaire complete" outranked the past-date rule below and
      // asked for the ceremony time of a day already shot.
      !(
        eventHasPassed &&
        checkpointDestination(checkpoint).href === "/client/questionnaire"
      ),
  );
  const destination = clientCheckpoint
    ? checkpointDestination(clientCheckpoint)
    : null;
  const proposalNextAction: ClientNextAction | null =
    state === "PROPOSAL" && proposalStatus === "declined"
      ? {
          name: "Your studio is reviewing your requested changes",
          description:
            "No action is needed while the studio prepares an updated proposal or follows up with you.",
          dueDate: null,
          ownerType: "studio",
          responsibility: "studio",
          href: "/client/proposal",
          actionLabel: "View your request",
        }
      : state === "PROPOSAL" && proposalStatus === "expired"
        ? {
            name: "Ask for an updated proposal",
            description:
              "The current proposal has expired. Send your studio a message before making a decision.",
            dueDate: null,
            ownerType: "client",
            responsibility: "client",
            href: "/client/messages",
            actionLabel: "Message your studio",
          }
        : state === "PROPOSAL" && !availability.proposal
          ? {
              // Project is in the proposal stage, but the studio has not shared a
              // proposal with the client yet — don't tell them to review something
              // the proposal page reports as "still preparing".
              name: "Your studio is preparing your proposal",
              description:
                "No action is needed yet. You’ll be notified as soon as your proposal is ready to review.",
              dueDate: null,
              ownerType: "studio",
              responsibility: "studio",
              href: "/client/project",
              actionLabel: "View project details",
            }
          : null;
  const stateFallback = (() => {
    const fallback = defaultNextAction(state);
    // Past the day, a planning ask is a question about a wedding that has
    // happened. Say what is true instead, and hand it to the studio.
    if (eventHasPassed && ["PLANNING", "READY"].includes(state)) {
      return {
        name: "Your day has been and gone",
        description:
          "Your studio is finishing up on their side. Your photographs will appear here once they are ready — there is nothing you need to do.",
        dueDate: null,
        ownerType: "studio",
        responsibility: "studio",
        href: "/client/project",
        actionLabel: "View project",
      } satisfies ClientNextAction;
    }
    // A finished form is not somewhere to send them back to.
    if (questionnaireDone && fallback.href === "/client/questionnaire") {
      return {
        ...fallback,
        name: "Your details are with the studio",
        description:
          "Thank you — your planning form is in. Your studio will share the event-day schedule for you to approve next.",
        ownerType: "studio",
        responsibility: "studio",
        href: "/client/project",
        actionLabel: "View project",
      } satisfies ClientNextAction;
    }
    return fallback;
  })();
  const nextClientAction: ClientNextAction =
    scheduleAction ??
    (clientCheckpoint
      ? {
          name: clientCheckpoint.name,
          description:
            clientCheckpoint.description ??
            "Open this step to review what your studio needs from you.",
          dueDate: clientCheckpoint.dueDate,
          ownerType: clientCheckpoint.ownerType,
          responsibility: "client",
          href: destination?.href ?? "/client/project",
          actionLabel: destination?.actionLabel ?? "View project",
        }
      : proposalNextAction ?? stateFallback);
  // An overdue balance is the one thing that outranks the state-derived action.
  // Not merely outstanding — an invoice inside its terms is not yet the client's
  // problem — but past its date, which is when the studio starts chasing.
  const balanceAction: ClientNextAction | null =
    outstandingBalance?.overdue
      ? {
          name: "Settle your outstanding balance",
          description: `${outstandingBalance.amountLabel} is past its due date${
            outstandingBalance.dueDateLabel
              ? ` of ${outstandingBalance.dueDateLabel}`
              : ""
          }. Pay it here, or message your studio if something needs changing.`,
          dueDate: outstandingBalance.dueDate,
          ownerType: "client",
          responsibility: "client",
          href: "/client/payments",
          actionLabel: "View payments",
        }
      : null;
  const milestones = buildClientMilestones(state);
  const completedMilestones = milestones.filter(
    (milestone) => milestone.status === "complete",
  ).length;

  return {
    clientStage: stageLabels[state] ?? "In progress",
    clientProgress: Math.round(
      (completedMilestones / milestones.length) * 100,
    ),
    nextClientAction: balanceAction ?? nextClientAction,
    milestones,
    navigation: {
      proposal: Boolean(availability.proposal || index === 2),
      package: Boolean(
        availability.package && index >= 3,
      ),
      contract: Boolean(availability.contract || index >= 3),
      payments: Boolean(availability.payments || index >= 4),
      questionnaire: Boolean(availability.questionnaire || index >= 5),
      schedule: Boolean(availability.schedule || index >= 5),
      files: Boolean(availability.files),
      delivery: Boolean(availability.delivery || index >= 9),
      reviews: Boolean(availability.reviews || index >= 11),
    } satisfies ClientNavigation,
  };
}
