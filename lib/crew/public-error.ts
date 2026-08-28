"use client";

import { reportHandledError } from "@/components/observability/error-reporter";

export function crewPublicError(
  caught: unknown,
  fallback: string,
  code = "CREW_OPERATION_FAILED",
): string {
  const message = caught instanceof Error ? caught.message.toLowerCase() : "";
  void reportHandledError(code);

  if (
    message.includes("permission") ||
    message.includes("forbidden") ||
    message.includes("unauthorized")
  ) {
    return "This record is not available for your current assignment. Return to Jobs or ask the studio to confirm your access.";
  }
  if (
    message.includes("offline") ||
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("unavailable")
  ) {
    return "StudioCue could not be reached. Check your connection and try again.";
  }
  if (
    message.includes("authentication") ||
    message.includes("sign in") ||
    message.includes("token") ||
    message.includes("session")
  ) {
    return "Your secure session needs to be refreshed. Sign in again, then retry.";
  }
  if (message.includes("too long") || message.includes("timeout")) {
    return "This is taking longer than expected. Try again in a moment.";
  }

  /**
   * The reason the server actually gave.
   *
   * This helper mapped four infrastructure conditions — permission, network,
   * session, timeout — and threw away every business refusal. `crewCommand`
   * raises twenty-nine named codes, so a subcontractor pressing "Accept job"
   * on an offer that expired three weeks earlier read only "The assignment
   * could not be updated", with no reason and no route forward. Each of these
   * says what happened and what to do instead.
   */
  // The raw code, before it was lowercased for the substring checks above.
  const raw = caught instanceof Error ? caught.message.trim() : "";
  const explained = CREW_CODE_MESSAGES[raw];
  if (explained) return explained;

  return fallback;
}

const CREW_CODE_MESSAGES: Record<string, string> = {
  ASSIGNMENT_OFFER_EXPIRED:
    "This offer has expired, so it can no longer be accepted. Message the studio if you are still available and they can re-offer it.",
  ASSIGNMENT_NOT_RESPONDABLE:
    "This offer is no longer waiting on you — it has already been answered, withdrawn, or filled by someone else.",
  CASCADE_OFFER_IS_NOT_CURRENT:
    "This role has moved on to the next person on the studio's list. Message the studio if you are still available.",
  CASCADE_CANDIDATE_HAS_ACCEPTED_CONFLICT:
    "You have already accepted another job that overlaps these hours.",
  ASSIGNMENT_NOT_FOUND:
    "This assignment is no longer on your list. Return to Jobs to see your current work.",
  ASSIGNMENT_NOT_ACCEPTED:
    "Accept the job first — this only becomes available once you have taken the role.",
  ASSIGNMENT_REQUIREMENTS_INCOMPLETE:
    "One of the studio's requirements for this job is still outstanding. Open Requirements to see which.",
  ASSIGNMENT_NOT_READY_FOR_CLOSEOUT:
    "Closeout opens after the event. Nothing to submit yet.",
  ASSIGNMENT_NOT_COMPLETABLE:
    "This assignment cannot be closed out in its current state. Message the studio.",
  CLOSEOUT_NOT_READY_FOR_REVIEW:
    "Submit your hours and expenses first, then the studio can review them.",
  APPROVE_CLOSEOUT_BEFORE_PAYMENT:
    "The studio has not approved this closeout yet, so payment cannot be scheduled.",
  SCHEDULE_VERSION_IS_NOT_CURRENT:
    "The studio published a newer schedule while this page was open. Reload to see it, then acknowledge that version.",
  REQUIREMENT_NOT_FOUND:
    "That requirement is no longer part of this job.",
  REQUIREMENT_REQUIRES_STUDIO_REVIEW:
    "Your upload is with the studio for review. Nothing more is needed from you.",
  INVALID_AVAILABILITY_RANGE:
    "Check the dates: availability has to end after it starts.",
  INVALID_CLOSEOUT_RANGE:
    "Check the times: your finish has to be after your start.",
  INVALID_ASSIGNMENT_RANGE:
    "Check the times: the assignment has to end after it starts.",
  CREW_PROFILE_NOT_FOUND:
    "Your crew profile could not be found for this studio. Ask them to re-send your invitation.",
};
