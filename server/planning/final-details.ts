import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { RequestEvidence, SignerIdentity } from "@/server/contracts/client-signing";
import type { FinalDetailsView } from "@/features/planning/final-details-view";

/**
 * The couple's side of the final-details sign-off
 * (functions/src/planning/final-details.ts opens it on the lock day).
 *
 * They read every location and time and the timeline, type their name, and
 * confirm — the same act as signing their agreement, recorded the same way:
 * who (their verified sign-in), what (the snapshot's hash, which must be the
 * one they were shown), when, and from where.
 */

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export type { FinalDetailsView };

export async function finalDetailsFor(db: Firestore, input: { tenantId: string; projectId: string }): Promise<FinalDetailsView | null> {
  const signoff = await db.doc(`detailSignoffs/${input.tenantId}_${input.projectId}`).get();
  const data = signoff.data();
  if (!signoff.exists || !data || data.tenantId !== input.tenantId) return null;
  const snapshot = record(data.snapshot);
  return {
    status: data.status === "confirmed" ? "confirmed" : "awaiting_couple",
    lockOn: text(data.lockOn) || null,
    rows: (Array.isArray(snapshot.rows) ? snapshot.rows : []).map(record).map((row) => ({ label: text(row.label), value: text(row.value) })),
    timeline: (Array.isArray(snapshot.timeline) ? snapshot.timeline : []).map(record).map((row) => ({
      time: text(row.time),
      title: text(row.title),
      location: text(row.location) || null,
    })),
    changes: (Array.isArray(data.changes) ? data.changes : []).map(record).map((change) => ({
      at: text(change.at),
      label: text(change.label),
      from: text(change.from),
      to: text(change.to),
    })),
    snapshotHash: text(data.snapshotHash),
    confirmedAt: text(data.confirmedAt) || null,
  };
}

export async function confirmFinalDetails(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    typedName: string;
    snapshotHash: string;
    signer: SignerIdentity;
    evidence: RequestEvidence;
    now?: string;
  },
): Promise<{ confirmedAt: string }> {
  const now = input.now ?? new Date().toISOString();
  const typedName = input.typedName.trim().replace(/\s+/g, " ");
  if (typedName.length < 2) throw new Error("FINAL_DETAILS_NAME_REQUIRED");
  const reference = db.doc(`detailSignoffs/${input.tenantId}_${input.projectId}`);
  return db.runTransaction(async (transaction) => {
    const signoff = await transaction.get(reference);
    const data = signoff.data();
    if (!signoff.exists || !data || data.tenantId !== input.tenantId) throw new Error("FINAL_DETAILS_NOT_FOUND");
    if (data.status === "confirmed") return { confirmedAt: text(data.confirmedAt) || now };
    // What they confirm is what they were shown: an accepted change since
    // means the page reloads and they read it again.
    if (text(data.snapshotHash) !== input.snapshotHash) throw new Error("FINAL_DETAILS_CHANGED");
    const auditId = `audit_final_details_${createHash("sha256").update(`${reference.id}:${now}`).digest("hex").slice(0, 24)}`;
    transaction.update(reference, {
      status: "confirmed",
      confirmedAt: now,
      confirmedBy: {
        uid: input.signer.uid,
        email: input.signer.email,
        emailVerified: input.signer.emailVerified,
        authMethod: input.signer.authMethod,
        typedName,
      },
      evidence: { ipAddress: input.evidence.ipAddress, userAgent: input.evidence.userAgent },
      updatedAt: now,
    });
    transaction.create(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      actorId: input.signer.uid,
      actorType: "client",
      action: "final_details.confirmed_by_client",
      entityType: "detailSignoff",
      entityId: reference.id,
      timestamp: now,
      before: { status: data.status ?? null },
      after: { status: "confirmed", snapshotHash: input.snapshotHash, typedName },
      ipAddress: input.evidence.ipAddress,
      userAgent: input.evidence.userAgent,
      correlationId: auditId,
      automationRunId: null,
      providerEventId: null,
    });
    const receiptId = `receipt_final_details_${reference.id}`;
    transaction.set(db.doc(`actionReceipts/${receiptId}`), {
      id: receiptId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      title: `${typedName} confirmed their final details`,
      summary: "Every location and time, and the timeline, as they stood when confirmed.",
      status: "completed",
      source: "final_details",
      affectedEntityType: "detailSignoff",
      affectedEntityId: reference.id,
      providerEvidence: null,
      reversible: false,
      retryable: false,
      canCancel: false,
      canRetry: false,
      createdAt: now,
      updatedAt: now,
    });
    return { confirmedAt: now };
  });
}
