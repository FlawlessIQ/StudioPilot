import {
  rankCrewCandidates,
  type CrewCandidateInput,
  type CrewCandidateRecommendation,
} from "./cascade.js";
import {
  combineCoverage,
  coverageRoleLabel,
  resolveCoverage,
  type CoverageItem,
  type CoverageRole,
} from "../packages/coverage.js";
import { isLiveAssignment } from "./job-stopped.js";

/**
 * Who this job still has to book, and who should be offered each role.
 *
 * The cascade workspace has always built this in the browser, and built it
 * wrong for any package sending more than one trade:
 *
 *  - It ranked everybody **once**, against a single specialty defaulting to
 *    "weddings", and then split the one ranked list across roles by
 *    `index % roles.length`. So which role a person was offered depended on
 *    where they happened to land in a list that never knew the roles existed.
 *    A videographer could be offered the second-photographer slot, and the
 *    screen's own promise — "each candidate appears in only one role plan" —
 *    held only by arithmetic accident.
 *  - `crewRequired` counted the assignments that already existed, falling back
 *    to 1 when the package "needs a second shooter". A package sending two
 *    photographers and a videographer therefore read as needing one person.
 *
 * This module answers both questions from the package's own coverage, ranks
 * each role against the specialty that role actually calls for, and hands out
 * candidates so nobody is offered two roles on the same day.
 *
 * Pure and deterministic — no I/O, no Firebase. Duplicated at
 * functions/src/crew/staffing-plan.ts, which is what lets booking prepare the
 * plan server-side; tests/crew-staffing-plan.ts keeps the copies identical.
 */

/** Crew profiles carry `video`; there is no "photographer" specialty. */
export const VIDEO_SPECIALTY = "video";

/**
 * What to rank a role against.
 *
 * Photography roles rank against the **event's** specialty — weddings,
 * corporate, sports — because that is how crew describe themselves; there is
 * no "photographer" in `crewSpecialtySchema`, and ranking against the word
 * would exclude everyone. Video is its own trade and ranks against `video`,
 * which the cascade's substring match reaches from "videographer".
 */
export function specialtyForCoverageRole(
  role: CoverageRole,
  eventSpecialty: string,
): string {
  return role === "videographer" ? VIDEO_SPECIALTY : eventSpecialty;
}

export type StaffingGap =
  /** Nobody on the roster can work this role on this date. */
  | { kind: "no_eligible_candidate"; reason: string }
  /** Someone can, but everyone available is already taken by another role. */
  | { kind: "all_candidates_taken"; reason: string };

export type StaffingRolePlan = {
  /** What the offer is labelled, e.g. "Second photographer", "Videographer". */
  role: string;
  coverageRole: CoverageRole;
  /** The specialty this role was ranked against. */
  specialty: string;
  /** Ranked, eligible, and offered to nobody else on this job. */
  candidates: CrewCandidateRecommendation[];
  /** Everyone considered for the role, including the ineligible. */
  considered: CrewCandidateRecommendation[];
  /** Null when the role has at least one candidate to offer. */
  gap: StaffingGap | null;
};

export type StaffingPlan = {
  roles: StaffingRolePlan[];
  /** People the package sends, in total. */
  coverageTotal: number;
  /** People still to book once the studio covers its own place. */
  toBook: number;
  /**
   * The one place the studio works itself, if any. Stated rather than assumed
   * silently, because it is the difference between booking one videographer
   * and booking two.
   */
  studioCovers: { role: CoverageRole; label: string } | null;
  /** Roles that could not be given anyone. */
  gaps: StaffingRolePlan[];
};

/**
 * The roles a package still has to fill, in order.
 *
 * The studio is one of the people it sends — the existing assumption, which
 * was hard-coded to photographers. It now applies to whichever role the
 * package leads with, so a video-only package books one fewer videographer
 * rather than booking a crew of two and leaving the owner idle.
 */
