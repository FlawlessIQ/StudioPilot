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

export type JourneyStep = {
  key: JourneyStepKey;
  title: string;
  detail: string;
  status: JourneyStepStatus;
  action: JourneyAction | null;
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
  questionnaireStatus: string | null;
  scheduleStatus: string | null;
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

export function projectJourney(input: JourneyInput): {
  steps: JourneyStep[];
  current: JourneyStep | null;
} {
  const stateRank = rank(String(input.state));
  const days = daysUntil(input.eventDate, input.today);
  const afterEvent = days !== null && days < 0;
  const project = (suffix: string) => `${suffix}?project=${input.projectId}`;

  const steps: JourneyStep[] = [];

  steps.push({
    key: "inquiry",
    title: "Inquiry received",
    detail: input.lead ? "From your inquiry form" : "Project created",
    status: "complete",
    action: null,
  });

  // First reply only exists when the project came from a lead.
  if (input.lead) {
    const replied = input.lead.status !== "new" || stateRank >= 1;
    steps.push({
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
  steps.push({
    key: "consultation",
    title: "Consultation",
    detail: consulted ? "Meeting booked" : "Find a time that works",
    status: consulted ? "complete" : "current",
    action: consulted
      ? null
      : { kind: "link", label: "Schedule consultation", href: "/studio/calendar" },
  });

  const proposalDone =
    input.proposalStatus === "accepted" || stateRank >= 3;
  const proposalWaiting = ["sent", "viewed"].includes(
    input.proposalStatus ?? "",
  );
  steps.push({
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
          href: project("/studio/proposals"),
        },
  });

  const contractDone = input.contractStatus === "completed" || stateRank >= 4;
  const contractWaiting = [
    "sent",
    "delivered",
    "viewed",
    "partially_signed",
  ].includes(input.contractStatus ?? "");
  steps.push({
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
  steps.push({
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

  const formDone = ["submitted", "locked"].includes(
    input.questionnaireStatus ?? "",
  );
  const formWaiting = ["assigned", "not_started", "in_progress"].includes(
    input.questionnaireStatus ?? "",
  );
  steps.push({
    key: "schedule_form",
    title: "Wedding details form",
    detail: formDone
      ? "Client completed it"
      : formWaiting
        ? "With the client to fill out"
        : "Prep locations, times, and family names",
    status: formDone ? "complete" : formWaiting ? "waiting_client" : "current",
    action: formDone
      ? null
      : {
          kind: "link",
          label: formWaiting ? "Nudge or review" : "Send the form",
          href: project("/studio/questionnaires"),
        },
  });

  const scheduleDone = ["approved", "published"].includes(
    input.scheduleStatus ?? "",
  );
  const scheduleWaiting = ["client_review", "changes_requested"].includes(
    input.scheduleStatus ?? "",
  );
  steps.push({
    key: "run_of_show",
    title: "Run of show",
    detail: scheduleDone
      ? "Approved and shared"
      : scheduleWaiting
        ? "With the client to approve"
        : "Drafted from the form using your timing rules",
    status: scheduleDone
      ? "complete"
      : scheduleWaiting
        ? "waiting_client"
        : "current",
    action: scheduleDone
      ? null
      : {
          kind: "link",
          label: scheduleWaiting ? "Open schedule" : "Draft the schedule",
          href: scheduleWaiting
            ? project("/studio/schedules")
            : `/studio/schedules/new?project=${input.projectId}`,
        },
  });

  const crewDone = input.crewAccepted > 0;
  steps.push({
    key: "crew",
    title: "Crew confirmed",
    detail: crewDone
      ? `${input.crewAccepted} accepted`
      : input.crewCascadeActive
        ? "Offer cascading through your ranked list"
        : "Offer roles in one reviewed cascade",
    status: crewDone
      ? "complete"
      : input.crewCascadeActive
        ? "waiting_other"
        : "current",
    action: crewDone
      ? null
      : {
          kind: "link",
          label: input.crewCascadeActive ? "Watch the cascade" : "Fill crew roles",
          href: project("/studio/crew"),
        },
  });

  const coiDone = ["approved", "sent_to_venue", "venue_acknowledged", "waived"].includes(
    input.coiStatus ?? "",
  );
  const coiWaiting = ["requested", "awaiting_response", "received", "under_review", "correction_required"].includes(
    input.coiStatus ?? "",
  );
  steps.push({
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
  steps.push({
    key: "final_balance",
    title: "Final balance",
    detail: finalDone
      ? "Paid in full"
      : finalWaiting
        ? "Invoice with the client"
        : "Total − retainer, computed exactly · one month out",
    status: finalDone
      ? "complete"
      : finalWaiting
        ? "waiting_client"
        : finalDue
          ? "current"
          : "upcoming",
    action:
      finalDone || (!finalWaiting && !finalDue)
        ? null
        : {
            kind: "link",
            label: finalWaiting ? "Check payment status" : "Send final invoice",
            href: project("/studio/invoices"),
          },
  });

  const dayBeforeDone = ["approved", "executed"].includes(
    input.dayBeforeDraftStatus ?? "",
  );
  const dayBeforeDue = days !== null && days <= 2 && days >= 0;
  steps.push({
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

  steps.push({
    key: "event_day",
    title: "Event day",
    detail: afterEvent || stateRank >= 8 ? "Covered" : input.eventDate ?? "Date pending",
    status: afterEvent || stateRank >= 8 ? "complete" : "upcoming",
    action: null,
  });

  const deliveryDone = input.hasDelivery || stateRank >= 10;
  steps.push({
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

  steps.push({
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

  return { steps, current: steps.find((step) => step.status === "current") ?? null };
}
