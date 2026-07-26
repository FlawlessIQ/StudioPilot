import type { Firestore } from "firebase-admin/firestore";
import {
  workflowTemplateSchema,
  type WorkflowTemplate,
} from "@/features/workflows/schema";
import { TenantRepository } from "./base-repository";

export class WorkflowTemplatesRepository extends TenantRepository<WorkflowTemplate> {
  constructor(firestore: Firestore) {
    super(firestore, "workflowTemplates", workflowTemplateSchema);
  }

  async getActiveForEventType(
    tenantId: string,
    eventTypeId: string,
  ): Promise<WorkflowTemplate | null> {
    const snapshot = await this.collection
      .where("tenantId", "==", tenantId)
      .where("eventTypeId", "==", eventTypeId)
      .where("status", "==", "active")
      .orderBy("version", "desc")
      .limit(1)
      .get();
    const document = snapshot.docs[0];
    return document
      ? workflowTemplateSchema.parse({ id: document.id, ...document.data() })
      : null;
  }
}
