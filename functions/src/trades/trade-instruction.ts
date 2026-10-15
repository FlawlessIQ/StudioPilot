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
export function tradeInstruction(
  trade: unknown,
  /**
   * Writing to a client: leave out the how-to facts. They name the studio's
   * own screens ("Lay out the morning", the trial card, the crew's brief), and
   * an inquiry reply to a mitzvah family explained them (prod walk, 2026-10-14).
   */
  options: { forClient?: boolean } = {},
): string {
  const profile = tradeProfile(trade);
  const howTo = !options.forClient;
  if (profile.family === "photo") return "";
  const words = tradeVocab(trade);
  const roles = profile.coverageRoles.map((role) => coverageRoleLabel(role as CoverageRole, 2)).join(" and ");
  return [
    ` This studio is a ${words.business}, not a photography studio: its owner works events as a ${words.provider}, and its crew are ${words.crew}.`,
    ` ${profile.consultation ? `Call the sales call a ${words.consultation.toLowerCase()}, the` : "Call the"} ${profile.journey.walkthrough ? "meeting before the event the venue walkthrough" : `call before the event the ${words.finalCall.toLowerCase()}`}${words.detailsForm ? `, and the planning form the ${words.detailsForm}` : ""}${words.planOfDay ? `; the plan of the day is the ${words.planOfDay}` : ""}.`,
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
    howTo && profile.musicPlanner
      ? ` How-to facts for this studio: the ${words.detailsForm ?? "planning form"} goes to the couple when they book and locks ${profile.planning?.lockDaysBefore ?? 10} days before the event. On the job's run of show, "Lay out the night" builds the running order from it, each line with its song, what to say on the mic and how to say the names (the MC script); once published it prints on the run-of-show PDF and each DJ's day sheet.`
      : "",
    howTo && profile.chairSchedule
      ? ` How-to facts for this studio:${words.trial ? ` the job's ${words.trial.toLowerCase()} card invites the client to book the trial from the studio's trial hours, and after it the look and products are saved there for the crew's brief;` : ""} the ${words.detailsForm ?? "planning form"} goes to the client when they book, one person per line, and locks ${profile.planning?.lockDaysBefore ?? 30} days before the event (the headcount can grow after that, not shrink); on the ${(words.planOfDay ?? "schedule").toLowerCase()}, "Lay out the morning" gives everyone a chair worked back from the ready-by time;${words.kitChecklist ? ` the ${words.kitChecklist.title.toLowerCase()} goes in the crew's reminder the day before;` : ""} the balance is due ${profile.balanceDueDaysBefore === 0 ? "the morning of the event" : `${profile.balanceDueDaysBefore} days before the event`}.`
      : "",
    // A planner's flows (docs/planner-journey-plan.md): the vendor team is the
    // work, and the couple pays every vendor themselves.
    howTo && profile.journey.vendorSteps
      ? ` How-to facts for this studio: a ${words.consultation.toLowerCase()} comes before every proposal. Each package has a planning tier: full planning, partial planning or month-of coordination. Full and partial planning work the job's vendor team from booking; a month-of couple's ${(words.detailsForm ?? "planning form").toLowerCase()} goes out eight weeks before, and the vendors they list on it join the vendor team, booked. The ${(words.detailsForm ?? "planning form").toLowerCase()} is due four weeks out and locks two weeks out. The job's vendor team panel lists every vendor with their status, arrival time, balance and tip; "Vendor team" is done when every vendor the wedding needs is booked. The job's walkthrough card invites the couple to book the venue walkthrough, four to six weeks out. On the ${(words.planOfDay ?? "schedule").toLowerCase()}, "Add vendor arrivals" draws each booked vendor's arrival from the team; once it is published, one press on the vendor team sends every booked vendor their part and each confirms from their link ("Vendors confirmed", e.g. "7 of 9 confirmed"). The day before, the ${(words.kitChecklist?.title ?? "kit").toLowerCase()} and the payments and tips to hand out (from the team) are on the job and in the assistants' reminder. After the day, "Send vendor credits" emails the couple every vendor's name and website. The couple contracts with and pays every vendor directly: never say the studio pays vendors or holds their money. The balance is due ${profile.balanceDueDaysBefore} days before the wedding.`
      : "",
    profile.delivery ? "" : " Nothing is delivered after the event — no gallery, album, editing or film — so after the event the only steps are the review and closing the job.",
    ` Never call this studio a photographer or mention photography, photos, galleries, albums or a shoot, to the operator or in anything written to clients.`,
    ` For this studio StudioCue staffs ${roles} only; a crew role must name one.`,
  ].join("");
}
