import type { Firestore } from "firebase-admin/firestore";
import { proposalSchema, type Proposal } from "@/features/proposals/schema";
import { TenantRepository } from "./base-repository";

export class ProposalRepository extends TenantRepository<Proposal> {
  constructor(firestore: Firestore) { super(firestore, "proposals", proposalSchema); }

  async listVersions(tenantId: string, projectId: string): Promise<Proposal[]> {
    const snapshot = await this.collection
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId)
      .orderBy("version", "desc")
      .get();
    return snapshot.docs.map((document) => proposalSchema.parse({ id: document.id, ...document.data() }));
  }
}
