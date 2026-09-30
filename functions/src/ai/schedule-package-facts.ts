import {
  combineCoverage,
  describeCoverage,
  resolveCoverage,
} from "../packages/coverage.js";

/**
 * What the run-of-show draft is told about the job's packages.
 *
 * It was told about one: the primary snapshot's name, minutes and add-ons. A
 * studio that sells photo and video together (GR Productions) got a timeline
 * planned for the photographer alone, and the video package's longer day was
 * cut to the photo package's minutes. Now every package on the job goes in,
 * with who each sends, the coverage across all of them, and the longest day
 * any of them includes — the packages cover the same wedding, so the day is
 * as long as the longest, not the sum.
 */

type Json = Record<string, unknown>;

/** The job's current packages, primary first, without repeats. */
export function jobPackageSnapshotIds(project: {
  packageSnapshotId?: unknown;
  additionalPackageSnapshotIds?: unknown;
}): string[] {
  const ids = [
    project.packageSnapshotId,
    ...(Array.isArray(project.additionalPackageSnapshotIds)
      ? project.additionalPackageSnapshotIds
      : []),
  ].filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(ids)];
}

const minutesOf = (data: Json): number | null => {
  const value = Number(data.includedCoverageMinutes ?? data.coverageMinutes);
  return Number.isFinite(value) && value > 0 ? value : null;
};

export function schedulePackageFact(
  snapshots: readonly { id: string; data: Json }[],
) {
  if (!snapshots.length) return null;
  const packages = snapshots.map(({ id, data }) => ({
    sourceId: id,
    packageName:
      typeof data.packageName === "string" && data.packageName
        ? data.packageName
        : "Package",
    coverageMinutes: minutesOf(data),
    coverage: describeCoverage(resolveCoverage(data)),
    addOns: data.addOns ?? data.selectedAddOns ?? [],
  }));
  const minutes = packages
    .map((entry) => entry.coverageMinutes)
    .filter((value): value is number => value !== null);
  return {
    // The primary package stays the fact's own source, as before.
    sourceId: packages[0]!.sourceId,
    sourceIds: packages.map((entry) => entry.sourceId),
    packageName: packages.map((entry) => entry.packageName).join(" + "),
    coverage: describeCoverage(
      combineCoverage(snapshots.map(({ data }) => resolveCoverage(data))),
    ),
    coverageMinutes: minutes.length ? Math.max(...minutes) : null,
    packages,
  };
}