export function rolesToBook(
  coverage: readonly CoverageItem[],
  /**
   * Whether the owner shoots this one. Usually yes — but a studio sometimes
   * sends crew for every role and isn't there itself, so it is a per-job
   * choice (`ownerShootsJob`), not a rule (GR Productions, 2026-09-30).
   */
  ownerCovers = true,
): {
  roles: { role: string; coverageRole: CoverageRole }[];
  studioCovers: { role: CoverageRole; label: string } | null;
} {
  const ordered = coverage.filter((item) => item.count > 0);
  const lead = ownerCovers ? ordered[0] : undefined;
  const roles: { role: string; coverageRole: CoverageRole }[] = [];
  for (const item of ordered) {
    const covered = item.role === lead?.role ? 1 : 0;
    const needed = Math.max(0, item.count - covered);
    for (let index = 0; index < needed; index += 1) {
      roles.push({
        role: offerLabel(item.role, index, covered, needed),
        coverageRole: item.role,
      });
    }
  }
  return {
    roles,
    studioCovers: lead
      ? { role: lead.role, label: coverageRoleLabel(lead.role, 1) }
      : null,
  };
}

/**
 * What the crew member sees this offer called.
 *
 * "Second photographer" is the phrase the trade uses and the one this product
 * already sent, so it survives; everything after it is numbered plainly.
 */
function offerLabel(
  role: CoverageRole,
  index: number,
  studioCovered: number,
  needed: number,
): string {
  const noun = coverageRoleLabel(role, 1);
  const title = noun.replace(/^./, (character) => character.toUpperCase());
  // Their place among everyone of that role, the studio's own place included.
  const position = index + 1 + studioCovered;
  if (studioCovered === 1) {
    // The studio works one of these itself, so the first hire is the second
    // person. "Second photographer" is the phrase the trade uses and the one
    // this product already sent; every trade gets the same treatment, because
    // a videographer offered "Videographer 2" reads like a serial number.
    return position === 2 ? `Second ${noun}` : `${title} ${position}`;
  }
  // The only one of their trade on the job needs no number.
  return needed === 1 ? title : `${title} ${position}`;
}

/**
 * Build the staffing plan.
 *
 * Candidates are dealt out a round at a time rather than a role at a time: the
 * first role does not get to take every good person before the second role is
 * considered. Within a round each role takes its own next-best unclaimed
 * candidate, so a videographer ranked first for video is not lost to the
 * photography slot.
 */
/**
 * Which trade a role label belongs to.
 *
 * The staffing screen lets the studio retitle a role — "Second shooter",
 * "Video lead" — and a retitled role still has to rank against the right
 * trade. Anything naming video is video; everything else is photography,
 * which is what an unrecognised role has always been treated as.
 */
export function coverageRoleForLabel(label: string): CoverageRole {
  // A DJ studio's crew (trades.ts): "DJ", "Second DJ", "MC".
  if (/\bdj\b|disc jockey|\bmc\b/i.test(label)) return "dj";
  // A makeup or hair studio's crew (trades.ts).
  if (/make.?up|\bmua\b|\bartist\b/i.test(label)) return "makeup_artist";
  if (/\bhair\b|stylist/i.test(label)) return "hair_stylist";
  return /video/i.test(label) ? "videographer" : "photographer";
}

/**
 * Whether a role label names a trade the studio actually staffs.
 *
 * `coverageRoleForLabel` above is deliberately total: a studio can retitle a
 * role to "Second shooter" or "Video lead" and it still has to rank against
 * the right trade, so anything unrecognised is treated as photography. That is
 * correct for a role the studio typed on its own staffing screen.
 *
 * It is wrong for a role somebody asked Cue for. Asked to add a "drone
 * operator", Cue opened the crew flow and reported the drone operator role as
 * unfilled — StudioCue has no such role, nobody on the roster holds one, and
 * the label would have ranked photographers. This distinguishes "a name for a
 * trade we staff" from "a specialism we do not", which is the question that
 * was being answered by accident.
 *
 * Null means neither, and is a fact about StudioCue rather than about the
 * person asking.
 */
