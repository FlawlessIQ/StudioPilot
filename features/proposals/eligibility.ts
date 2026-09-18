import { isPutAway } from "../projects/put-away";
import { stageRank } from "../projects/stage-progress";

/**
 * Whether a job can take a proposal, and — when it cannot — what to say.
 *
 * The stage rule already existed, server-side, as a bare boolean in
 * functions/src/booking/proposal-domain.ts. Nothing on the client knew it, so
 * three surfaces linked into the composer from stages the command would refuse:
 * the journey offered "Prepare proposal" on a job still at LEAD, and the
 * booking autopilot offered "Add one for the record" on a job already booked.
 *
 * The composer's own failure was worse than a dead link. It read `?project=`,
 * looked for that id in the list of *eligible* jobs, found nothing, and said
 * nothing — leaving the studio in front of a picker holding two unrelated
 * weddings with the first one preselected-looking. Clicked from "Add one for
 * the record" on the Smith wedding, the next thing on screen was a priced offer
 * for the Chen wedding. Silence is not an acceptable answer to a question the
 * product asked itself.
 *
 * So the rule lives here, in one place, with the reason attached — callers that
 * only need the boolean take `canCreateProposalForProject`, and the composer
 * takes the verdict so it can name the job and say which way to go.
 *
 * Pure.
 */

export type ProposalStageVerdict =
  /** CONSULTATION or PROPOSAL — the offer is the studio's move. */
  | "ready"
  /** Archived, by state or by `archivedAt`. Nothing should be prepared. */
  | "put_away"
  /** LEAD — the consultation comes first. */
  | "too_early"
  /** CONTRACT_PENDING onwards — the offer stage is behind this job. */
  | "past"
  /** CANCELLED or POSTPONED — not a job anyone should be pricing today. */
  | "not_active";

export function canCreateProposalForProject(state: string): boolean {
  return state === "CONSULTATION" || state === "PROPOSAL";
}

export function proposalStageVerdict(project: unknown): ProposalStageVerdict {
  const fields = (project ?? {}) as { state?: unknown };
  const state = String(fields.state ?? "");
  // Put away wins over the stage: an archived job at CONSULTATION is still a
  // job the studio has filed, and the delivery picker's five archived weddings
  // were the same mistake one dropdown over.
  if (isPutAway(project)) return "put_away";
  if (canCreateProposalForProject(state)) return "ready";
  if (state === "CANCELLED" || state === "POSTPONED") return "not_active";
  if (stageRank(state) < stageRank("CONSULTATION")) return "too_early";
  return "past";
}

/**
 * What the composer tells a studio who arrived from a link that cannot work.
 *
 * Always names the job — the whole failure was a screen that would not say
 * which wedding it was talking about.
 */
export function proposalStageNotice(
  verdict: Exclude<ProposalStageVerdict, "ready">,
  projectName: string,
): { heading: string; detail: string } {
  switch (verdict) {
    case "put_away":
      return {
        heading: `${projectName} has been archived`,
        detail:
          "Archived jobs are not offered here. Restore it from Jobs if this one is live again.",
      };
    case "too_early":
      return {
        heading: `${projectName} is still an enquiry`,
        detail:
          "A proposal starts after the consultation. Mark the consultation done on the job — it takes one click if you already spoke — and come back.",
      };
    case "past":
      return {
        heading: `${projectName} is already past the proposal`,
        detail:
          "Proposals are offers, and this job is booked. Its agreement, retainer and balance are on the job's booking tab.",
      };
    case "not_active":
      return {
        heading: `${projectName} is not an active job`,
        detail:
          "It is cancelled or on hold. Bring it back to a live stage before pricing new work for it.",
      };
  }
}
