import { z } from "zod";
import type {
  CollectionReference,
  DocumentData,
  Firestore,
  Query,
} from "firebase-admin/firestore";

export type TenantRecord = {
  id: string;
  tenantId: string;
};

export abstract class TenantRepository<TRecord extends TenantRecord> {
  protected readonly collection: CollectionReference<DocumentData>;

  protected constructor(
    firestore: Firestore,
    collectionName: string,
    private readonly schema: z.ZodType<TRecord>,
  ) {
    this.collection = firestore.collection(collectionName);
  }

  async getById(tenantId: string, id: string): Promise<TRecord | null> {
    const snapshot = await this.collection.doc(id).get();
    if (!snapshot.exists) return null;
    const record = this.schema.parse({ id: snapshot.id, ...snapshot.data() });
    return record.tenantId === tenantId ? record : null;
  }

  async listForTenant(tenantId: string, limit = 50): Promise<TRecord[]> {
    const query: Query<DocumentData> = this.collection
      .where("tenantId", "==", tenantId)
      .where("archivedAt", "==", null)
      .limit(Math.min(limit, 100));
    const snapshot = await query.get();
    return snapshot.docs.map((document) =>
      this.schema.parse({ id: document.id, ...document.data() }),
    );
  }

  async create(record: TRecord): Promise<TRecord> {
    const parsed = this.schema.parse(record);
    await this.collection.doc(parsed.id).create(parsed);
    return parsed;
  }
}