export function coverageTradeNamed(label: string): CoverageRole | null {
  if (/\bdj\b|disc jockey|\bmc\b/i.test(label)) return "dj";
  if (/make.?up|\bmua\b/i.test(label)) return "makeup_artist";
  if (/\bhair\b|stylist/i.test(label)) return "hair_stylist";
  if (/video|cinema|film|drone|aerial/i.test(label)) {
    // Drone and aerial work name a camera, not this studio's video trade.
    return /drone|aerial/i.test(label) ? null : "videographer";
  }
  if (/photo|shooter|stills|camera|portrait/i.test(label)) return "photographer";
  return null;
}

/**
 * Deal candidates across a known list of roles.
 *
 * Split out from `planCrewStaffing` because the staffing screen works from
 * role labels the studio can edit, while booking works from the package's
 * coverage. Both need the same dealing: a round at a time, nobody twice.
 */
export function assignCandidatesToRoles(input: {
  roles: readonly { role: string; coverageRole: CoverageRole }[];
  eventSpecialty: string;
  serviceArea: string;
  startsAt: string;
  endsAt: string;
  candidates: readonly CrewCandidateInput[];
  excludedIds?: readonly string[];
  depth?: number;
  /**
   * The studio's own order, when they have set one.
   *
   * The staffing screen offers arrows under the copy "You control the final
   * order", and that order used to reach only the list on screen — the plan
   * that actually goes out was recomputed from the engine ranking alone, so
   * moving a preferred second shooter to the top changed the display and
   * nothing else. Empty (the normal case) leaves the engine's order untouched.
   */
  preferredOrder?: readonly string[];
  /**
   * The studio's standing first-call order, per trade.
   *
   * GR Productions (2026-10-06): "How do I order crew members for staffing
   * events? And categorize them by types." The order above is one job's; this
   * is the studio's every-job answer — "for a second shooter, Albert first,
   * then Vittor" — set once on the Crew page (tenant `crewOffers.firstCall`).
   * A job's own order still wins where it has one; the engine's ranking
   * decides only among the people the studio has not placed.
   */
  firstCall?: Partial<Record<CoverageRole, readonly string[]>>;
}): StaffingRolePlan[] {
  const excluded = new Set(input.excludedIds ?? []);
  const depth = Math.max(1, input.depth ?? 5);
  // Rank by the studio's position where they have given one, and leave
  // everyone else in the engine's order behind them. Stable, so candidates
  // the studio never touched keep their relative ranking.
  const positions = (order: readonly string[] | undefined) =>
    new Map((order ?? []).map((id, index) => [id, index]));
  const preferred = positions(input.preferredOrder);
  const applyPreference = (
    ranked: CrewCandidateRecommendation[],
    trade: CoverageRole,
  ) => {
    const standing = positions(input.firstCall?.[trade]);
    if (!preferred.size && !standing.size) return ranked;
    const last = Number.MAX_SAFE_INTEGER;
    return ranked
      .map((candidate, index) => ({ candidate, index }))
      .sort((left, right) => {
        const leftRank = preferred.get(left.candidate.crewProfileId) ?? last;
        const rightRank = preferred.get(right.candidate.crewProfileId) ?? last;
        if (leftRank !== rightRank) return leftRank - rightRank;
        const leftCall = standing.get(left.candidate.crewProfileId) ?? last;
        const rightCall = standing.get(right.candidate.crewProfileId) ?? last;
        if (leftCall !== rightCall) return leftCall - rightCall;
        return left.index - right.index;
      })
      .map((entry) => entry.candidate);
  };

  const rankedFor = new Map<string, CrewCandidateRecommendation[]>();
  const rankFor = (specialty: string, trade: CoverageRole) => {
    // Keyed by both: a photographer role on a video-specialty event resolves
    // to the same specialty string as the videographer role beside it, and
    // caching on specialty alone would hand one role the other's ranking.
    const key = `${trade}\u0000${specialty}`;
    const cached = rankedFor.get(key);
    if (cached) return cached;
    const ranked = rankCrewCandidates({
      roleSpecialty: specialty,
      // The studio's own statement of what this person does, where they have
      // made one — see the trade note in features/crew/schema.ts.
      roleTrade: trade,
      serviceArea: input.serviceArea,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      candidates: input.candidates,
    });
    const ordered = applyPreference(ranked, trade);
    rankedFor.set(key, ordered);
    return ordered;
  };

  const plans: StaffingRolePlan[] = input.roles.map((entry) => {
    const specialty = specialtyForCoverageRole(
      entry.coverageRole,
      input.eventSpecialty,
    );
    return {
      role: entry.role,
      coverageRole: entry.coverageRole,
      specialty,
      candidates: [],
      considered: rankFor(specialty, entry.coverageRole),
      gap: null,
    };
  });

  // Deal a round at a time so no role is starved by the one before it.
  const claimed = new Set<string>(excluded);
  for (let round = 0; round < depth; round += 1) {
    for (const plan of plans) {
      const next = plan.considered.find(
        (candidate) => candidate.eligible && !claimed.has(candidate.crewProfileId),
      );
      if (!next) continue;
      claimed.add(next.crewProfileId);
      plan.candidates.push(next);
    }
  }

  for (const plan of plans) {
    if (plan.candidates.length) continue;
    const anyEligible = plan.considered.some((candidate) => candidate.eligible);
    plan.gap = anyEligible
      ? {
          kind: "all_candidates_taken",
          reason: `Everyone who could work as ${plan.role.toLocaleLowerCase()} is already offered another role on this job.`,
        }
      : {
          kind: "no_eligible_candidate",
          reason: `Nobody on your roster is free for ${plan.role.toLocaleLowerCase()} on this date.`,
        };
  }
  return plans;
}

