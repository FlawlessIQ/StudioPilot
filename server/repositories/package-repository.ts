import type { Firestore } from "firebase-admin/firestore";
import { packageSchema, type StudioPackage } from "@/features/packages/schema";
import { TenantRepository } from "./base-repository";

export class PackagesRepository extends TenantRepository<StudioPackage> {
  constructor(firestore: Firestore) {
    super(firestore, "packages", packageSchema);
  }

  async listActiveForEventType(
    tenantId: string,
    eventTypeId: string,
  ): Promise<StudioPackage[]> {
    const snapshot = await this.collection
      .where("tenantId", "==", tenantId)
      .where("eventTypeId", "==", eventTypeId)
      .where("active", "==", true)
      .where("archivedAt", "==", null)
      .orderBy("displayOrder", "asc")
      .get();
    return snapshot.docs.map((document) =>
      packageSchema.parse({ id: document.id, ...document.data() }),
    );
  }
}
