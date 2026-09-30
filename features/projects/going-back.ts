/**
 * Going back: undoing a cancel, reopening a finished job, and the backward
 * moves the job page offers.
 *
 * The audit of 2026-09-30 found a job could only ever go forward from the
 * studio's own screens. The state machine allowed several moves back — READY
 * to PLANNING, CONTRACT_PENDING to PROPOSAL — but only Cue could reach them;
 * a cancel was one click with no way back; a delivered job could not go back
 * for a re-edit and a closed one could not reopen. Every one of those is an
 * ordinary day in a studio.
 *
 * Pure. The undo-a-cancel rule is duplicated at functions/src/crm/transitions.ts
 * (uncancelRefusal); tests/wave3-job-back.test.ts holds the two to the same
 * answers.
 */

import {
  allowedProjectTransitions,
  transitionRoute,
} from "@/features/projects/state-machine";
import type { ProjectState } from "@/features/projects/schema";

/** How long a cancel can be undone. */
export const UNCANCEL_WINDOW_DAYS = 30;

export type CancelRecord = {
  state?: unknown;
  cancelledFromState?: unknown;
  cancelledAt?: unknown;
  interruptionAt?: unknown;
};

/** Why a cancelled job can't be brought back, or null when it can. */
export function uncancelRefusal(
  project: CancelRecord,
  now: string,
): "NOT_CANCELLED" | "UNCANCEL_ORIGIN_UNKNOWN" | "UNCANCEL_WINDOW_PASSED" | null {
  if (project.state !== "CANCELLED") return "NOT_CANCELLED";
  const from = String(project.cancelledFromState ?? "");
  if (
    from === "CANCELLED" ||
    !allowedProjectTransitions.CANCELLED.includes(from as ProjectState) ||
    from === "ARCHIVED"
  )
    return "UNCANCEL_ORIGIN_UNKNOWN";
  const at = Date.parse(String(project.cancelledAt ?? project.interruptionAt ?? ""));
  if (!Number.isFinite(at)) return "UNCANCEL_ORIGIN_UNKNOWN";
  if (Date.parse(now) - at > UNCANCEL_WINDOW_DAYS * 86_400_000) return "UNCANCEL_WINDOW_PASSED";
  return null;
}

/**
 * What cancelling does, said before it is done.
 *
 * The confirm step used to read "Nothing is deleted, and the contract,
 * payments and delivery records are preserved" — true, and it read as
 * reversible, while accepted crew were being emailed that the wedding was off
 * in the same click. This names each consequence the server now carries out,
 * for the records this job actually has.
 */
export function cancelConsequences(input: {
  acceptedCrew: number;
  pendingOffers: number;
  standingInvoices: number;
  unsignedAgreementOut: boolean;
  outsideAgreementOut: boolean;
  onCalendar: boolean;
}): string[] {
  const lines: string[] = [];
  if (input.acceptedCrew)
    lines.push(
      `${input.acceptedCrew === 1 ? "The crew member" : `The ${input.acceptedCrew} crew members`} who accepted ${input.acceptedCrew === 1 ? "is" : "are"} released and emailed straight away, with a calendar file that takes the day out of their diary.`,
    );
  if (input.pendingOffers)
    lines.push(
      `${input.pendingOffers === 1 ? "The offer" : `${input.pendingOffers} offers`} nobody has answered ${input.pendingOffers === 1 ? "is" : "are"} withdrawn quietly.`,
    );
  if (input.standingInvoices)
    lines.push(
      "Billing stops: open invoices stop being chased or charged, and you get a task to void each one in your invoicing app. Money already paid becomes a task to refund or keep.",
    );
  if (input.unsignedAgreementOut)
    lines.push("The agreement the couple hasn't signed yet is withdrawn, so it can no longer be signed.");
  if (input.outsideAgreementOut)
    lines.push("An agreement out through your signing app can't be withdrawn from here — you'll get a task to cancel it there.");
  if (input.onCalendar)
    lines.push("The wedding comes off your Google Calendar, and crew invites are removed.");
  lines.push("StudioCue stops emailing the couple about this job — no reminders, bills or review asks.");
  lines.push(
    `Undo is possible for ${UNCANCEL_WINDOW_DAYS} days, by the owner. It brings the job back to where it is now, but not the crew, invoices or agreement — those stay released and voided, and you re-offer or re-send them.`,
  );
  return lines;
}

