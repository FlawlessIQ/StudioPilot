/**
 * How a studio moves a job forward when the step happened somewhere else.
 *
 * Six transitions are evidence-controlled (see `evidenceControlledProjectTransitions`),
 * and `transitionProject` refuses all six with EVIDENCE_CONTROLLED_TRANSITION.
 * That is right: a job should not be called booked because somebody clicked a
 * dropdown. But the couple who says yes by text, the agreement signed on paper,
 * the retainer taken by bank transfer and the gallery sent from the studio's own
 * Pixieset are not edge cases in this business — they are most of it. Every one
 * of those needs a way through that records *what actually happened* rather than
 * asserting a state.
 *
 * So each gated transition names the record that satisfies it and where the
 * studio goes to enter it. Two jobs:
 *
 *   1. The stage control on the job page used to render nothing at all on a
 *      gated stage — `if (transitionAuthority(...)) return null` — so a
 *      photographer stuck at "Proposal" saw the card vanish with no hint that
 *      anything else existed. It now says which record is needed and links to it.
 *   2. `tests/manual-advance.test.ts` fails if a gated transition is added
 *      without one, so the next authority cannot quietly become a dead end.
 */

import { evidenceControlledProjectTransitions } from "@/features/projects/state-machine";
import type { ProjectState } from "@/features/projects/schema";

export type ManualAdvance = {
  /** What the studio records, in their words. */
  label: string;
  /** Why this is not just a stage change. */
  detail: string;
  /** Where to do it. `:projectId` is replaced by the caller. */
  href: string;
};

const ROUTES: Record<string, ManualAdvance> = {
  "PROPOSAL:CONTRACT_PENDING": {
    label: "Record their acceptance",
    detail:
      "They said yes by email, text or in person? Record it on the proposal — StudioCue keeps who accepted and when.",
    /**
     * `record=acceptance` is carried through to the proposal.
     *
     * The button named an action and delivered a list: the studio landed on a
     * filtered index, had to recognise the right row, open it, scroll past the
     * whole document and expand a folded `<details>` at the bottom of the
     * action stack — three clicks and a scroll from the button named after it,
     * for the escape hatch this product depends on for every client who says
     * yes by text.
     *
     * The list stays the destination because a project can hold more than one
     * proposal and choosing is the studio's call, but the intent travels: rows
     * that can take a decision pass the parameter on, and the proposal page
     * opens the form with it.
     */
    href: "/studio/proposals?project=:projectId&record=acceptance",
  },
  "CONTRACT_PENDING:RETAINER_PENDING": {
    label: "Record the signature",
    detail:
      "Signed on paper or through your own signing tool? Record it on the booking page and StudioCue moves on.",
    href: "/studio/booking?project=:projectId",
  },
  "RETAINER_PENDING:BOOKED": {
    label: "Record the retainer",
    detail:
      "Paid by transfer, cheque or card reader? Record the payment on the booking page, then confirm the booking.",
    href: "/studio/booking?project=:projectId",
  },
  "POSTPONED:BOOKED": {
    label: "Re-run the booking check",
    detail:
      "The signature and retainer already on file are re-checked against the new date before the job is booked again.",
    href: "/studio/booking?project=:projectId",
  },
  "PLANNING:READY": {
    label: "Finish readiness",
    detail:
      "Readiness decides this one. Anything you settled elsewhere can be marked done or waived, with a reason.",
    href: "/studio/readiness?project=:projectId",
  },
  "POST_PRODUCTION:DELIVERED": {
    label: "Record the gallery",
    detail:
      "Delivered from your own gallery provider? Record it and StudioCue files the link, the code and the expiry.",
    href: "/studio/delivery?project=:projectId",
  },
};

/**
 * The way through a gated transition, or null when the transition is free and
 * the ordinary stage control applies.
 */
export function manualAdvanceFor(
  from: ProjectState,
  to: ProjectState,
  projectId: string,
): ManualAdvance | null {
  const entry = ROUTES[`${from}:${to}`];
  if (!entry) return null;
  return { ...entry, href: entry.href.replaceAll(":projectId", projectId) };
}

/**
 * What entering a stage means, for the ungated ones.
 *
 * The stage card explained itself with "for example a consultation handled
 * over the phone" at *every* stage, because the copy was written once for the
 * control rather than per move. A booked job about to enter planning read an
 * example three stages behind it.
 *
 * Only the ungated transitions need this: the six evidence-controlled ones
 * carry their own `detail` in ROUTES above, which names the record instead of
 * an example.
 */
const STAGE_EXAMPLES: Partial<Record<ProjectState, string>> = {
  CONSULTATION: "the consultation",
  PROPOSAL: "sending the proposal",
  PLANNING: "starting the planning",
  READY: "getting the job ready",
  EVENT_COMPLETE: "shooting the event",
  POST_PRODUCTION: "starting the edit",
  REVIEW_REQUESTED: "asking for the review",
  CLOSED: "closing the job out",
};

export function manualAdvanceExample(to: ProjectState): string {
  return STAGE_EXAMPLES[to] ?? "this step";
}

/** Every gated transition, for the coverage test. */
export function gatedTransitionKeys(): string[] {
  return evidenceControlledProjectTransitions.map(
    (transition) => `${transition.from}:${transition.to}`,
  );
}

export function manualAdvanceKeys(): string[] {
  return Object.keys(ROUTES);
}
