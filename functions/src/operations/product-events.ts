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
  | "lifecycle.schedule_published"
  | "lifecycle.crew_staffed"
  | "lifecycle.gallery_delivered"
  | "lifecycle.album_approved"
  | "lifecycle.review_requested"
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
    properties: input.properties ?? {},
    handling: input.handling ?? null,
  };
}
