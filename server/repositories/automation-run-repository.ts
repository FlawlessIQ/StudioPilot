import type { Firestore } from "firebase-admin/firestore";
import {
  automationRunSchema,
  type AutomationRun,
} from "@/features/automation/schema";
import { TenantRepository } from "./base-repository";

export class AutomationRunsRepository extends TenantRepository<AutomationRun> {
  constructor(firestore: Firestore) {
    super(firestore, "automationRuns", automationRunSchema);
  }

  async findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<AutomationRun | null> {
    const snapshot = await this.collection
      .where("tenantId", "==", tenantId)
      .where("idempotencyKey", "==", idempotencyKey)
      .limit(1)
      .get();
    const document = snapshot.docs[0];
    return document
      ? automationRunSchema.parse({ id: document.id, ...document.data() })
      : null;
  }
}
