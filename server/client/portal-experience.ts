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

function checkpointDestination(name: string) {
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
      current: () => index >= 5 && index <= 7,
      complete: () => index >= 8,
    },
    {
      id: "event",
      label: "Event day",
      description: "Use the final schedule and shared details.",
      current: () => index === 8,
      complete: () => index > 8,
    },
    {
      id: "delivery",
      label: "Delivery",
      description: "Receive and access your finished photographs.",
      current: () => index >= 9 && index <= 11,
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
}: {
  state: string;
  availability: Availability;
  checkpoints: VisibleCheckpoint[];
  proposalStatus?: string | null;
}) {
  const index = stateIndex(state);
  const clientCheckpoint = checkpoints.find(
    (checkpoint) =>
      !["complete", "waived"].includes(checkpoint.status) &&
      (!checkpoint.ownerType ||
        ["client", "contact"].includes(checkpoint.ownerType)),
  );
  const destination = clientCheckpoint
    ? checkpointDestination(clientCheckpoint.name)
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
  const nextClientAction: ClientNextAction = clientCheckpoint
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
    : proposalNextAction ?? defaultNextAction(state);
  const milestones = buildClientMilestones(state);
  const completedMilestones = milestones.filter(
    (milestone) => milestone.status === "complete",
  ).length;

  return {
    clientStage: stageLabels[state] ?? "In progress",
    clientProgress: Math.round(
      (completedMilestones / milestones.length) * 100,
    ),
    nextClientAction,
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
