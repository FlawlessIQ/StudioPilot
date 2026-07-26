import type { AuditEvent } from "@/features/audit/schema";
import { authorize, type AuthorizationContext } from "@/features/auth/authorize";
import { assertProjectTransition } from "@/features/projects/state-machine";
import { projectSchema, type Project, type ProjectState } from "@/features/projects/schema";

export interface ProjectStore {
  create(project: Project): Promise<Project>;
  getById(tenantId: string, projectId: string): Promise<Project | null>;
  updateWithVersion(
    tenantId: string,
    projectId: string,
    stateVersion: number,
    changes: Partial<Project>,
  ): Promise<Project>;
}

export interface AuditStore {
  append(event: AuditEvent): Promise<void>;
}

export class ProjectService {
  constructor(
    private readonly projects: ProjectStore,
    private readonly audits: AuditStore,
    private readonly createId: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async create(
    context: AuthorizationContext,
    input: Omit<
      Project,
      | "id"
      | "projectId"
      | "tenantId"
      | "createdAt"
      | "updatedAt"
      | "createdBy"
      | "updatedBy"
      | "stateVersion"
      | "archivedAt"
    >,
    correlationId: string,
  ): Promise<Project> {
    authorize(context, "projects.manage");
    const timestamp = this.now();
    const projectId = this.createId();
    const project = projectSchema.parse({
      ...input,
      id: projectId,
      projectId,
      tenantId: context.tenantId,
      stateVersion: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: context.userId,
      updatedBy: context.userId,
      archivedAt: null,
    });
    const created = await this.projects.create(project);
    await this.audits.append({
      id: this.createId(),
      tenantId: context.tenantId,
      projectId,
      actorId: context.userId,
      actorType: "user",
      action: "project.created",
      entityType: "project",
      entityId: projectId,
      timestamp,
      before: null,
      after: created,
      ipAddress: null,
      userAgent: null,
      correlationId,
      automationRunId: null,
      providerEventId: null,
    });
    return created;
  }

  async transition(
    context: AuthorizationContext,
    projectId: string,
    expectedVersion: number,
    targetState: ProjectState,
    correlationId: string,
  ): Promise<Project> {
    authorize(context, "projects.manage");
    const current = await this.projects.getById(context.tenantId, projectId);
    if (!current) throw new Error("Project not found.");
    assertProjectTransition(current.state, targetState);
    const timestamp = this.now();
    const updated = await this.projects.updateWithVersion(
      context.tenantId,
      projectId,
      expectedVersion,
      {
        state: targetState,
        updatedAt: timestamp,
        updatedBy: context.userId,
      },
    );
    await this.audits.append({
      id: this.createId(),
      tenantId: context.tenantId,
      projectId,
      actorId: context.userId,
      actorType: "user",
      action: "project.state_changed",
      entityType: "project",
      entityId: projectId,
      timestamp,
      before: { state: current.state, stateVersion: current.stateVersion },
      after: { state: updated.state, stateVersion: updated.stateVersion },
      ipAddress: null,
      userAgent: null,
      correlationId,
      automationRunId: null,
      providerEventId: null,
    });
    return updated;
  }
}
