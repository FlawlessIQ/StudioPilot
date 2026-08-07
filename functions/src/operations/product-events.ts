import { createHash } from "node:crypto";

export type ProductEventName =
  | "handling.session_started"
  | "handling.session_completed"
  | "studio_import.session_created"
  | "studio_import.review_completed"
  | "studio_import.activated"
  | "studio_import.rolled_back"
  | "ai_action.completed"
  | "ai_action.approved"
  | "ai_action.edited"
  | "ai_action.rejected"
  | "ai_action.dismissed"
  | "ai_action.executed"
  | "ai_action.failed"
  | "automation.completed"
  | "automation.cancelled"
  | "automation.retried"
  | "communication.prepared"
  | "communication.queued"
  | "communication.provider_accepted"
  | "communication.delivered"
  | "communication.failed"
  | "lifecycle.consultation_completed"
  | "consultation.capture_completed"
  | "booking.sequence_approved"
  | "booking.retainer_queued"
  | "booking.completed_automatically"
  | "booking.exception_raised"
  | "planning.package_prepared"
  | "event_day.brief_prepared"
  | "delivery.draft_prepared"
  | "lifecycle.schedule_published"
  | "lifecycle.crew_staffed"
  | "lifecycle.gallery_delivered"
  | "lifecycle.album_approved"
  | "lifecycle.review_requested"
  | "lifecycle.coi_chased"
  | "lifecycle.project_closed";

type ProductEventInput = {
  tenantId: string;
  projectId?: string | null;
  actorId: string;
  actorType?: "user" | "client" | "subcontractor" | "system" | "provider";
  name: ProductEventName;
  occurredAt: string;
  correlationId: string;
  sourceEntityType: string;
  sourceEntityId: string;
  properties?: Record<string, unknown>;
  handling?: {
    activeSeconds: number;
    baselineSeconds: number | null;
    verifiedSecondsSaved: number | null;
    measurementMethod:
      | "timer"
      | "workflow_timestamps"
      | "pilot_observation"
      | "owner_estimate";
  } | null;
};

type WorkflowPolicy = {
  workflowStep: true;
  executionMode: "automatic" | "ai_prepared" | "policy_automatic" | "manual";
  humanRole: "none" | "approval" | "exception" | "data_entry" | "routine_execution";
};

const workflowPolicies: Partial<Record<ProductEventName, WorkflowPolicy>> = {
  "ai_action.completed": {
    workflowStep: true,
    executionMode: "ai_prepared",
    humanRole: "none",
  },
  "ai_action.approved": {
    workflowStep: true,
    executionMode: "ai_prepared",
    humanRole: "approval",
  },
  "ai_action.edited": {
    workflowStep: true,
    executionMode: "ai_prepared",
    humanRole: "approval",
  },
  "ai_action.rejected": {
    workflowStep: true,
    executionMode: "ai_prepared",
    humanRole: "approval",
  },
  "ai_action.dismissed": {
    workflowStep: true,
    executionMode: "ai_prepared",
    humanRole: "approval",
  },
  "ai_action.executed": {
    workflowStep: true,
    executionMode: "automatic",
    humanRole: "none",
  },
  "automation.completed": {
    workflowStep: true,
    executionMode: "automatic",
    humanRole: "none",
  },
  "consultation.capture_completed": {
    workflowStep: true,
    executionMode: "automatic",
    humanRole: "none",
  },
  "booking.sequence_approved": {
    workflowStep: true,
    executionMode: "ai_prepared",
    humanRole: "approval",
  },
  "booking.retainer_queued": {
    workflowStep: true,
    executionMode: "automatic",
    humanRole: "none",
  },
  "booking.completed_automatically": {
    workflowStep: true,
    executionMode: "policy_automatic",
    humanRole: "none",
  },
  "booking.exception_raised": {
    workflowStep: true,
    executionMode: "automatic",
    humanRole: "exception",
  },
  "planning.package_prepared": {
    workflowStep: true,
    executionMode: "ai_prepared",
    humanRole: "none",
  },
  "event_day.brief_prepared": {
    workflowStep: true,
    executionMode: "ai_prepared",
    humanRole: "none",
  },
  "delivery.draft_prepared": {
    workflowStep: true,
    executionMode: "automatic",
    humanRole: "none",
  },
  "lifecycle.schedule_published": {
    workflowStep: true,
    executionMode: "ai_prepared",
    humanRole: "approval",
  },
  "lifecycle.crew_staffed": {
    workflowStep: true,
    executionMode: "automatic",
    humanRole: "none",
  },
  "lifecycle.gallery_delivered": {
    workflowStep: true,
    executionMode: "ai_prepared",
    humanRole: "approval",
  },
  "lifecycle.album_approved": {
    workflowStep: true,
    executionMode: "ai_prepared",
    humanRole: "approval",
  },
  "lifecycle.review_requested": {
    workflowStep: true,
    executionMode: "policy_automatic",
    humanRole: "none",
  },
  "lifecycle.project_closed": {
    workflowStep: true,
    executionMode: "ai_prepared",
    humanRole: "approval",
  },
};

export function productEvent(input: ProductEventInput) {
  const id = `product_${createHash("sha256")
    .update(
      [
        input.tenantId,
        input.name,
        input.correlationId,
        input.sourceEntityType,
        input.sourceEntityId,
      ].join(":"),
    )
    .digest("hex")
    .slice(0, 32)}`;
  return {
    id,
    tenantId: input.tenantId,
    projectId: input.projectId ?? null,
    actorId: input.actorId,
    actorType: input.actorType ?? "user",
    name: input.name,
    occurredAt: input.occurredAt,
    correlationId: input.correlationId,
    sourceEntityType: input.sourceEntityType.slice(0, 120),
    sourceEntityId: input.sourceEntityId.slice(0, 240),
    properties: {
      ...(workflowPolicies[input.name] ?? {}),
      ...(input.properties ?? {}),
    },
    handling: input.handling ?? null,
  };
}
