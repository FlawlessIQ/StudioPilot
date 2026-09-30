/**
 * The figures the month-out "final balance" message quotes.
 *
 * It quoted the primary package snapshot: "Package total $photo − retainer
 * $photoRetainer", so a couple who booked photo and video together was told
 * a balance that left the video out (GR Productions, 2026-09-30). The couple
 * agreed to the accepted proposal, so its combined total leads, and what they
 * have paid is what is recorded against bills still standing — the same
 * arithmetic outstandingFinalBalance and the server's final invoice use. Only
 * with no accepted proposal is the total the job's packages added up.
 *
 * Mirrored in functions/src/communications/final-balance-facts.ts and
 * compared below the header by tests/wave2-ai-packages.test.ts.
 */

type Row = Record<string, unknown>;

export type FinalBalanceFacts = {
  /** Every package on the job, in the job's order, by the name the couple saw. */
  packageNames: string[];
  totalCents: number | null;
  paidCents: number;
  balanceCents: number | null;
  /** False when no bill stands at all, so "paid so far" is unverified. */
  paymentsOnRecord: boolean;
};

const NOT_STANDING = ["superseded", "failed", "voided", "void", "cancelled"];

const nameOf = (value: unknown): string =>
  typeof value === "string" && value.trim() ? value.trim() : "";

export function finalBalanceFacts(input: {
  /** The job's proposals (any status); the latest accepted one is used. */
  proposals: readonly Row[];
  /** The job's current package snapshots, primary first. */
  snapshots: readonly Row[];
  /** The job's invoice references. */
  invoices: readonly Row[];
}): FinalBalanceFacts {
  const accepted = input.proposals
    .filter((proposal) => proposal.status === "accepted")
    .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0];
  const pricing = (accepted?.pricingSnapshot ?? null) as Row | null;
  const agreed = Number(pricing?.totalCents);
  const snapshotTotals = input.snapshots.map((snapshot) => Number(snapshot.totalCents));
  const totalCents =
    accepted && Number.isSafeInteger(agreed) && agreed > 0
      ? agreed
      : snapshotTotals.length && snapshotTotals.every((total) => Number.isSafeInteger(total) && total >= 0)
        ? snapshotTotals.reduce((sum, total) => sum + total, 0)
        : null;
  const details = Array.isArray(accepted?.packageDetails) ? (accepted.packageDetails as Row[]) : [];
  const fromProposal = details.map((detail) => nameOf(detail?.packageName)).filter(Boolean);
  const packageNames = fromProposal.length
    ? fromProposal
    : input.snapshots.map((snapshot) => nameOf(snapshot.packageName)).filter(Boolean);
  const standing = input.invoices.filter((invoice) => !NOT_STANDING.includes(String(invoice.status ?? "")));
  const paidCents = standing.reduce((sum, invoice) => {
    const amount = Number(invoice.amountCents ?? 0);
    const balance = Number(invoice.balanceCents ?? amount);
    const paid = amount - balance;
    return sum + (Number.isFinite(paid) && paid > 0 ? paid : 0);
  }, 0);
  return {
    packageNames,
    totalCents,
    paidCents,
    balanceCents: totalCents === null ? null : Math.max(0, totalCents - paidCents),
    paymentsOnRecord: standing.length > 0,
  };
}

/** "Gold Photo, Silver Cinematic and Drone" — every package, by name. */
export function packageNameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
