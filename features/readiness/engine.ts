import type { Checkpoint } from "@/features/checkpoints/schema";
import {
  readinessAssessmentSchema,
  type ReadinessAssessment,
  type readinessItemSchema,
} from "./schema";
import type { z } from "zod";
import {
  checkpointIsRequired,
  checkpointIsSatisfied,
  readinessScore,
} from "@/features/readiness/score";
import {
  noReadinessEvidence,
  type ReadinessEvidence,
} from "./checkpoint-evidence";

type ReadinessItem = z.infer<typeof readinessItemSchema>;

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
  /** What the project's records already prove. Defaults to nothing proven. */
  evidence?: ReadinessEvidence;
}): ReadinessAssessment {
  const today = input.calculatedAt.slice(0, 10);
  const riskDate = new Date(`${today}T12:00:00.000Z`);
  riskDate.setUTCDate(riskDate.getUTCDate() + 7);
  const riskDateValue = riskDate.toISOString().slice(0, 10);
  const evidence = input.evidence ?? noReadinessEvidence;
  // Shared with the display summary and the server. See ./score.ts.
  const scored = readinessScore(input.checkpoints, input.calculatedAt, evidence);
  const required = input.checkpoints.filter(checkpointIsRequired);
  const satisfiedRequired = required.filter((checkpoint) =>
    checkpointIsSatisfied(checkpoint, input.calculatedAt, evidence),
  );

  const blockingItems = required
    .filter(
      (checkpoint) =>
        !checkpointIsSatisfied(checkpoint, input.calculatedAt, evidence),
    )
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
  /**
   * Evidence counts here too.
   *
   * These tested `satisfiedStatuses.has(checkpoint.status)` — the stored
   * status alone — while the server's copy of this function used the full
   * predicate. So a checkpoint proven by the project's own records was listed
   * as overdue by the app and as satisfied by the server, on the same job. The
   * extraction of ./score.ts is what surfaced it.
   */
  const overdueItems = input.checkpoints
    .filter(
      (checkpoint) =>
        !checkpointIsSatisfied(checkpoint, input.calculatedAt, evidence)
        && checkpoint.resolvedDueDate !== null
        && checkpoint.resolvedDueDate < today,
    )
    .map((checkpoint) => toItem(checkpoint, "Past its resolved due date"));
  const atRiskItems = input.checkpoints
    .filter(
      (checkpoint) =>
        !checkpointIsSatisfied(checkpoint, input.calculatedAt, evidence)
        && checkpoint.resolvedDueDate !== null
        && checkpoint.resolvedDueDate >= today
        && checkpoint.resolvedDueDate <= riskDateValue,
    )
    .map((checkpoint) => toItem(checkpoint, "Due within seven days"));
  // `tracked: false` becomes a stored 0 here, because the assessment record's
  // schema has no third state. Readers must use `configured` to tell "nothing
  // required yet" from "nothing satisfied" — see ./score.ts.
  const score = scored.percent;
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
