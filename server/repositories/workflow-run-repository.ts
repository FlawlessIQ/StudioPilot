import type { Firestore } from "firebase-admin/firestore";
import { workflowRunSchema, type WorkflowRun } from "@/features/workflows/schema";
import { TenantRepository } from "./base-repository";

export class WorkflowRunsRepository extends TenantRepository<WorkflowRun> {
  constructor(firestore: Firestore) {
    super(firestore, "workflowRuns", workflowRunSchema);
  }

  async findActive(tenantId: string, projectId: string): Promise<WorkflowRun | null> {
    const snapshot = await this.collection
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId)
      .where("status", "==", "active")
      .limit(1)
      .get();
    const document = snapshot.docs[0];
    return document
      ? workflowRunSchema.parse({ id: document.id, ...document.data() })
      : null;
  }
}
