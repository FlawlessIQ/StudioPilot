import { isReservedTestAddress } from "../communications/test-address.js";
import { TRADE_LABELS, VENDOR_TYPE_TRADES, vendorTypeLiveTrades, type Trade } from "../trades/trades.js";
import { BOOKED_JOB_STATES, INVITED_VENDOR_TYPES } from "./referral-program.js";

/**
 * The one-off launch sweep (docs/vendor-journeys-plan.md, Phase 6).
 *
 * The daily invite sweep (vendor-invites.ts) only looks back three days, so
 * a DJ or a hair and makeup vendor added to a booked job while their trade
 * wasn't live would never be invited. When a trade launches, this picks the
 * vendors of that trade on upcoming booked jobs; scripts/sweep-vendor-invites.mts
 * then puts each one through the daily sweep's own checks and writes
 * (`checkVendorInvite`, `queueVendorInvite`), so the once-ever record, the
 * opt-out and the studio's switch hold exactly as they do every day.
 *
 * Pure, so the selection is deterministic and unit-tested
 * (tests/vendor-invite-sweep.test.ts): the same records always give the same
 * vendors in the same order.
 */

/** The trades that went live on 2026-10-12. */
export const LAUNCHED_TRADES: readonly Trade[] = ["dj", "makeup", "hair"];

/**
 * The vendor types whose trade just launched: a type invited at all
 * (INVITED_VENDOR_TYPES) with a live trade among `launched`. A videographer's
 * trade was live before, so the daily sweep has always invited them.
 */
export function launchedVendorTypes(launched: readonly Trade[] = LAUNCHED_TRADES): string[] {
  return (INVITED_VENDOR_TYPES as readonly string[]).filter((type) =>
    vendorTypeLiveTrades(type).some((trade) => launched.includes(trade)),
  );
}

/** A vendor record, as the sweep reads it from `vendors/{id}`. */
export type SweepVendor = {
  id: string;
  tenantId: string;
  type: string;
  email: string;
  archived: boolean;
  projectIds: readonly string[];
};

/** A job, as the sweep reads it from `projects/{id}`. */
export type SweepJob = {
  id: string;
  tenantId: string;
  state: string;
  /** YYYY-MM-DD, or empty. */
  eventDate: string;
  archived: boolean;
  /** An imported, quiet booking (`clientAutomationsPausedAt`): its people are never emailed. */
  quiet: boolean;
};

export type SweepCandidate = {
  vendorId: string;
  tenantId: string;
  vendorType: string;
  email: string;
  /** The vendor's upcoming booked job, the soonest first. */
  projectId: string;
  eventDate: string;
};

/** Up to 20 of a vendor's jobs are read, as the daily sweep does. */
const JOBS_READ = 20;

/** The vendor's soonest upcoming booked job in its own studio, or null. */
export function upcomingBookedJobOf(vendor: SweepVendor, jobs: ReadonlyMap<string, SweepJob>, today: string): SweepJob | null {
  const upcoming = vendor.projectIds
    .slice(0, JOBS_READ)
    .map((id) => jobs.get(id))
    .filter(
      (job): job is SweepJob =>
        Boolean(job) &&
        job!.tenantId === vendor.tenantId &&
        !job!.archived &&
        !job!.quiet &&
        (BOOKED_JOB_STATES as readonly string[]).includes(job!.state) &&
        Boolean(job!.eventDate) &&
        job!.eventDate.slice(0, 10) >= today,
    )
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.id.localeCompare(b.id));
  return upcoming[0] ?? null;
}

/**
 * Who the launch sweep would put forward, before the per-address checks
 * (already invited, unsubscribed, a StudioCue user, the studio's own client,
 * the studio's switch and subscription) that `checkVendorInvite` makes.
 *
 * - a type whose trade just launched, with an email, not archived, and not
 *   a reserved test address;
 * - on an upcoming booked job in its own studio that isn't a quiet import;
 * - one per address: the same DJ on three studios' jobs is invited once, by
 *   the first studio in order. Order is by studio, then address, then vendor
 *   id, so a re-run sees the same list.
 */
export function sweepCandidates(
  vendors: readonly SweepVendor[],
  jobs: ReadonlyMap<string, SweepJob>,
  today: string,
  launched: readonly Trade[] = LAUNCHED_TRADES,
): SweepCandidate[] {
  const types = new Set(launchedVendorTypes(launched));
  const picked: SweepCandidate[] = [];
  const sorted = vendors
    .map((vendor) => ({ ...vendor, email: vendor.email.trim().toLowerCase() }))
    .sort((a, b) => a.tenantId.localeCompare(b.tenantId) || a.email.localeCompare(b.email) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  for (const vendor of sorted) {
    if (!vendor.tenantId || !vendor.email || vendor.archived) continue;
    if (!types.has(vendor.type)) continue;
    if (isReservedTestAddress(vendor.email)) continue;
    if (seen.has(vendor.email)) continue;
    const job = upcomingBookedJobOf(vendor, jobs, today);
    if (!job) continue;
    seen.add(vendor.email);
    picked.push({
      vendorId: vendor.id,
      tenantId: vendor.tenantId,
      vendorType: vendor.type,
      email: vendor.email,
      projectId: job.id,
      eventDate: job.eventDate.slice(0, 10),
    });
  }
  return picked;
}

/** How a vendor type is counted: "DJ", or "Makeup or hair" for a hair and makeup vendor. */
export function sweepTradeLabel(vendorType: string): string {
  const trades = VENDOR_TYPE_TRADES[vendorType] ?? [];
  if (!trades.length) return vendorType;
  const [first, ...rest] = trades.map((trade) => TRADE_LABELS[trade]);
  return [first, ...rest.map((label) => label.toLowerCase())].join(" or ");
}

/** Counts per trade and per studio, keys sorted, for the dry run's summary. */
export function sweepCounts(candidates: readonly { tenantId: string; vendorType: string }[]): {
  byTrade: Record<string, number>;
  byStudio: Record<string, number>;
} {
  const byTrade: Record<string, number> = {};
  const byStudio: Record<string, number> = {};
  for (const candidate of candidates) {
    const trade = sweepTradeLabel(candidate.vendorType);
    byTrade[trade] = (byTrade[trade] ?? 0) + 1;
    byStudio[candidate.tenantId] = (byStudio[candidate.tenantId] ?? 0) + 1;
  }
  const sorted = (record: Record<string, number>) =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  return { byTrade: sorted(byTrade), byStudio: sorted(byStudio) };
}
