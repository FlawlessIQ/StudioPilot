import assert from "node:assert/strict";
import test from "node:test";
import type { AuditEvent } from "@/features/audit/schema";
import type { Project } from "@/features/projects/schema";
import {
  ProjectService,
  type AuditStore,
  type ProjectReadinessStore,
  type ProjectStore,
} from "@/server/services/project-service";
import { workflowProject, workflowTimestamp } from "./fixtures/workflow";

class MemoryProjectStore implements ProjectStore {
  project: Project = { ...workflowProject, state: "PLANNING", stateVersion: 2 };
  async create(project: Project) {
    this.project = project;
    return project;
  }
  async getById(tenantId: string, projectId: string) {
    return this.project.tenantId === tenantId && this.project.id === projectId
      ? this.project
      : null;
  }
  async updateWithVersion(
    tenantId: string,
    projectId: string,
    version: number,
    changes: Partial<Project>,
  ) {
    if (tenantId !== this.project.tenantId || projectId !== this.project.id) {
      throw new Error("Project not found.");
    }
    if (version !== this.project.stateVersion) throw new Error("Version conflict.");
    this.project = { ...this.project, ...changes, stateVersion: version + 1 };
    return this.project;
  }
}

class MemoryAuditStore implements AuditStore {
  events: AuditEvent[] = [];
  async append(event: AuditEvent) {
    this.events.push(event);
  }
}

const context = {
  userId: "owner",
  tenantId: "tenant-a",
  membershipTenantId: "tenant-a",
  role: "studio_owner" as const,
};

test("generic project transition cannot claim READY without readiness evidence", async () => {
  const projects = new MemoryProjectStore();
  const readiness: ProjectReadinessStore = { async isReady() { return false; } };
  const service = new ProjectService(
    projects,
    new MemoryAuditStore(),
    () => "id-1",
    () => workflowTimestamp,
    readiness,
  );
  await assert.rejects(
    service.transition(context, "project-1", 2, "READY", "correlation"),
    /readiness evidence/i,
  );
  assert.equal(projects.project.state, "PLANNING");
});

test("READY remains evidence-controlled even when readiness passes", async () => {
  const projects = new MemoryProjectStore();
  const audits = new MemoryAuditStore();
  const readiness: ProjectReadinessStore = { async isReady() { return true; } };
  const service = new ProjectService(
    projects,
    audits,
    () => "audit-1",
    () => workflowTimestamp,
    readiness,
  );
  await assert.rejects(
    service.transition(
      context,
      "project-1",
      2,
      "READY",
      "correlation",
    ),
    /readiness evidence/i,
  );
  assert.equal(audits.events.length, 0);
});

test("manual project transitions cannot bypass the booking gate", async () => {
  const projects = new MemoryProjectStore();
  projects.project = {
    ...projects.project,
    state: "RETAINER_PENDING",
    stateVersion: 4,
  };
  const service = new ProjectService(
    projects,
    new MemoryAuditStore(),
    () => "audit-1",
    () => workflowTimestamp,
  );

  await assert.rejects(
    service.transition(
      context,
      "project-1",
      4,
      "BOOKED",
      "correlation",
    ),
    /booking gate evidence/i,
  );
  assert.equal(projects.project.state, "RETAINER_PENDING");
});
