import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { RequestEvidence, SignerIdentity } from "@/server/contracts/client-signing";
import type { FinalDetailsView } from "@/features/planning/final-details-view";
import { headcountNames } from "@/features/schedules/party-list";
import { tradeOf } from "@/features/trades/trades";

/**
 * The couple's side of the final-details sign-off
 * (functions/src/planning/final-details.ts opens it on the lock day).
 *
 * They read every location and time and the timeline, type their name, and
 * confirm — the same act as signing their agreement, recorded the same way:
 * who (their verified sign-in), what (the snapshot's hash, which must be the
 * one they were shown), when, and from where.
 *
 * A client priced per person (makeup, hair) has a `kind: "headcount"`
 * sign-off: one question, still this many getting ready, and one tap with no
 * typed name. The names are read from their party list as it stands, so
 * someone they just added counts; what they confirm is still exactly what
 * they were shown — the hash covers the names.
 */

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export type { FinalDetailsView };

const RETURNED = ["submitted", "locked"];

/**
 * Who's on a per-person client's party list now: the newest returned answer
 * to "party-list" (recommended-templates.ts), counting those having the
 * studio's own service (party-list.ts `headcountNames`).
 */
async function livePeople(db: Firestore, input: { tenantId: string; projectId: string }): Promise<string[]> {
  const [tenant, responses] = await Promise.all([
    db.doc(`tenants/${input.tenantId}`).get(),
    db
      .collection("questionnaireResponses")
      .where("tenantId", "==", input.tenantId)
      .where("projectId", "==", input.projectId)
      .limit(20)
      .get(),
  ]);
  const newest = responses.docs
    .filter((response) => RETURNED.includes(String(response.get("status"))) && !response.get("archivedAt"))
    .sort((left, right) => text(left.get("submittedAt")).localeCompare(text(right.get("submittedAt"))))
    .map((response) => record(response.get("answers"))["party-list"])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .at(-1);
  return headcountNames(newest ?? "", tradeOf(tenant.get("trade")) === "hair" ? "hair" : "makeup");
}

/** What a headcount confirmation covers: the lock-day snapshot, and the names as shown. */
export function headcountHash(snapshotHash: string, people: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify({ snapshotHash, people })).digest("hex");
}

const count = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null);

export async function finalDetailsFor(db: Firestore, input: { tenantId: string; projectId: string }): Promise<FinalDetailsView | null> {
  const signoff = await db.doc(`detailSignoffs/${input.tenantId}_${input.projectId}`).get();
  const data = signoff.data();
  if (!signoff.exists || !data || data.tenantId !== input.tenantId) return null;
  const snapshot = record(data.snapshot);
  if (data.kind === "headcount") {
    const confirmed = data.status === "confirmed";
    // Once confirmed, the names they confirmed; until then, the list as it stands.
    const people = confirmed
      ? (Array.isArray(data.confirmedPeople) ? data.confirmedPeople : []).map(text).filter(Boolean)
      : await livePeople(db, input);
    return {
      status: confirmed ? "confirmed" : "awaiting_couple",
      lockOn: text(data.lockOn) || null,
      rows: [],
      timeline: [],
      changes: [],
      snapshotHash: headcountHash(text(data.snapshotHash), people),
      confirmedAt: text(data.confirmedAt) || null,
      kind: "headcount",
      people,
      lockedHeadcount: count(data.headcount),
      confirmedHeadcount: count(data.confirmedHeadcount),
    };
  }
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
  const reference = db.doc(`detailSignoffs/${input.tenantId}_${input.projectId}`);
  // Read before the transaction: the party list is not part of it, and the
  // hash below refuses a confirmation of names that have changed since.
  const before = (await reference.get()).data();
  const headcount = before?.kind === "headcount" && before.tenantId === input.tenantId;
  const people = headcount ? await livePeople(db, input) : [];
  if (!headcount && typedName.length < 2) throw new Error("FINAL_DETAILS_NAME_REQUIRED");
  if (headcount) return confirmHeadcount(db, { ...input, typedName, people, now });
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

/**
 * The one tap: still this many getting ready. Recorded like the full
 * sign-off — who, from their verified sign-in; what, the names they were
 * shown; when and from where — with no typed name. The headcount never goes
 * below the one at the lock: people can be added, not taken off, as the
 * agreement says (contracts/event-details.ts `headcountLock`).
 */
async function confirmHeadcount(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    typedName: string;
    snapshotHash: string;
    signer: SignerIdentity;
    evidence: RequestEvidence;
    people: string[];
    now: string;
  },
): Promise<{ confirmedAt: string }> {
  const { now, people } = input;
  if (!people.length) throw new Error("FINAL_HEADCOUNT_EMPTY");
  const reference = db.doc(`detailSignoffs/${input.tenantId}_${input.projectId}`);
  return db.runTransaction(async (transaction) => {
    const signoff = await transaction.get(reference);
    const data = signoff.data();
    if (!signoff.exists || !data || data.tenantId !== input.tenantId) throw new Error("FINAL_DETAILS_NOT_FOUND");
    if (data.status === "confirmed") return { confirmedAt: text(data.confirmedAt) || now };
    // The names they confirm are the names they saw: one added since reloads the card.
    if (headcountHash(text(data.snapshotHash), people) !== input.snapshotHash) throw new Error("FINAL_DETAILS_CHANGED");
    const confirmedHeadcount = Math.max(people.length, count(data.headcount) ?? 0);
    const who = input.typedName || input.signer.email || "The client";
    const auditId = `audit_final_headcount_${createHash("sha256").update(`${reference.id}:${now}`).digest("hex").slice(0, 24)}`;
    transaction.update(reference, {
      status: "confirmed",
      confirmedAt: now,
      confirmedPeople: people,
      confirmedHeadcount,
      confirmedBy: {
        uid: input.signer.uid,
        email: input.signer.email,
        emailVerified: input.signer.emailVerified,
        authMethod: input.signer.authMethod,
        typedName: input.typedName || null,
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
      action: "final_headcount.confirmed_by_client",
      entityType: "detailSignoff",
      entityId: reference.id,
      timestamp: now,
      before: { status: data.status ?? null, headcount: count(data.headcount) },
      after: { status: "confirmed", confirmedHeadcount, people },
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
      title: `${who} confirmed the final headcount: ${confirmedHeadcount}`,
      summary: people.join(", ").slice(0, 900),
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
