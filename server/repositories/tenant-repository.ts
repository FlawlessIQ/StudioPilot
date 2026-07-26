import type { Firestore } from "firebase-admin/firestore";
import { tenantSchema, type Tenant } from "@/features/tenants/schema";
import { TenantRepository } from "./base-repository";

export class TenantsRepository extends TenantRepository<Tenant> {
  constructor(firestore: Firestore) {
    super(firestore, "tenants", tenantSchema);
  }
}
