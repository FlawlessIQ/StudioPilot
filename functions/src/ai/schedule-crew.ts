import { combineCoverage, resolveCoverage } from "../packages/coverage.js";
import { coverageRoleForLabel } from "../crew/staffing-plan.js";
import { withCrewIds, type CrewAssignable } from "../planning/item-crew.js";

/**
 * Who the run-of-show draft can put on a segment, and what it is told to do
 * with them.
 *
 * The draft's only crew field was `photographerIds`, and the instruction said
 * videographers belonged in it too — but nothing told the model which crew
 * were videographers, or that the job had video at all, so a photo + video
 * wedding came back with the videographer on nothing. The facts now carry
 * each person's trade and whether the packages include video, and the field
 * is `crewIds`.
 */

type Json = Record<string, unknown>;

/** Whether any package on the job sends a videographer. */
export function packagesIncludeVideo(snapshots: readonly Json[]): boolean {
  if (!snapshots.length) return false;
  return combineCoverage(snapshots.map((data) => resolveCoverage(data))).some(
    (item) => item.role === "videographer" && item.count > 0,
  );
}

/**
 * The accepted crew, as the model sees them.
 *
 * `crewProfileId` is the id the model must put in `crewIds` — the same id the
 * editor's picker writes — and `trade` is read out of the role label the way
 * staffing reads it, so "Video lead" is a videographer.
 */
export function scheduleCrewFacts(
  assignments: readonly { id: string; data: Json }[],
) {
  return assignments
    .filter(({ data }) => data.status === "accepted")
    .map(({ id, data }) => {
      const role = typeof data.role === "string" ? data.role : "";
      return {
        sourceId: id,
        role,
        trade: coverageRoleForLabel(role),
        crewProfileId:
          typeof data.crewProfileId === "string" ? data.crewProfileId : null,
      };
    });
}

export const scheduleCrewInstruction =
  "Crew: crewIds names every studio crew member working an item, whatever their trade — photographers and videographers alike — using the crewProfileId from crewFacts. Never invent an id; leave crewIds empty when crewFacts has nobody. When videoCoverage is true the packages include video, so put the videographers (trade \"videographer\") on the moments video covers — getting ready, first look, the ceremony and vows, speeches and toasts, first dance, the exit and anything a highlight film would use — alongside the photographers, not instead of them.";

/**
 * Every id the model might use for a crew member, mapped to their profile id.
 *
 * Told to use `crewProfileId`, a model sometimes reaches for the fact's
 * `sourceId` (the assignment) instead; both resolve to the same person.
 */
export function crewIdAliases(
  facts: ReturnType<typeof scheduleCrewFacts>,
): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const fact of facts) {
    if (!fact.crewProfileId) continue;
    aliases.set(fact.crewProfileId, fact.crewProfileId);
    aliases.set(fact.sourceId, fact.crewProfileId);
  }
  return aliases;
}

/**
 * A drafted item with its crew in both fields.
 *
 * The model is asked for `crewIds`; a reply in the old shape is still read.
 * Ids that are not accepted crew on this job are dropped, so a guessed id can
 * never reach a crew view.
 */
export function normaliseDraftCrew<T extends CrewAssignable>(
  item: T,
  aliases: ReadonlyMap<string, string>,
) {
  const listed: unknown[] = Array.isArray(item.crewIds)
    ? item.crewIds
    : Array.isArray(item.photographerIds)
      ? item.photographerIds
      : [];
  return withCrewIds(
    item,
    listed.flatMap((id) => {
      const profileId = typeof id === "string" ? aliases.get(id) : undefined;
      return profileId ? [profileId] : [];
    }),
  );
}
