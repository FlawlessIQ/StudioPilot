import { getFirestore, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { handlePublicInquiry } from "./public-lead.js";

/**
 * Inquiries the website held because publicLeadIntake could not answer.
 *
 * 2026-10-22: no function could start for over an hour (Google's nodejs22
 * base image; docs/deployment.md, "Functions fail to start") and the public
 * form told two people "Your inquiry could not be submitted". When the relay
 * (app/api/functions/[functionName]/route.ts) gets a 5xx or no answer from
 * publicLeadIntake, it checks App Check itself and writes the submission to
 * `pendingInquiries/{id}`; the client sees "Inquiry received". This delivers
 * each one through handlePublicInquiry — the same validation, rate limit,
 * duplicate check and lead as the live form — once functions answer again.
 *
 * Server-only collection (firestore.rules: no client access).
 */

/** A held inquiry is tried this often before it needs a person. */
export const PENDING_INQUIRY_MAX_ATTEMPTS = 24;
/** A claim older than this was dropped mid-delivery (an instance died): retry it. */
const STALE_CLAIM_MS = 10 * 60 * 1000;

export type PendingInquiryOutcome =
  /** A lead exists: done. */
  | { kind: "delivered"; leadId: string }
  /** The form's own answer was no (bad fields, unknown studio): never retried. */
  | { kind: "rejected"; error: string }
  /** Try again later (rate limited, or something failed). */
  | { kind: "retry"; error: string };

/** What a delivery's reply means for the held inquiry. Pure. */
export function pendingInquiryOutcome(status: number, payload: unknown): PendingInquiryOutcome {
  const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const error = typeof record.error === "string" ? record.error : `HTTP_${status}`;
  if (status >= 200 && status < 300 && typeof record.leadId === "string") return { kind: "delivered", leadId: record.leadId };
  if (status === 429 || status >= 500) return { kind: "retry", error };
  return { kind: "rejected", error };
}

/** Deliver one held inquiry. Exported for the emulator test. */
export async function deliverPendingInquiry(db: Firestore, held: DocumentSnapshot, now = new Date()) {
  const reference = held.ref;
  // Claim it, so two overlapping runs never make two leads.
  const claimed = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const status = current.get("status");
    const claimedAt = Date.parse(String(current.get("claimedAt") ?? ""));
    const stale = status === "delivering" && (!Number.isFinite(claimedAt) || now.getTime() - claimedAt > STALE_CLAIM_MS);
    if (status !== "pending" && !stale) return false;
    transaction.update(reference, {
      status: "delivering",
      claimedAt: now.toISOString(),
      attempts: Number(current.get("attempts") ?? 0) + 1,
      updatedAt: now.toISOString(),
    });
    return true;
  });
  if (!claimed) return null;

  let replied: { status: number; payload: unknown } = { status: 500, payload: { error: "NO_REPLY" } };
  try {
    await handlePublicInquiry(
      held.get("body"),
      {
        address: String(held.get("clientAddress") ?? "unknown"),
        userAgent: typeof held.get("userAgent") === "string" ? held.get("userAgent") : null,
        correlationId: `pending-inquiry:${held.id}`,
      },
      { status: (code) => ({ json: (payload) => void (replied = { status: code, payload }) }) },
    );
  } catch (caught) {
    replied = { status: 500, payload: { error: caught instanceof Error ? caught.message.slice(0, 200) : "DELIVERY_FAILED" } };
  }

  const outcome = pendingInquiryOutcome(replied.status, replied.payload);
  const attempts = Number(held.get("attempts") ?? 0) + 1;
  const at = new Date().toISOString();
  if (outcome.kind === "delivered") {
    await reference.update({ status: "delivered", leadId: outcome.leadId, deliveredAt: at, updatedAt: at, lastError: null });
    logger.info("pendingInquiryDelivered", { pendingInquiryId: held.id, leadId: outcome.leadId, attempts });
  } else if (outcome.kind === "rejected" || attempts >= PENDING_INQUIRY_MAX_ATTEMPTS) {
    // A person has to look: the submission is kept in full on the document.
    await reference.update({ status: outcome.kind === "rejected" ? "rejected" : "failed", lastError: outcome.error, updatedAt: at });
    logger.error("pendingInquiryNotDelivered", {
      studiocueOperationalError: true,
      code: "PENDING_INQUIRY_NOT_DELIVERED",
      pendingInquiryId: held.id,
      tenantSlug: held.get("tenantSlug") ?? null,
      reason: outcome.error,
      attempts,
    });
  } else {
    await reference.update({ status: "pending", lastError: outcome.error, updatedAt: at });
  }
  return outcome;
}

export const pendingInquiryDelivery = onSchedule(
  { schedule: "every 5 minutes", timeZone: "UTC", retryCount: 0 },
  async () => {
    const db = getFirestore();
    const [pending, delivering] = await Promise.all([
      db.collection("pendingInquiries").where("status", "==", "pending").limit(25).get(),
      db.collection("pendingInquiries").where("status", "==", "delivering").limit(25).get(),
    ]);
    for (const held of [...pending.docs, ...delivering.docs]) {
      await deliverPendingInquiry(db, held).catch((caught: unknown) =>
        logger.error("pendingInquiryDeliveryCrashed", {
          studiocueOperationalError: true,
          code: "PENDING_INQUIRY_DELIVERY_CRASHED",
          pendingInquiryId: held.id,
          error: caught instanceof Error ? caught.message.slice(0, 300) : String(caught),
        }),
      );
    }
  },
);
