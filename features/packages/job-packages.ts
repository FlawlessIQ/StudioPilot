import { coverageRoleLabel, resolveCoverage } from "@/features/packages/coverage";

/**
 * The packages on a job, as the job itself names them.
 *
 * A job carries `packageSnapshotId` and `additionalPackageSnapshotIds`, and
 * every snapshot it ever had stays in `packageSnapshots` (they are immutable).
 * Reading "the snapshots on this project" therefore returns replaced and
 * removed packages too, and the couple's "Your package" page showed whichever
 * came back first. These helpers read the job's own list. Mirrored for
 * functions/ in functions/src/ai/schedule-package-facts.ts.
 */

type Json = Record<string, unknown>;

export function jobPackageSnapshotIds(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  const project = value as { packageSnapshotId?: unknown; additionalPackageSnapshotIds?: unknown };
  const ids = [
    project.packageSnapshotId,
    ...(Array.isArray(project.additionalPackageSnapshotIds)
      ? project.additionalPackageSnapshotIds
      : []),
  ].filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(ids)];
}

/** The job's snapshots, in the job's order. Anything else is dropped. */
export function currentJobSnapshots<T extends { id: string }>(
  snapshots: readonly T[],
  project: unknown,
): T[] {
  return jobPackageSnapshotIds(project).flatMap((id) => {
    const match = snapshots.find((snapshot) => snapshot.id === id);
    return match ? [match] : [];
  });
}

const minutesOf = (value: Json): number | null => {
  const minutes = Number(value.includedCoverageMinutes ?? value.coverageMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
};

/**
 * How long the day is, across every package on it.
 *
 * The packages cover the same wedding, so the day is as long as the longest
 * of them — a 10-hour video package beside an 8-hour photo package is a
 * 10-hour day, not 8 (the run-of-show generator read the first package only).
 */
export function jobCoverageMinutes(snapshots: readonly Json[]): number | null {
  const minutes = snapshots
    .map(minutesOf)
    .filter((value): value is number => value !== null);
  return minutes.length ? Math.max(...minutes) : null;
}

/** The bullets for one package from its snapshot, when no proposal has them. */
export function snapshotInclusions(value: Json): string[] {
  const minutes = minutesOf(value);
  const hours = minutes ? minutes / 60 : 0;
  const deliverables = Array.isArray(value.includedDeliverables)
    ? value.includedDeliverables
    : Array.isArray(value.deliverables)
      ? value.deliverables
      : [];
  return [
    ...(hours ? [`${hours} hours of coverage`] : []),
    ...resolveCoverage(value).map(
      (item) => `${item.count} ${coverageRoleLabel(item.role, item.count)}`,
    ),
    ...deliverables.map(String),
  ];
}

export type CouplePackageView = {
  packages: Array<{ key: string; name: string; items: string[] }>;
  totalCents: number;
  currency: string;
  /** True when the total and the bullets are the accepted proposal's. */
  fromAcceptedProposal: boolean;
  chosenAt: unknown;
};

/**
 * What the couple's "Your package" page shows.
 *
 * The accepted proposal is what they agreed to, so it leads: its packages,
 * their bullets and the combined total. Before a proposal is accepted it is
 * the packages on the job as they stand, and their totals added up — each
 * snapshot's total already carries its own discount.
 */
export function couplePackageView(input: {
  snapshots: readonly (Json & { id: string })[];
  proposals: readonly Json[];
}): CouplePackageView | null {
  const accepted = [...input.proposals]
    .filter((proposal) => proposal.status === "accepted")
    .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0];
  const pricing =
    accepted && typeof accepted.pricingSnapshot === "object" && accepted.pricingSnapshot
      ? (accepted.pricingSnapshot as Json)
      : null;
  const details = Array.isArray(accepted?.packageDetails)
    ? (accepted!.packageDetails as Json[])
    : [];
  const bySnapshot = new Map(input.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  if (accepted && pricing && details.length) {
    return {
      packages: details.map((detail, index) => {
        const snapshot = bySnapshot.get(String(detail.snapshotId ?? ""));
        const items = Array.isArray(detail.items) ? detail.items.map(String) : [];
        return {
          key: String(detail.snapshotId ?? index),
          name: String(detail.packageName ?? "Package"),
          items: items.length ? items : snapshot ? snapshotInclusions(snapshot) : [],
        };
      }),
      totalCents: Number(pricing.totalCents ?? 0),
      currency: String(pricing.currency ?? "USD"),
      fromAcceptedProposal: true,
      chosenAt: accepted.acceptedAt ?? null,
    };
  }
  if (!input.snapshots.length) return null;
  return {
    packages: input.snapshots.map((snapshot) => ({
      key: snapshot.id,
      name: String(snapshot.packageName ?? snapshot.name ?? "Package"),
      items: snapshotInclusions(snapshot),
    })),
    totalCents: input.snapshots.reduce((sum, snapshot) => sum + Number(snapshot.totalCents ?? 0), 0),
    currency: String(input.snapshots[0]!.currency ?? "USD"),
    fromAcceptedProposal: false,
    chosenAt: input.snapshots[0]!.selectionDate ?? input.snapshots[0]!.createdAt ?? null,
  };
}

/**
 * What a job is worth: every package on it, not the first.
 *
 * Today's "booked" figure and the Jobs table priced a job by its primary
 * snapshot alone, so a wedding sold as photo plus video counted as the photo
 * package (GR Productions). The accepted proposal is what the couple agreed,
 * so its combined total leads; before one is accepted it is the job's own
 * packages added up, each snapshot already net of its discount. Null when
 * the job has neither — nothing to price, which is not the same as $0.
 */
export function jobValueCents(input: {
  project: Json & { id: string };
  snapshots: readonly (Json & { id: string })[] | null | undefined;
  proposals?: readonly Json[] | null;
}): number | null {
  const accepted = (input.proposals ?? [])
    .filter((proposal) => proposal.projectId === input.project.id && proposal.status === "accepted")
    .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0];
  const agreed = Number((accepted?.pricingSnapshot as Json | null | undefined)?.totalCents);
  if (accepted && Number.isSafeInteger(agreed) && agreed > 0) return agreed;
  const onJob = currentJobSnapshots(input.snapshots ?? [], input.project);
  if (!onJob.length) return null;
  return onJob.reduce((sum, snapshot) => {
    const total = Number(snapshot.totalCents ?? 0);
    return sum + (Number.isFinite(total) ? total : 0);
  }, 0);
}
