import type { Firestore } from "firebase-admin/firestore";

/**
 * Which studios each partner brought in, and when each one paid
 * (console/handlers/partners.ts; Console → Partners).
 *
 * A studio is tagged to a partner when its subscription first carries that
 * partner's code, and counts toward commission only when its first annual
 * payment clears — Conor, 2026-10-07: no paying out for a studio that cancels
 * in its trial. `saasReferrals/{tenantId}`: one studio, one partner, kept
 * after cancellation so the history stays true.
 */

/** Tag the studio to the partner whose code its subscription carries. */
export async function recordReferral(
  db: Firestore,
  input: { tenantId: string; code: string | null | undefined; status: string; now: string },
): Promise<void> {
  const code = (input.code ?? "").trim().toUpperCase();
  if (!code) return;
  const partners = await db.collection("saasPartners").where("code", "==", code).limit(1).get();
  const partner = partners.docs[0];
  if (!partner) return;
  const reference = db.doc(`saasReferrals/${input.tenantId}`);
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    if (existing.exists && existing.get("partnerId") !== partner.id) return; // first partner keeps it
    transaction.set(
      reference,
      {
        id: input.tenantId,
        tenantId: input.tenantId,
        partnerId: partner.id,
        code,
        status: input.status,
        signedUpAt: existing.get("signedUpAt") ?? input.now,
        paidAt: existing.get("paidAt") ?? null,
        amountPaidCents: existing.get("amountPaidCents") ?? null,
        updatedAt: input.now,
      },
      { merge: true },
    );
  });
}

/** The first paid invoice of a referred studio: the sign-up now counts. */
export async function creditReferral(
  db: Firestore,
  input: { tenantId: string; amountPaidCents: number; invoiceId: string | null; now: string },
): Promise<void> {
  if (!(input.amountPaidCents > 0)) return;
  const reference = db.doc(`saasReferrals/${input.tenantId}`);
  await db.runTransaction(async (transaction) => {
    const referral = await transaction.get(reference);
    if (!referral.exists || referral.get("paidAt")) return;
    transaction.update(reference, {
      paidAt: input.now,
      amountPaidCents: input.amountPaidCents,
      paidInvoiceId: input.invoiceId,
      status: "paid",
      updatedAt: input.now,
    });
  });
}
