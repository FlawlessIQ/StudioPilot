import type { AuditEvent } from "@/features/audit/schema";
import { authorize, type AuthorizationContext } from "@/features/auth/authorize";
import {
  checkpointSchema,
  type Checkpoint,
} from "@/features/checkpoints/schema";

export interface CheckpointMutationStore {
  getById(tenantId: string, checkpointId: string): Promise<Checkpoint | null>;
  getMany(tenantId: string, checkpointIds: readonly string[]): Promise<Checkpoint[]>;
  update(checkpoint: Checkpoint, audit: AuditEvent): Promise<void>;
}

export class CheckpointService {
  constructor(
    private readonly store: CheckpointMutationStore,
    private readonly createId: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async complete(
    context: AuthorizationContext,
    checkpointId: string,
    evidence: Checkpoint["evidence"],
    notes: string | null,
    correlationId: string,
  ): Promise<Checkpoint> {
    authorize(context, "checkpoints.complete");
    const checkpoint = await this.requireCheckpoint(context, checkpointId);
    if (checkpoint.status === "complete") return checkpoint;
    const dependencies = await this.store.getMany(
      context.tenantId,
      checkpoint.dependencyIds,
    );
    if (dependencies.some((dependency) => !["complete", "waived"].includes(dependency.status))) {
      throw new Error("Checkpoint dependencies are incomplete.");
    }
    if (checkpoint.requiredEvidence.length > 0 && evidence.length === 0) {
      throw new Error("Checkpoint evidence is required.");
    }
    const timestamp = this.now();
    const updated = checkpointSchema.parse({
      ...checkpoint,
      status: "complete",
      completionTimestamp: timestamp,
      completionActorId: context.userId,
      evidence,
      notes,
      waiverReason: null,
      waiverExpiresAt: null,
      updatedAt: timestamp,
      updatedBy: context.userId,
    });
    await this.store.update(
      updated,
      this.audit(context, checkpoint, updated, correlationId, "checkpoint.completed"),
    );
    return updated;
  }

  async waive(
    context: AuthorizationContext,
    checkpointId: string,
    reason: string,
    expiresAt: string | null,
    correlationId: string,
  ): Promise<Checkpoint> {
    authorize(context, "checkpoints.waive");
    if (reason.trim().length < 10) throw new Error("A waiver reason is required.");
    const checkpoint = await this.requireCheckpoint(context, checkpointId);
    if (!checkpoint.waiverAllowed) throw new Error("This checkpoint cannot be waived.");
    const timestamp = this.now();
    const updated = checkpointSchema.parse({
      ...checkpoint,
      status: "waived",
      completionTimestamp: timestamp,
      completionActorId: context.userId,
      waiverReason: reason.trim(),
      waiverExpiresAt: expiresAt,
      updatedAt: timestamp,
      updatedBy: context.userId,
    });
    await this.store.update(
      updated,
      this.audit(context, checkpoint, updated, correlationId, "checkpoint.waived"),
    );
    return updated;
  }

  private async requireCheckpoint(
    context: AuthorizationContext,
    checkpointId: string,
  ): Promise<Checkpoint> {
    const checkpoint = await this.store.getById(context.tenantId, checkpointId);
    if (!checkpoint) throw new Error("Checkpoint not found.");
    if (checkpoint.projectId && context.allowedProjectIds?.length) {
      if (!context.allowedProjectIds.includes(checkpoint.projectId)) {
        throw new Error("Checkpoint project access denied.");
      }
    }
    return checkpoint;
  }

  private audit(
    context: AuthorizationContext,
    before: Checkpoint,
    after: Checkpoint,
    correlationId: string,
    action: string,
  ): AuditEvent {
    return {
      id: this.createId(),
      tenantId: context.tenantId,
      projectId: before.projectId,
      actorId: context.userId,
      actorType: "user",
      action,
      entityType: "checkpoint",
      entityId: before.id,
      timestamp: after.updatedAt,
      before: { status: before.status },
      after: {
        status: after.status,
        waiverReason: after.waiverReason,
        evidenceCount: after.evidence.length,
      },
      ipAddress: null,
      userAgent: null,
      correlationId,
      automationRunId: null,
      providerEventId: null,
    };
  }
}
