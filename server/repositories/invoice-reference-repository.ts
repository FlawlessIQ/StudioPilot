import type { Firestore } from "firebase-admin/firestore";
import { invoiceReferenceSchema, type InvoiceReference } from "@/features/invoices/schema";
import { TenantRepository } from "./base-repository";

export class InvoiceReferenceRepository extends TenantRepository<InvoiceReference> {
  constructor(firestore: Firestore) { super(firestore, "invoiceReferences", invoiceReferenceSchema); }
}
