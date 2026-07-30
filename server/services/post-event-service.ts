import { addDays, parseISO } from "date-fns";
import type {
  DeliveryRecord,
  PostProductionRecord,
  PostProductionStep,
  ProjectCloseout,
  ReviewRequest,
} from "@/features/post-production/schema";

const orderedSteps: readonly PostProductionStep[] = [
  "backup_complete", "cull_complete", "editing_started", "editing_complete",
  "gallery_ready", "album_proof_ready", "delivery_sent", "client_downloaded",
  "project_archived",
];

export function completePostProductionStep(
  record: PostProductionRecord,
  step: PostProductionStep,
  actorId: string,
  occurredAt: string,
  evidenceId: string | null,
): PostProductionRecord {
  const index = orderedSteps.indexOf(step);
  const requiredPrior = step === "album_proof_ready"
    ? "editing_complete"
    : index > 0 ? orderedSteps[index - 1] : null;
  if (requiredPrior && !record.steps[requiredPrior]?.complete) {
    throw new Error(`POST_PRODUCTION_DEPENDENCY_INCOMPLETE:${requiredPrior}`);
  }
  return {
    ...record,
    steps: {
      ...record.steps,
      [step]: { complete: true, completedAt: occurredAt, completedBy: actorId, evidenceId, notes: null },
    },
    currentStep: orderedSteps[Math.min(index + 1, orderedSteps.length - 1)] ?? step,
    updatedAt: occurredAt,
    updatedBy: actorId,
  };
}

export function assertDeliveryAllowed(record: PostProductionRecord, delivery: DeliveryRecord) {
  if (!record.steps.backup_complete?.complete) throw new Error("BACKUP_NOT_COMPLETE");
  if (!record.steps.editing_complete?.complete) throw new Error("EDITING_NOT_COMPLETE");
  if (!record.steps.gallery_ready?.complete) throw new Error("GALLERY_NOT_READY");
  if (!delivery.galleryUrl.startsWith("https://")) throw new Error("DELIVERY_URL_MUST_USE_HTTPS");
}

export function reviewSchedule(deliveryDate: string) {
  const delivered = parseISO(`${deliveryDate}T12:00:00.000Z`);
  return {
    firstAt: addDays(delivered, 3).toISOString(),
    reminderAt: addDays(delivered, 10).toISOString(),
  };
}

export function reviewReleasePlan(deliveryDate: string) {
  const schedule = reviewSchedule(deliveryDate);
  return [
    {
      sequence: 1,
      channel: "portal" as const,
      scheduledAt: schedule.firstAt,
    },
    {
      sequence: 2,
      channel: "email" as const,
      scheduledAt: schedule.reminderAt,
    },
  ];
}

export function albumReminderDecision(input: {
  workflowStatus: string;
  stopOnStatuses: readonly string[];
  reminderStatus: "scheduled" | "sent" | "skipped";
}) {
  if (input.reminderStatus !== "scheduled")
    return { shouldSend: false, nextStatus: input.reminderStatus };
  if (input.stopOnStatuses.includes(input.workflowStatus))
    return { shouldSend: false, nextStatus: "skipped" as const };
  return { shouldSend: true, nextStatus: "sent" as const };
}

export function recordReviewEngagement(
  request: ReviewRequest,
  event: "delivered" | "opened" | "clicked" | "client_confirmed" | "manually_confirmed",
  actorId: string,
  occurredAt: string,
): ReviewRequest {
  if (["client_confirmed", "manually_confirmed", "skipped"].includes(request.status)) {
    throw new Error("REVIEW_REQUEST_TERMINAL");
  }
  return {
    ...request,
    status: event,
    deliveredAt: event === "delivered" ? occurredAt : request.deliveredAt,
    openedAt: event === "opened" ? occurredAt : request.openedAt,
    clickedAt: event === "clicked" ? occurredAt : request.clickedAt,
    confirmedAt: event.includes("confirmed") ? occurredAt : request.confirmedAt,
    confirmedBy: event.includes("confirmed") ? actorId : request.confirmedBy,
    updatedAt: occurredAt,
    updatedBy: actorId,
  };
}

export function evaluateCloseout(
  closeout: ProjectCloseout,
): ProjectCloseout & { blockers: string[] } {
  const blockers = closeout.requirements
    .filter((requirement) => !requirement.complete)
    .map((requirement) => requirement.label);
  return { ...closeout, status: blockers.length === 0 ? "ready" : "blocked", blockers };
}

export type ReportProject = {
  type: string;
  leadSource: string;
  booked: boolean;
  valueCents: number;
  ready: boolean;
  coiTurnaroundDays: number | null;
  crewAccepted: boolean;
  scheduleRevisions: number;
};

export function aggregateStudioReport(projects: readonly ReportProject[]) {
  const booked = projects.filter((project) => project.booked);
  return {
    inquiries: projects.length,
    bookings: booked.length,
    bookingConversionPercent: projects.length === 0 ? 0 : Math.round((booked.length / projects.length) * 100),
    bookedValueCents: booked.reduce((sum, project) => sum + project.valueCents, 0),
    readyPercent: booked.length === 0 ? 0 : Math.round((booked.filter((project) => project.ready).length / booked.length) * 100),
    crewAcceptancePercent: booked.length === 0 ? 0 : Math.round((booked.filter((project) => project.crewAccepted).length / booked.length) * 100),
    averageScheduleRevisions: booked.length === 0 ? 0 : Number((booked.reduce((sum, project) => sum + project.scheduleRevisions, 0) / booked.length).toFixed(1)),
  };
}
