/**
 * A planner's two vendor-team readiness checks, from the records
 * (docs/planner-journey-plan.md, the burden check): "Vendor team complete"
 * and "Vendors confirmed".
 *
 * The same reading as features/vendors/team.ts `vendorTeamProgress`
 * (`teamComplete`, `allConfirmed`), which the job page's steps and the
 * browser's readiness meter use; tests/planner-journey.test.ts holds the two
 * to the same answers. Pure, no imports.
 */

type Row = { [key: string]: unknown };

const live = (share: Row) => String(share.status ?? "") !== "revoked" && !share.revokedAt;

/** The newest schedule's version when it is published; null before one is. */
export function publishedVersionOf(schedules: readonly Row[]): number | null {
  const latest = [...schedules].sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0];
  return latest && latest.status === "published" ? Number(latest.version) || null : null;
}

export function teamReadiness(
  entries: readonly Row[],
  shares: readonly Row[],
  currentVersion: number | null,
): { vendorTeamComplete: boolean; vendorsConfirmed: boolean } {
  const current = entries.filter((entry) => !entry.archivedAt);
  const status = (entry: Row) => (["needed", "considering", "booked", "declined"].includes(String(entry.status)) ? String(entry.status) : "needed");
  const booked = current.filter((entry) => status(entry) === "booked");
  const open = current.filter((entry) => status(entry) === "needed" || status(entry) === "considering").length;
  const byVendor = new Map<string, Row>();
  for (const share of shares) {
    const vendorId = String(share.vendorContactId ?? "");
    if (vendorId && live(share)) byVendor.set(vendorId, share);
  }
  const confirmed = booked.filter((entry) => {
    const share = byVendor.get(typeof entry.vendorId === "string" ? entry.vendorId : "");
    if (!share) return false;
    if (currentVersion !== null && Number(share.sharedVersion ?? 0) < currentVersion) return false;
    return String(share.status) === "acknowledged";
  }).length;
  return {
    vendorTeamComplete: booked.length > 0 && open === 0,
    vendorsConfirmed: booked.length > 0 && confirmed === booked.length,
  };
}
