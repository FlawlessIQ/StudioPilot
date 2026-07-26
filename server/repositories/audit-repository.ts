import type { Firestore } from "firebase-admin/firestore";
import { auditEventSchema, type AuditEvent } from "@/features/audit/schema";

export class AuditRepository {
  constructor(private readonly firestore: Firestore) {}

  async append(event: AuditEvent): Promise<void> {
    const parsed = auditEventSchema.parse(event);
    await this.firestore.doc(`auditEvents/${parsed.id}`).create(parsed);
  }

  async list(tenantId: string, limit = 100): Promise<AuditEvent[]> {
    const snapshot = await this.firestore
      .collection("auditEvents")
      .where("tenantId", "==", tenantId)
      .orderBy("timestamp", "desc")
      .limit(Math.min(limit, 200))
      .get();
    return snapshot.docs.map((document) =>
      auditEventSchema.parse({ id: document.id, ...document.data() }),
    );
  }
}
