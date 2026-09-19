import {
  rankCrewCandidates,
  type CrewCandidateInput,
  type CrewCandidateRecommendation,
} from "./cascade";
import {
  coverageRoleLabel,
  type CoverageItem,
  type CoverageRole,
} from "@/features/packages/coverage";

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
export function rolesToBook(coverage: readonly CoverageItem[]): {
  roles: { role: string; coverageRole: CoverageRole }[];
  studioCovers: { role: CoverageRole; label: string } | null;
} {
  const ordered = coverage.filter((item) => item.count > 0);
  const lead = ordered[0];
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
  if (role === "photographer" && position === 2) return "Second photographer";
  // The only one of their trade on the job needs no number.
  if (needed === 1 && studioCovered === 0) return title;
  return `${title} ${position}`;
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
  return /video/i.test(label) ? "videographer" : "photographer";
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
}): StaffingRolePlan[] {
  const excluded = new Set(input.excludedIds ?? []);
  const depth = Math.max(1, input.depth ?? 5);

  const rankedFor = new Map<string, CrewCandidateRecommendation[]>();
  const rankFor = (specialty: string) => {
    const cached = rankedFor.get(specialty);
    if (cached) return cached;
    const ranked = rankCrewCandidates({
      roleSpecialty: specialty,
      serviceArea: input.serviceArea,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      candidates: input.candidates,
    });
    rankedFor.set(specialty, ranked);
    return ranked;
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
      considered: rankFor(specialty),
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
}): StaffingPlan {
  const { roles, studioCovers } = rolesToBook(input.coverage);
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
): number {
  return rolesToBook(coverage).roles.length;
}
