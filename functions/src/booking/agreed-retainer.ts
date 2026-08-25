import type { Firestore } from "firebase-admin/firestore";

/**
 * The functions copy of the agreed-retainer rule.
 *
 * features/booking/agreed-retainer.ts is the source of truth; functions/ is
 * a separate package with no "@/features" path, so the rule is duplicated
 * here. `tests/booking-gate.test.ts` compares the two and fails on a drift,
 * because the two disagreeing means the figure a studio is shown and the
 * figure the client is billed are different figures.
 */
export function retainerFromSchedule(
  schedule: unknown,
  fallbackCents: number,
): number {
  if (!Array.isArray(schedule)) return fallbackCents;
  const retainer = schedule.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      String((entry as { label?: unknown }).label) === "Retainer",
  );
  const agreed = Number((retainer as { amountCents?: unknown })?.amountCents);
  // A zero retainer is a real choice — some studios take nothing up front —
  // so only a missing or nonsensical figure falls back to the package.
  return Number.isInteger(agreed) && agreed >= 0 ? agreed : fallbackCents;
}


/** The same rule, against the project's accepted proposal. */
export async function agreedRetainerCents(
  db: Firestore,
  tenantId: string,
  projectId: string,
  packageSnapshot: { get(field: string): unknown },
): Promise<number> {
  const fallback = Number(packageSnapshot.get("retainerCents") ?? 0);
  const accepted = await db
    .collection("proposals")
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", projectId)
    .where("status", "==", "accepted")
    .limit(1)
    .get();
  if (accepted.empty) return fallback;
  return retainerFromSchedule(accepted.docs[0]!.get("paymentSchedule"), fallback);
}
