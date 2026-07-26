import type { Firestore } from "firebase-admin/firestore";
import { consultationSchema, type Consultation } from "@/features/consultations/schema";
import { TenantRepository } from "./base-repository";

export class ConsultationRepository extends TenantRepository<Consultation> {
  constructor(firestore: Firestore) { super(firestore, "consultations", consultationSchema); }

  async listUpcoming(tenantId: string, from: string, limit = 50): Promise<Consultation[]> {
    const snapshot = await this.collection
      .where("tenantId", "==", tenantId)
      .where("startsAt", ">=", from)
      .where("archivedAt", "==", null)
      .orderBy("startsAt", "asc")
      .limit(limit)
      .get();
    return snapshot.docs.map((document) => consultationSchema.parse({ id: document.id, ...document.data() }));
  }
}
