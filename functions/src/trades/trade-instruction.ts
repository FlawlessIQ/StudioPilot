import { coverageRoleLabel, type CoverageRole } from "../packages/coverage.js";
import { tradeProfile, tradeVocab } from "./trades.js";

/**
 * What Cue is told about the studio's trade (trades.ts), appended to its
 * prompts. Empty for a photographer: every prompt was written for one.
 *
 * A DJ studio's clients must never read about photos, galleries or a shoot,
 * and Cue must staff DJs, call the sales call a vibe call, and know the
 * planning form is the music planner (docs/vendor-journeys-plan.md, 2.10).
 */
export function tradeInstruction(trade: unknown): string {
  const profile = tradeProfile(trade);
  if (profile.family === "photo") return "";
  const words = tradeVocab(trade);
  const roles = profile.coverageRoles.map((role) => coverageRoleLabel(role as CoverageRole, 2)).join(" and ");
  return [
    ` This studio is a ${words.business}, not a photography studio: its owner works events as a ${words.provider}, and its crew are ${words.crew}.`,
    ` ${profile.consultation ? `Call the sales call a ${words.consultation.toLowerCase()}, the` : "Call the"} call before the event the ${words.finalCall.toLowerCase()}${words.detailsForm ? `, and the planning form the ${words.detailsForm}` : ""}${words.planOfDay ? `; the plan of the day is the ${words.planOfDay}` : ""}.`,
    profile.consultation
      ? ""
      : ` There is no sales call: an inquiry gets a ${words.proposal.toLowerCase()}${words.trial ? `, and the ${words.trial.toLowerCase()} is where the look is settled` : ""}. Never offer to schedule a consultation or a call to talk it through; offer the ${words.proposal.toLowerCase()}${words.trial ? ` and the ${words.trial.toLowerCase()}` : ""} instead.`,
    words.proposal === "Proposal" ? "" : ` Call the proposal a ${words.proposal.toLowerCase()}.`,
    profile.delivery ? "" : " Nothing is delivered after the event — no gallery, album, editing or film — so after the event the only steps are the review and closing the job.",
    ` Never call this studio a photographer or mention photography, photos, galleries, albums or a shoot, to the operator or in anything written to clients.`,
    ` For this studio StudioCue staffs ${roles} only; a crew role must name one.`,
  ].join("");
}
