import type { AuditEvent } from "@/features/audit/schema";
import { authorize, type AuthorizationContext } from "@/features/auth/authorize";
import { createPackageSnapshot } from "@/features/packages/create-snapshot";
import type {
  PackageSelection,
  PackageSnapshot,
  StudioPackage,
} from "@/features/packages/schema";
import type { Project } from "@/features/projects/schema";
import type { AuditStore } from "./project-service";

export interface PackageSelectionStore {
  getPackage(tenantId: string, packageId: string): Promise<StudioPackage | null>;
  getProject(tenantId: string, projectId: string): Promise<Project | null>;
  createSnapshot(snapshot: PackageSnapshot): Promise<void>;
  attachSnapshot(
    tenantId: string,
    projectId: string,
    expectedVersion: number,
    snapshotId: string,
    actorId: string,
    timestamp: string,
  ): Promise<void>;
}

export class PackageSelectionService {
  constructor(
    private readonly store: PackageSelectionStore,
    private readonly audits: AuditStore,
    private readonly createId: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async select(
    context: AuthorizationContext,
    projectId: string,
    selection: PackageSelection,
    correlationId: string,
  ): Promise<Readonly<PackageSnapshot>> {
    authorize(context, "projects.manage");
    const [studioPackage, project] = await Promise.all([
      this.store.getPackage(context.tenantId, selection.packageId),
      this.store.getProject(context.tenantId, projectId),
    ]);
    if (!studioPackage || !studioPackage.active) throw new Error("Package is unavailable.");
    if (!project) throw new Error("Project not found.");
    if (project.packageSnapshotId) {
      throw new Error("Project already has a package snapshot.");
    }

    const timestamp = this.now();
    const snapshot = createPackageSnapshot({
      id: this.createId(),
      tenantId: context.tenantId,
      projectId,
      selectedBy: context.userId,
      selectedAt: timestamp,
      package: studioPackage,
      selection,
    });
    await this.store.createSnapshot(snapshot as PackageSnapshot);
    await this.store.attachSnapshot(
      context.tenantId,
      projectId,
      project.stateVersion,
      snapshot.id,
      context.userId,
      timestamp,
    );

    const audit: AuditEvent = {
      id: this.createId(),
      tenantId: context.tenantId,
      projectId,
      actorId: context.userId,
      actorType: "user",
      action: "package.selected",
      entityType: "packageSnapshot",
      entityId: snapshot.id,
      timestamp,
      before: null,
      after: {
        packageId: snapshot.packageId,
        packageVersion: snapshot.packageVersion,
        totalCents: snapshot.totalCents,
      },
      ipAddress: null,
      userAgent: null,
      correlationId,
      automationRunId: null,
      providerEventId: null,
    };
    await this.audits.append(audit);
    return snapshot;
  }
}
