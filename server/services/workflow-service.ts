import type { AuditEvent } from "@/features/audit/schema";
import type { AuthorizationContext } from "@/features/auth/authorize";
import { authorize } from "@/features/auth/authorize";
import { checkpointSchema, type Checkpoint } from "@/features/checkpoints/schema";
import type { Project } from "@/features/projects/schema";
import { workflowRunSchema, type WorkflowRun, type WorkflowTemplate } from "@/features/workflows/schema";
import { resolveDueDate } from "@/features/workflows/relative-date";

export interface WorkflowInstantiationStore {
  findActiveRun(tenantId: string, projectId: string): Promise<WorkflowRun | null>;
  createRunWithCheckpoints(
    run: WorkflowRun,
    checkpoints: readonly Checkpoint[],
    audit: AuditEvent,
  ): Promise<void>;
}

export class WorkflowService {
  constructor(
    private readonly store: WorkflowInstantiationStore,
    private readonly createId: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async instantiate(
    context: AuthorizationContext,
    project: Project,
    template: WorkflowTemplate,
    correlationId: string,
    bookingDate: string | null = null,
  ): Promise<{ run: WorkflowRun; checkpoints: readonly Checkpoint[]; existing: boolean }> {
    authorize(context, "workflows.manage", project.id);
    if (project.tenantId !== context.tenantId || template.tenantId !== context.tenantId) {
      throw new Error("Workflow tenant mismatch.");
    }
    if (template.status !== "active") throw new Error("Workflow template is not active.");
    if (template.eventTypeId !== project.eventTypeId) {
      throw new Error("Workflow template does not match the project event type.");
    }

    const existing = await this.store.findActiveRun(context.tenantId, project.id);
    if (existing) return { run: existing, checkpoints: [], existing: true };

    const timestamp = this.now();
    const date = timestamp.slice(0, 10);
    const runId = this.createId();
    const checkpointIds = new Map(
      template.checkpointTemplates.map((checkpoint) => [checkpoint.key, this.createId()]),
    );
    const checkpoints = template.checkpointTemplates.map((definition) => {
      const checkpointId = checkpointIds.get(definition.key);
      if (!checkpointId) throw new Error("Checkpoint identifier could not be allocated.");
      const dependencyIds = definition.dependencies.map((key) => {
        const dependencyId = checkpointIds.get(key);
        if (!dependencyId) throw new Error(`Unknown checkpoint dependency: ${key}`);
        return dependencyId;
      });
      return checkpointSchema.parse({
        id: checkpointId,
        tenantId: context.tenantId,
        projectId: project.id,
        workflowRunId: runId,
        templateKey: definition.key,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        ownerType: definition.ownerType,
        assignedUserId: definition.assignedUserId,
        assignedContactId: definition.assignedContactId,
        dueDateRule: definition.dueDateRule,
        resolvedDueDate: resolveDueDate(definition.dueDateRule, {
          eventDate: project.eventDate,
          projectCreatedDate: project.createdAt.slice(0, 10),
          bookingDate,
          workflowStartedDate: date,
        }),
        visibility: definition.visibility,
        blocking: definition.blocking,
        dependencyIds,
        completionMethod: definition.completionMethod,
        requiredEvidence: definition.requiredEvidence,
        reminderRules: definition.reminderRules,
        escalationRules: definition.escalationRules,
        waiverAllowed: definition.waiverAllowed,
        status: dependencyIds.length === 0 ? "ready" : "not_started",
        completionTimestamp: null,
        completionActorId: null,
        evidence: [],
        notes: null,
        waiverReason: null,
        waiverExpiresAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: context.userId,
        updatedBy: context.userId,
        archivedAt: null,
      });
    });
    const run = workflowRunSchema.parse({
      id: runId,
      tenantId: context.tenantId,
      projectId: project.id,
      workflowTemplateId: template.id,
      workflowVersion: template.version,
      status: "active",
      inputSnapshot: {
        eventDate: project.eventDate,
        eventTypeId: project.eventTypeId,
        projectState: project.state,
        bookingDate,
      },
      templateSnapshot: {
        name: template.name,
        description: template.description,
        eventTypeId: template.eventTypeId,
        eventTypeLabel: template.eventTypeLabel,
        version: template.version,
        checkpointTemplates: template.checkpointTemplates,
        automationRules: template.automationRules,
      },
      checkpointIds: checkpoints.map((checkpoint) => checkpoint.id),
      startedAt: timestamp,
      completedAt: null,
      failureReason: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: context.userId,
      updatedBy: context.userId,
      archivedAt: null,
    });
    const audit: AuditEvent = {
      id: this.createId(),
      tenantId: context.tenantId,
      projectId: project.id,
      actorId: context.userId,
      actorType: "user",
      action: "workflow.instantiated",
      entityType: "workflowRun",
      entityId: runId,
      timestamp,
      before: null,
      after: {
        workflowTemplateId: template.id,
        workflowVersion: template.version,
        checkpointCount: checkpoints.length,
      },
      ipAddress: null,
      userAgent: null,
      correlationId,
      automationRunId: null,
      providerEventId: null,
    };
    await this.store.createRunWithCheckpoints(run, checkpoints, audit);
    return { run, checkpoints, existing: false };
  }
}