export type BackwardMove = {
  target: ProjectState;
  route: "transitionProject" | "reopenJob" | "uncancelProject";
  label: string;
  detail: string;
  /** Only the owner may make it; the server enforces the same rule. */
  ownerOnly: boolean;
  /** A reason is recorded (and required) for this move. */
  needsReason: boolean;
  /** Refused until something else is done first, with where to do it. */
  blocked: { detail: string; href: string; label: string } | null;
};

/**
 * The moves back a job page offers from where the job is.
 *
 * Read from the state machine and its routing, so this can never offer a move
 * the server refuses. Moves into LOST and out of it are left to the inquiry's
 * own Close/Reopen control, and a held job's way back is the forward card's
 * (resumeTargetFor) — one control per move.
 */
export function backwardMovesFor(
  project: CancelRecord & { state: string; id: string },
  context: { agreementOut: boolean; now: string },
): BackwardMove[] {
  const state = project.state as ProjectState;
  const moves: BackwardMove[] = [];
  const allowed = allowedProjectTransitions[state] ?? [];
  if (state === "CONTRACT_PENDING" && allowed.includes("PROPOSAL")) {
    moves.push({
      target: "PROPOSAL",
      route: "transitionProject",
      label: "Back to the proposal",
      detail:
        "For when the couple wants to change what they're booking before signing. The proposal can then be revised and sent again.",
      ownerOnly: false,
      needsReason: false,
      // Moving back with the agreement still out left it signable, and a
      // later revise refused with "the agreement has already gone" — the
      // job was stuck between the two.
      blocked: context.agreementOut
        ? {
            detail: "The agreement is out with the couple. Withdraw it first, so they can't sign terms you're about to change.",
            href: `/studio/booking?project=${project.id}`,
            label: "Withdraw the agreement",
          }
        : null,
    });
  }
  if (state === "READY" && allowed.includes("PLANNING")) {
    moves.push({
      target: "PLANNING",
      route: "transitionProject",
      label: "Back to planning",
      detail: "Something changed after everything was ready — a new timeline, a new venue. Readiness is worked out again.",
      ownerOnly: false,
      needsReason: false,
      blocked: null,
    });
  }
  if ((state === "DELIVERED" || state === "REVIEW_REQUESTED") && transitionRoute(state, "POST_PRODUCTION") === "reopenJob") {
    moves.push({
      target: "POST_PRODUCTION",
      route: "reopenJob",
      label: "Back to editing",
      detail:
        "The couple asked for a re-edit. Review and album asks pause until you deliver again; the delivered gallery stays with the couple.",
      ownerOnly: true,
      needsReason: true,
      blocked: null,
    });
  }
  if (state === "CLOSED" && transitionRoute(state, "DELIVERED") === "reopenJob") {
    moves.push({
      target: "DELIVERED",
      route: "reopenJob",
      label: "Reopen the job",
      detail:
        "It goes back to Delivered so you can deliver more or fix something. Review and album asks pause; close it again when you're done.",
      ownerOnly: true,
      needsReason: true,
      blocked: null,
    });
  }
  if (state === "CANCELLED") {
    const refusal = uncancelRefusal(project, context.now);
    const from = String(project.cancelledFromState ?? "") as ProjectState;
    if (refusal === null) {
      moves.push({
        target: from,
        route: "uncancelProject",
        label: "Undo the cancel",
        detail:
          "The job goes back to where it was. Crew, invoices and the agreement stay released and voided — re-offer the crew and re-send what the couple needs.",
        ownerOnly: true,
        needsReason: true,
        blocked: null,
      });
    }
  }
  return moves;
}
