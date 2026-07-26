import type { Firestore } from "firebase-admin/firestore";
import { integrationConnectionSchema, type IntegrationConnection } from "@/features/integrations/schema";
import { TenantRepository } from "./base-repository";

export class IntegrationConnectionRepository extends TenantRepository<IntegrationConnection> {
  constructor(firestore: Firestore) { super(firestore, "integrationConnections", integrationConnectionSchema); }
}
