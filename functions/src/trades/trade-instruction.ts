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
    // The payment that books the date (trades.ts `deposit`; vendor wording sweep, 2026-10-10).
    words.deposit === "retainer" ? "" : ` Call the retainer a ${words.deposit}, to the operator and to clients.`,
    profile.extensions
      ? " Hair extensions are settled at the trial and noted on the job's trial card; extensions to buy or rent are ordered about eight weeks before the day."
      : "",
    // How-to facts for the trade's own flows: Cue answers how-to questions
    // only from the facts it is given (ai/copilot.ts), and those were all a
    // photographer's (vendor journeys, Phase 6; the How-to guides
    // music-planner, trial and party-list say the same).
    profile.musicPlanner
      ? ` How-to facts for this studio: the ${words.detailsForm ?? "planning form"} goes to the couple when they book and locks ${profile.planning?.lockDaysBefore ?? 10} days before the event. On the job's run of show, "Lay out the night" builds the running order from it, each line with its song, what to say on the mic and how to say the names (the MC script); once published it prints on the run-of-show PDF and each DJ's day sheet.`
      : "",
    profile.chairSchedule
      ? ` How-to facts for this studio:${words.trial ? ` the job's ${words.trial.toLowerCase()} card invites the client to book the trial from the studio's trial hours, and after it the look and products are saved there for the crew's brief;` : ""} the ${words.detailsForm ?? "planning form"} goes to the client when they book, one person per line, and locks ${profile.planning?.lockDaysBefore ?? 30} days before the event (the headcount can grow after that, not shrink); on the ${(words.planOfDay ?? "schedule").toLowerCase()}, "Lay out the morning" gives everyone a chair worked back from the ready-by time;${words.kitChecklist ? ` the ${words.kitChecklist.title.toLowerCase()} goes in the crew's reminder the day before;` : ""} the balance is due ${profile.balanceDueDaysBefore === 0 ? "the morning of the event" : `${profile.balanceDueDaysBefore} days before the event`}.`
      : "",
    profile.delivery ? "" : " Nothing is delivered after the event — no gallery, album, editing or film — so after the event the only steps are the review and closing the job.",
    ` Never call this studio a photographer or mention photography, photos, galleries, albums or a shoot, to the operator or in anything written to clients.`,
    ` For this studio StudioCue staffs ${roles} only; a crew role must name one.`,
  ].join("");
}
