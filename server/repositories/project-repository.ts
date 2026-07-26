import type { Firestore } from "firebase-admin/firestore";
import { projectSchema, type Project } from "@/features/projects/schema";
import { TenantRepository } from "./base-repository";

export class ProjectsRepository extends TenantRepository<Project> {
  constructor(firestore: Firestore) {
    super(firestore, "projects", projectSchema);
  }

  async listUpcoming(tenantId: string, fromDate: string, limit = 50): Promise<Project[]> {
    const snapshot = await this.collection
      .where("tenantId", "==", tenantId)
      .where("archivedAt", "==", null)
      .where("eventDate", ">=", fromDate)
      .orderBy("eventDate", "asc")
      .limit(Math.min(limit, 100))
      .get();
    return snapshot.docs.map((document) =>
      projectSchema.parse({ id: document.id, ...document.data() }),
    );
  }

  async updateWithVersion(
    tenantId: string,
    id: string,
    stateVersion: number,
    changes: Partial<Project>,
  ): Promise<Project> {
    const reference = this.collection.doc(id);
    return reference.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new Error("Project not found.");
      const current = projectSchema.parse({ id: snapshot.id, ...snapshot.data() });
      if (current.tenantId !== tenantId) throw new Error("Project tenant mismatch.");
      if (current.stateVersion !== stateVersion) {
        throw new Error("Project was updated by another user.");
      }
      const next = projectSchema.parse({
        ...current,
        ...changes,
        id: current.id,
        tenantId: current.tenantId,
        projectId: current.projectId,
        stateVersion: current.stateVersion + 1,
      });
      transaction.set(reference, next);
      return next;
    });
  }
}
