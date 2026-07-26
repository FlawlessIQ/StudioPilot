import type { Firestore } from "firebase-admin/firestore";
import { leadSchema, type Lead } from "@/features/leads/schema";
import { TenantRepository } from "./base-repository";

export class LeadsRepository extends TenantRepository<Lead> {
  constructor(firestore: Firestore) {
    super(firestore, "leads", leadSchema);
  }

  async findDuplicate(tenantId: string, duplicateKey: string): Promise<Lead | null> {
    const snapshot = await this.collection
      .where("tenantId", "==", tenantId)
      .where("duplicateKey", "==", duplicateKey)
      .where("archivedAt", "==", null)
      .limit(1)
      .get();
    const document = snapshot.docs[0];
    return document
      ? leadSchema.parse({ id: document.id, ...document.data() })
      : null;
  }

  async listPipeline(tenantId: string, limit = 100): Promise<Lead[]> {
    const snapshot = await this.collection
      .where("tenantId", "==", tenantId)
      .where("archivedAt", "==", null)
      .orderBy("createdAt", "desc")
      .limit(Math.min(limit, 100))
      .get();
    return snapshot.docs.map((document) =>
      leadSchema.parse({ id: document.id, ...document.data() }),
    );
  }
}
