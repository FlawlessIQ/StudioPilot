import type { JourneyStep, JourneyStepKey } from "@/features/journey/steps";

/**
 * The five arcs a wedding actually moves through.
 *
 * The journey rail lists fifteen steps as fifteen identical ticks, which is
 * an accurate index and a poor map: a photographer reading it has to count
 * to work out whether they are still selling this job or already shooting
 * it. The steps have always grouped — this names the groups.
 *
 * Deliberately not coloured by family. A phase is not a kind, and giving
 * "Prepare" a hue from the kind palette would put the same blue on a phase
 * heading and a schedule glyph meaning two different things. Phases are
 * structure; colour stays on state and kind.
 */
export type JourneyPhase = "enquire" | "book" | "prepare" | "the_day" | "deliver";

export const journeyPhaseLabel: Record<JourneyPhase, string> = {
  enquire: "Enquiry",
  book: "Booking",
  prepare: "Preparation",
  the_day: "The day",
  deliver: "Delivery",
};

const phaseByStep: Record<JourneyStepKey, JourneyPhase> = {
  inquiry: "enquire",
  first_reply: "enquire",
  consultation: "enquire",

  proposal: "book",
  contract: "book",
  retainer: "book",

  schedule_form: "prepare",
  run_of_show: "prepare",
  crew: "prepare",
  coi: "prepare",

  // The balance falls due in the run-up, not the planning — it belongs with
  // the week of the wedding, which is when a studio chases it.
  final_balance: "the_day",
  day_before: "the_day",
  event_day: "the_day",

  delivery: "deliver",
  album_review: "deliver",
};

export function journeyPhase(key: JourneyStepKey): JourneyPhase {
  return phaseByStep[key];
}

export const journeyPhaseOrder: JourneyPhase[] = [
  "enquire",
  "book",
  "prepare",
  "the_day",
  "deliver",
];

export type JourneyPhaseGroup = {
  phase: JourneyPhase;
  label: string;
  steps: JourneyStep[];
  /** Completed out of total, so a group can show its own progress. */
  complete: number;
  /**
   * Steps the event overtook — never done, and now undoable.
   *
   * Without this the fraction has no way to say "moot". A wedding already shot,
   * whose form was never sent and whose run of show was never published, read
   * "Preparation 2/4" and "8/14" overall: six things looking outstanding that
   * nobody can ever do again.
   */
  missed: number;
  /** True when the job's current step lives in this group. */
  active: boolean;
};

/**
 * Group a journey into its phases, preserving step order and dropping
 * phases the engine produced no steps for.
 */
export function groupJourneyByPhase(steps: JourneyStep[]): JourneyPhaseGroup[] {
  return journeyPhaseOrder
    .map((phase) => {
      const inPhase = steps.filter((step) => journeyPhase(step.key) === phase);
      return {
        phase,
        label: journeyPhaseLabel[phase],
        steps: inPhase,
        complete: inPhase.filter((step) => step.status === "complete").length,
        missed: inPhase.filter((step) => step.status === "passed").length,
        // `passed` is not activity: a preparation step the event overtook is
        // neither done nor being worked on, and marking its phase active kept
        // Preparation lit up on a job that had already been shot.
        active: inPhase.some(
          (step) =>
            !["complete", "upcoming", "passed"].includes(step.status),
        ),
      };
    })
    .filter((group) => group.steps.length > 0);
}