export function planCrewStaffing(input: {
  coverage: readonly CoverageItem[];
  /** The event's specialty — "weddings", "corporate", "sports". */
  eventSpecialty: string;
  serviceArea: string;
  startsAt: string;
  endsAt: string;
  candidates: readonly CrewCandidateInput[];
  /** Crew the studio has taken off this job by hand. */
  excludedIds?: readonly string[];
  /** How deep each role's cascade should go. */
  depth?: number;
  /** Whether the owner shoots this job (see `ownerShootsJob`). */
  ownerCovers?: boolean;
  /** The studio's standing first-call order per trade (see `assignCandidatesToRoles`). */
  firstCall?: Partial<Record<CoverageRole, readonly string[]>>;
}): StaffingPlan {
  const { roles, studioCovers } = rolesToBook(input.coverage, input.ownerCovers ?? true);
  const plans = assignCandidatesToRoles({ ...input, roles });
  const coverageTotal = input.coverage.reduce((sum, item) => sum + item.count, 0);
  return {
    roles: plans,
    coverageTotal,
    toBook: roles.length,
    studioCovers,
    gaps: plans.filter((plan) => plan.gap !== null),
  };
}

/**
 * How many people this job needs booked, for readiness and the journey rail.
 *
 * Both used to ask the assignments that already existed, which is zero before
 * anyone is offered anything, and fell back to 1. The package knows the answer
 * from the moment it is selected.
 */
export function crewRequiredFromCoverage(
  coverage: readonly CoverageItem[],
  ownerCovers = true,
): number {
  return rolesToBook(coverage, ownerCovers).roles.length;
}

/**
 * Whether the owner shoots this job: yes unless the studio said "not me this
 * time" on the job (`ownerShooting: false`).
 */
export function ownerShootsJob(project: unknown): boolean {
  return !(
    typeof project === "object" &&
    project !== null &&
    (project as Record<string, unknown>).ownerShooting === false
  );
}

/**
 * The package snapshots a job rests on: the primary, then any added.
 *
 * A photo + video wedding carries two — `packageSnapshotId` and
 * `additionalPackageSnapshotIds` — and every reader of "how much crew does
 * this job need" read the primary alone. GR Productions sells photography and
 * video together, so the videographer its couples paid for was invisible to
 * readiness, to the journey rail and to the manual crew plan. Capped at three
 * additional, the same as the booking-time planner
 * (functions/src/crew/prepare-staffing.ts).
 */
