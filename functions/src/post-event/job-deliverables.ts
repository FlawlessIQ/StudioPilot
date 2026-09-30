import { coverageCount, resolveCoverage } from "../packages/coverage.js";
import { expectedDeliverables, type ExpectedDeliverable } from "./deliverables.js";

// The functions copy of features/post-event/job-deliverables.ts, which is the
// source of truth. tests/wave2-delivery.test.ts compares the two from the
// marker below.

// ── shared below ──

/**
 * What a whole job delivers, across every package it carries.
 *
 * A photo + video wedding rests on two snapshots — `packageSnapshotId` and
 * `additionalPackageSnapshotIds` (features/crew/staffing-plan.ts
 * `jobPackageSnapshotIds`). Every reader of "what does this job owe the
 * couple" read the primary alone, so at GR Productions, which sells photo and
 * video together, sending the gallery made the whole job DELIVERED and started
 * the review asks while the film was still owed — and the film was never
 * tracked at all.
 *
 * Each package's expectations are read on their own terms (its structured
 * list, else what its own coverage implies) and unioned by kind: a
 * videographer in the video package means a highlight film whichever package
 * is primary, which is the same answer the combined coverage gives. One kind
 * appears once; it counts as final if any package says so, and it is due at
 * the soonest turnaround either package promised.
 *
 * No snapshot at all is the old single gallery, as `expectedDeliverables`
 * answers for a job with no package. Pure.
 */
export function jobExpectedDeliverables(snapshots: readonly unknown[]): ExpectedDeliverable[] {
  if (!snapshots.length) return expectedDeliverables({ coverage: null });
  const merged = new Map<string, ExpectedDeliverable>();
  for (const snapshot of snapshots) {
    const data =
      typeof snapshot === "object" && snapshot !== null ? (snapshot as Record<string, unknown>) : {};
    const coverage = resolveCoverage(data);
    const expected = expectedDeliverables({
      deliverables: data.deliverables,
      includedDeliverables: data.includedDeliverables,
      coverage: {
        photographers: coverageCount(coverage, "photographer"),
        videographers: coverageCount(coverage, "videographer"),
      },
    });
    for (const entry of expected) {
      const prior = merged.get(entry.kind);
      if (!prior) {
        merged.set(entry.kind, { ...entry });
        continue;
      }
      const turnarounds = [prior.turnaroundDays, entry.turnaroundDays].filter(
        (days): days is number => days !== null,
      );
      merged.set(entry.kind, {
        ...prior,
        final: prior.final || entry.final,
        turnaroundDays: turnarounds.length ? Math.min(...turnarounds) : null,
      });
    }
  }
  // Two packages can each name a row "main"; React and the release both key on it.
  const keys = new Set<string>();
  return [...merged.values()].map((entry) => {
    const key = keys.has(entry.key) ? `${entry.key}_${entry.kind}` : entry.key;
    keys.add(key);
    return { ...entry, key };
  });
}
