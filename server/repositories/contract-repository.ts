import type { Firestore } from "firebase-admin/firestore";
import { contractSchema, type Contract } from "@/features/contracts/schema";
import { TenantRepository } from "./base-repository";

export class ContractRepository extends TenantRepository<Contract> {
  constructor(firestore: Firestore) { super(firestore, "contracts", contractSchema); }
}
