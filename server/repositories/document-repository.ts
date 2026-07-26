import type { Firestore } from "firebase-admin/firestore";
import { documentSchema, type DocumentRecord } from "@/features/documents/schema";
import { TenantRepository } from "./base-repository";

export class DocumentRepository extends TenantRepository<DocumentRecord> {
  constructor(firestore: Firestore) { super(firestore, "documents", documentSchema); }
}
