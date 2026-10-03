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
/** The lines that are taken to book. */
const RETAINER_LABELS = ["Retainer", "Payment in full"];
/** One bill, nothing taken to book. */
const NOTHING_TO_BOOK_LABELS = ["Payment on the day", "Invoice after the event"];

export function retainerFromSchedule(
  schedule: unknown,
  fallbackCents: number,
): number {
  if (!Array.isArray(schedule)) return fallbackCents;
  // "Payment in full" is the whole price taken to book (a family session);
  // a job paid on the day or invoiced after takes nothing to book, so its
  // retainer is zero rather than the package's (job-kinds.ts,
  // paymentScheduleFor).
  const labelOf = (entry: unknown) =>
    typeof entry === "object" && entry !== null ? String((entry as { label?: unknown }).label) : "";
  const retainer = schedule.find((entry) => RETAINER_LABELS.includes(labelOf(entry)));
  if (!retainer && schedule.some((entry) => NOTHING_TO_BOOK_LABELS.includes(labelOf(entry)))) return 0;
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
