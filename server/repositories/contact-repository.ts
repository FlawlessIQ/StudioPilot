import type { Firestore } from "firebase-admin/firestore";
import { contactSchema, type Contact } from "@/features/contacts/schema";
import { TenantRepository } from "./base-repository";

export class ContactsRepository extends TenantRepository<Contact> {
  constructor(firestore: Firestore) {
    super(firestore, "contacts", contactSchema);
  }

  async findByNormalizedEmail(
    tenantId: string,
    normalizedEmail: string,
  ): Promise<Contact | null> {
    const snapshot = await this.collection
      .where("tenantId", "==", tenantId)
      .where("normalizedEmail", "==", normalizedEmail)
      .where("archivedAt", "==", null)
      .limit(1)
      .get();
    const document = snapshot.docs[0];
    return document
      ? contactSchema.parse({ id: document.id, ...document.data() })
      : null;
  }
}
