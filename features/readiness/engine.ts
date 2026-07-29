import type { Checkpoint } from "@/features/checkpoints/schema";
import {
  readinessAssessmentSchema,
  type ReadinessAssessment,
  type readinessItemSchema,
} from "./schema";
import type { z } from "zod";

type ReadinessItem = z.infer<typeof readinessItemSchema>;

const satisfiedStatuses = new Set(["complete", "waived"]);

function activeWaiver(checkpoint: Checkpoint, now: Date): boolean {
  return checkpoint.status === "waived"
    && (!checkpoint.waiverExpiresAt || new Date(checkpoint.waiverExpiresAt) > now);
}

function isSatisfied(checkpoint: Checkpoint, now: Date): boolean {
  return checkpoint.status === "complete" || activeWaiver(checkpoint, now);
}

function toItem(checkpoint: Checkpoint, reason: string): ReadinessItem {
  return {
    checkpointId: checkpoint.id,
    name: checkpoint.name,
    status: checkpoint.status,
    ownerType: checkpoint.ownerType,
    dueDate: checkpoint.resolvedDueDate,
    reason,
  };
}

export function calculateReadiness(input: {
  id: string;
  tenantId: string;
  projectId: string;
  workflowRunId: string | null;
  checkpoints: readonly Checkpoint[];
  calculatedAt: string;
  actorId?: string;
  rulesVersion?: number;
}): ReadinessAssessment {
  const now = new Date(input.calculatedAt);
  const today = input.calculatedAt.slice(0, 10);
  const riskDate = new Date(`${today}T12:00:00.000Z`);
  riskDate.setUTCDate(riskDate.getUTCDate() + 7);
  const riskDateValue = riskDate.toISOString().slice(0, 10);
  const required = input.checkpoints.filter((checkpoint) => checkpoint.blocking);
  const satisfiedRequired = required.filter((checkpoint) =>
    isSatisfied(checkpoint, now),
  );

  const blockingItems = required
    .filter((checkpoint) => !isSatisfied(checkpoint, now))
    .map((checkpoint) =>
      toItem(
        checkpoint,
        checkpoint.status === "waived"
          ? "Waiver expired"
          : checkpoint.status === "failed"
            ? "Required checkpoint failed"
            : "Required checkpoint is incomplete",
      ),
    );
  const overdueItems = input.checkpoints
    .filter(
      (checkpoint) =>
        !satisfiedStatuses.has(checkpoint.status)
        && checkpoint.resolvedDueDate !== null
        && checkpoint.resolvedDueDate < today,
    )
    .map((checkpoint) => toItem(checkpoint, "Past its resolved due date"));
  const atRiskItems = input.checkpoints
    .filter(
      (checkpoint) =>
        !satisfiedStatuses.has(checkpoint.status)
        && checkpoint.resolvedDueDate !== null
        && checkpoint.resolvedDueDate >= today
        && checkpoint.resolvedDueDate <= riskDateValue,
    )
    .map((checkpoint) => toItem(checkpoint, "Due within seven days"));
  const score =
    required.length === 0
      ? 0
      : Math.round((satisfiedRequired.length / required.length) * 100);
  const primary = overdueItems[0] ?? blockingItems[0] ?? atRiskItems[0];
  const configured = required.length > 0;
  const actorId = input.actorId ?? "readiness-engine";

  return readinessAssessmentSchema.parse({
    id: input.id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    workflowRunId: input.workflowRunId,
    score,
    ready: configured && blockingItems.length === 0,
    totalRequired: required.length,
    satisfiedRequired: satisfiedRequired.length,
    blockingItems,
    overdueItems,
    atRiskItems,
    recommendedNextAction: !configured
      ? "Set up required readiness checkpoints"
      : primary
      ? `${primary.name} · ${primary.ownerType}`
      : "No readiness blockers",
    calculatedAt: input.calculatedAt,
    rulesVersion: input.rulesVersion ?? 1,
    createdAt: input.calculatedAt,
    updatedAt: input.calculatedAt,
    createdBy: actorId,
    updatedBy: actorId,
    archivedAt: null,
  });
}
