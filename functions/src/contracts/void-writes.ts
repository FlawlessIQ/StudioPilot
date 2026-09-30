import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";

/**
 * The writes that withdraw one StudioCue contract: the record and its audit
 * entry.
 *
 * Shared by `voidStudioCueContract` (the studio withdrawing an agreement, or a
 * corrected proposal retiring one) and by cancelling a job, which has to
 * withdraw an unsigned agreement inside its own transaction — the couple must
 * not be able to sign a booking for a wedding that is off. The caller has
 * already decided the contract may be voided; see voidStudioCueContract for
 * the rule (never a signed one).
 */
export function writeContractVoid(
  db: Firestore,
  transaction: Transaction,
  contract: DocumentSnapshot,
  input: {
    tenantId: string;
    projectId: string;
    reason: string;
    actorId: string;
    actorType: "user" | "system";
    timestamp: string;
    correlationId: string;
    auditId: string;
  },
): void {
  const status = String(contract.get("status"));
  transaction.update(contract.ref, {
    status: "voided",
    voidedAt: input.timestamp,
    voidedBy: input.actorId,
    voidReason: input.reason,
    updatedAt: input.timestamp,
    updatedBy: input.actorId,
  });
  transaction.create(db.doc(`auditEvents/${input.auditId}`), {
    id: input.auditId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    actorId: input.actorId,
    actorType: input.actorType,
    action: "contract.voided",
    entityType: "contract",
    entityId: contract.id,
    timestamp: input.timestamp,
    before: { status },
    after: { status: "voided", reason: input.reason },
    ipAddress: null,
    userAgent: null,
    correlationId: input.correlationId,
    automationRunId: null,
    providerEventId: null,
  });
}
