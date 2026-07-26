import type { Firestore } from "firebase-admin/firestore";
import { checkpointSchema, type Checkpoint } from "@/features/checkpoints/schema";
import { TenantRepository } from "./base-repository";

export class CheckpointsRepository extends TenantRepository<Checkpoint> {
  constructor(firestore: Firestore) {
    super(firestore, "checkpoints", checkpointSchema);
  }

  async listForProject(tenantId: string, projectId: string): Promise<Checkpoint[]> {
    const snapshot = await this.collection
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId)
      .where("archivedAt", "==", null)
      .get();
    return snapshot.docs.map((document) =>
      checkpointSchema.parse({ id: document.id, ...document.data() }),
    );
  }
}
