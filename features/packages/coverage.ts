import { z } from "zod";

/**
 * What the studio itself sends to the event.
 *
 * This existed for a long time as a single number, `includedPhotographers`,
 * and that number drove more than its name suggested: the second-shooter
 * readiness check, how many crew the cascade offers the job to, the retainer
 * on a per-crew-member package, and the line the couple reads in their portal.
 *
 * It could not describe a studio that sells video. "Videographer" was already
 * in the product — as a vendor type, as a question on the details form, as a
 * recipient of the run of show — but always as *someone else's* role, never as
 * the studio's own coverage. A studio whose own catalogue reads "Two
 * Videographers for a full day" had nowhere to put that number, and the
 * price-list importer at `functions/src/studio-import/native-assets.ts` has
 * been parsing `videographers?` out of uploaded lists into a field that did
 * not exist.
 *
 * Coverage is now a list of {role, count}. Adding a third role is one line in
 * `coverageRoleSchema` plus its label — deliberately, because the next studio
 * wants drone or photo booth and should not need this change again.
 *
 * ## Reading coverage off a record
 *
 * `includedPhotographers` is still written beside `includedCoverage`, and
 * every reader must go through `resolveCoverage` rather than either field.
 * Two reasons, and only one of them is transitional:
 *
 *  - Package snapshots are immutable. Every proposal signed before this change
 *    carries the old shape and always will, so the fallback read is permanent.
 *  - Existing package documents are not migrated. They gain `includedCoverage`
 *    the next time they are saved; until then the fallback answers for them.
 *
 * The two fields are not allowed to disagree: `assertCoverageConsistent`
 * enforces that the legacy number is exactly the photographer count, and
 * `createPackageSnapshot` calls it on every write.
 */

export const coverageRoleSchema = z.enum(["photographer", "videographer"]);

export type CoverageRole = z.infer<typeof coverageRoleSchema>;

/** Display order wherever the full list is rendered. */
export const COVERAGE_ROLES: readonly CoverageRole[] = [
  "photographer",
  "videographer",
];

const COVERAGE_ROLE_LABELS: Record<CoverageRole, { one: string; many: string }> = {
  photographer: { one: "photographer", many: "photographers" },
  videographer: { one: "videographer", many: "videographers" },
};

export function coverageRoleLabel(role: CoverageRole, count: number): string {
  const labels = COVERAGE_ROLE_LABELS[role];
  return count === 1 ? labels.one : labels.many;
}

export const coverageItemSchema = z.object({
  role: coverageRoleSchema,
  count: z.number().int().positive().max(50),
});

export type CoverageItem = z.infer<typeof coverageItemSchema>;

/**
 * A package includes at least one person, and names each role at most once —
 * two entries for "photographer" would make every count ambiguous.
 */
export const includedCoverageSchema = z
  .array(coverageItemSchema)
  .min(1)
  .max(COVERAGE_ROLES.length)
  .superRefine((items, ctx) => {
    const seen = new Set<CoverageRole>();
    for (const item of items) {
      if (seen.has(item.role)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Coverage names ${item.role} more than once.`,
        });
      }
      seen.add(item.role);
    }
  });

export type IncludedCoverage = z.infer<typeof includedCoverageSchema>;

/** Sorted into display order, so two equal coverages compare equal. */
export function normaliseCoverage(
  items: readonly CoverageItem[],
): IncludedCoverage {
  return COVERAGE_ROLES.flatMap((role) => {
    const found = items.find((item) => item.role === role);
    return found ? [{ role, count: found.count }] : [];
  });
}

/**
 * Two packages on one job, as one crew requirement.
 *
 * A studio selling photography and video on the same wedding holds two
 * packages, and the crew it has to send is the sum of both — three
 * photographers and two videographers, not whichever package happened to be
 * locked first. The reference studio asked for this three times: "clients can
 * pick either a photography package or a videography package or can select a
 * photography and video package."
 *
 * Summed rather than merged by maximum, because the two packages describe
 * different work happening at the same wedding. A photo package wanting two
 * photographers and a video package wanting two videographers needs four
 * people, and a rule that took the larger of each role would send two.
 */
export function combineCoverage(
  coverages: readonly (readonly CoverageItem[])[],
): IncludedCoverage {
  const totals = new Map<CoverageRole, number>();
  for (const coverage of coverages) {
    for (const item of coverage) {
      totals.set(item.role, (totals.get(item.role) ?? 0) + item.count);
    }
  }
  return normaliseCoverage(
    [...totals].map(([role, count]) => ({ role, count })),
  );
}

export function coverageFromPhotographerCount(count: number): IncludedCoverage {
  return [{ role: "photographer", count: Math.max(1, Math.trunc(count)) }];
}

export function coverageCount(
  coverage: readonly CoverageItem[],
  role: CoverageRole,
): number {
  return coverage.find((item) => item.role === role)?.count ?? 0;
}

/** Everyone the studio is sending, across every role. */
export function totalCoverageCount(coverage: readonly CoverageItem[]): number {
  return coverage.reduce((sum, item) => sum + item.count, 0);
}

/**
 * The value written to the legacy `includedPhotographers` field. A video-only
 * package writes 0 — which is why both schemas accept a non-negative number
 * where they once demanded a positive one.
 */
export function legacyPhotographerCount(
  coverage: readonly CoverageItem[],
): number {
  return coverageCount(coverage, "photographer");
}

type CoverageBearingRecord = {
  includedCoverage?: unknown;
  includedPhotographers?: unknown;
};

/**
 * The only way to read coverage off a package or a snapshot.
 *
 * Takes `unknown` deliberately: callers hand it Firestore document data, a
 * parsed record, or a loosely-typed row off the live client views, and a
 * reader that refuses one of those is a reader someone will work around. It
 * answers for records written before coverage had roles.
 */
export function resolveCoverage(record: unknown): IncludedCoverage {
  const source: CoverageBearingRecord =
    typeof record === "object" && record !== null
      ? (record as CoverageBearingRecord)
      : {};
  const parsed = includedCoverageSchema.safeParse(source.includedCoverage);
  if (parsed.success) {
    return normaliseCoverage(parsed.data);
  }
  const legacy = Number(source.includedPhotographers);
  return coverageFromPhotographerCount(Number.isFinite(legacy) ? legacy : 1);
}

/**
 * "2 photographers and 1 videographer" — the client-facing sentence.
 *
 * Used on the proposal and in the couple's portal, so it must never name a
 * role the package does not include.
 */
export function describeCoverage(coverage: readonly CoverageItem[]): string {
  const parts = normaliseCoverage([...coverage]).map(
    (item) => `${item.count} ${coverageRoleLabel(item.role, item.count)}`,
  );
  const last = parts.pop();
  if (last === undefined) return "";
  return parts.length ? `${parts.join(", ")} and ${last}` : last;
}

/**
 * The drift guard for the dual write. Called on every snapshot write, and
 * pinned by tests, because two fields describing one fact is exactly the shape
 * that goes quietly wrong.
 */
export function assertCoverageConsistent(record: {
  includedCoverage: readonly CoverageItem[];
  includedPhotographers: number;
}): void {
  const expected = legacyPhotographerCount(record.includedCoverage);
  if (record.includedPhotographers !== expected) {
    throw new Error(
      `includedPhotographers (${record.includedPhotographers}) disagrees with coverage (${expected} photographer(s)).`,
    );
  }
}
