import type { CoverageItem } from "@/features/packages/coverage";
import { suggestedResponsibilitiesText } from "@/features/crew/responsibilities";
import {
  coverageTradeNamed,
  crewDemand,
  type CrewDemandAssignment,
} from "@/features/crew/staffing-plan";

/**
 * What a one-person offer opens on.
 *
 * The direct-invite form opened on "Second photographer" whatever the job, so
 * a studio offering its videographer the video slot on a photo + video wedding
 * sent "Second photographer" unless it noticed and retyped it — and the trade
 * is read out of that label everywhere downstream (coverageRoleForLabel).
 *
 * The job already says what it is short of: the first role nobody holds a
 * live offer or booking for (`crewDemand(...).open`), the same answer the
 * cascade and Cue give. When nothing is open — the package is covered, or no
 * package is chosen — it is "Crew", which names no trade rather than the wrong
 * one. Responsibilities follow the role; a role naming no trade gets the list
 * that names both, because that is the one the studio will obviously edit.
 */
export function directOfferDefaults(input: {
  coverage: readonly CoverageItem[];
  assignments: readonly CrewDemandAssignment[];
  ownerCovers: boolean;
}): { role: string; responsibilities: string } {
  const role =
    crewDemand({
      coverage: input.coverage,
      assignments: input.assignments,
      ownerCovers: input.ownerCovers,
    }).open[0]?.role ?? "Crew";
  return { role, responsibilities: offerResponsibilities(role) };
}

/** The prefill for a role as typed, trade-aware. */
export function offerResponsibilities(role: string): string {
  return coverageTradeNamed(role)
    ? suggestedResponsibilitiesText([role])
    : suggestedResponsibilitiesText(["Photographer", "Videographer"]);
}