export function jobPackageSnapshotIds(project: unknown): string[] {
  const source =
    typeof project === "object" && project !== null
      ? (project as Record<string, unknown>)
      : {};
  const primary =
    typeof source.packageSnapshotId === "string" ? source.packageSnapshotId : "";
  const additional = Array.isArray(source.additionalPackageSnapshotIds)
    ? source.additionalPackageSnapshotIds
        .map((value) => (typeof value === "string" ? value : ""))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  return [...new Set([primary, ...additional].filter(Boolean))];
}

/**
 * Everyone a job's packages send, summed across them.
 *
 * No snapshot at all is no coverage, not the one-photographer fallback
 * `resolveCoverage` applies to a *record*: a job with nothing selected has not
 * said who is coming.
 */
export function jobCoverage(snapshots: readonly unknown[]): CoverageItem[] {
  if (!snapshots.length) return [];
  return combineCoverage(snapshots.map((snapshot) => resolveCoverage(snapshot)));
}

// Any assignment record: a Firestore document, a live client row. Only
// `status`, `role` and `acknowledgedScheduleVersion` are read.
export type CrewDemandAssignment = Readonly<Record<string, unknown>>;

export type CrewDemand = {
  /** People the job needs booked, per trade, never fewer than are live. */
  crewRequired: number;
  /** Accepted, each counted against its own trade. */
  crewAccepted: number;
  /** Accepted and acknowledged the current schedule version. */
  crewAcknowledgedCurrent: number;
  /** The packages send someone besides the studio itself. */
  packageNeedsCrew: boolean;
  /** Roles nobody holds a live offer or booking for, in offer order. */
  open: { role: string; coverageRole: CoverageRole }[];
};

/**
 * How much crew a job needs, and how much of that is settled — by trade.
 *
 * Readiness, the journey rail and Today each worked this out differently, and
 * all of them counted heads: the server took every assignment ever made
 * (declined and expired included) as the requirement, and the browser took
 * the primary package's photographers. So a wedding needing a videographer
 * could read "crew confirmed" the moment a second photographer said yes.
 *
 * Counted per trade instead. A trade's requirement is what the packages send,
 * or the people the studio has live in it if that is more (hiring beyond the
 * package does not make the package wrong); an acceptance only settles its
 * own trade. Withdrawn, declined and expired offers are history and count for
 * nothing.
 */
export function crewDemand(input: {
  coverage: readonly CoverageItem[];
  assignments: readonly CrewDemandAssignment[];
  scheduleVersion?: number | null;
  /** Whether the owner shoots this job (see `ownerShootsJob`). */
  ownerCovers?: boolean;
}): CrewDemand {
  const toBook = rolesToBook(input.coverage, input.ownerCovers ?? true).roles;
  const live = input.assignments.filter((assignment) =>
    isLiveAssignment(assignment.status),
  );
  const tradeOf = (assignment: CrewDemandAssignment) =>
    coverageRoleForLabel(
      typeof assignment.role === "string" ? assignment.role : "",
    );
  const trades = [
    ...new Set<CoverageRole>([
      ...toBook.map((role) => role.coverageRole),
      ...live.map(tradeOf),
    ]),
  ];
  let crewRequired = 0;
  let crewAccepted = 0;
  let crewAcknowledgedCurrent = 0;
  const open: CrewDemand["open"] = [];
  for (const trade of trades) {
    const needed = toBook.filter((role) => role.coverageRole === trade);
    const held = live.filter((assignment) => tradeOf(assignment) === trade);
    const accepted = held.filter(
      (assignment) => assignment.status === "accepted",
    );
    crewRequired += Math.max(needed.length, held.length);
    crewAccepted += accepted.length;
    crewAcknowledgedCurrent += accepted.filter(
      (assignment) =>
        Number(assignment.acknowledgedScheduleVersion ?? -1) ===
        Number(input.scheduleVersion ?? 0),
    ).length;
    open.push(...needed.slice(held.length));
  }
  return {
    crewRequired,
    crewAccepted,
    crewAcknowledgedCurrent,
    packageNeedsCrew: toBook.length > 0,
    open,
  };
}
