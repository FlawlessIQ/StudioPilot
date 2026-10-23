/**
 * A message the studio scheduled for later is checked against the job when
 * it goes, not only when it was written.
 *
 * `scheduledEmailRelease` used to flip every due `scheduled` emailJob to
 * `queued` without looking at anything, and the `manual_message` jobs it
 * released never carried `clientOutreachGuard`, so the send-time recheck in
 * operations/jobs.ts `sendEmail` was skipped too. A message scheduled on
 * Monday for Friday went to the couple on Friday even if the studio had
 * cancelled, lost or archived the job on Wednesday (audit 2026-10-22). Every
 * other client email path already rechecks through `clientOutreachStop`
 * (post-event/client-outreach.ts).
 *
 * Two rules here, used in both places (release and send):
 *
 * - **Only a client of the job is guarded.** A message to crew, a vendor or
 *   the studio itself is not a client message and is never held by this.
 * - **A stop already in force when the studio scheduled it is accepted.** A
 *   quiet imported booking (automations paused, ADR 0005) or a job on hold is
 *   one the studio may deliberately write to; holding that message would
 *   second-guess the person who wrote it. What is held is a stop that arrived
 *   *since*: `clientOutreachStopAccepted` records the stop the studio saw, and
 *   any other stop (or a job that is gone) holds the send.
 *
 * A held message is recorded the way every held send is: the job `succeeded`
 * with `result.held` and the reason, never deleted. Today shows it to the
 * studio as a scheduled message that was not sent (features/today/email-problems.ts).
 *
 * Pure.
 */

import {
  clientOutreachStop,
  type ClientOutreachStop,
} from "../post-event/client-outreach.js";

type Row = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Whether this contact is one of the job's clients (not crew, vendor or studio). */
export function isClientOfProject(project: unknown, contactId: unknown): boolean {
  const id = text(contactId);
  if (!id || !project) return false;
  const clients = (project as Row).clientContactIds;
  return Array.isArray(clients) && clients.map(String).includes(id);
}

/**
 * The fields a scheduled message gets when it is written. Nothing for a send
 * that goes now (the studio's own act, as before), or for anyone who is not a
 * client of the job.
 */
export function scheduledClientMessageGuard(input: {
  scheduled: boolean;
  project: unknown;
  contactId: unknown;
}): { clientOutreachGuard: true; clientOutreachStopAccepted: ClientOutreachStop | null } | Record<string, never> {
  if (!input.scheduled || !isClientOfProject(input.project, input.contactId)) return {};
  return {
    clientOutreachGuard: true,
    clientOutreachStopAccepted: clientOutreachStop(input.project),
  };
}

export type ClientOutreachHold = ClientOutreachStop | "job_missing";

/**
 * Why a guarded send must be held now, or null when it may go. `project` is
 * the job as read now (null when it cannot be read or is another studio's).
 * A job without `clientOutreachStopAccepted` accepts no stop, which is how
 * every other guarded path (AI approvals, retries, lifecycle sends) behaves.
 */
export function clientOutreachHoldFor(
  job: Row,
  project: unknown,
): ClientOutreachHold | null {
  if (!project) return "job_missing";
  const stop = clientOutreachStop(project);
  if (!stop) return null;
  const accepted = text(job.clientOutreachStopAccepted);
  return accepted && accepted === stop ? null : stop;
}

/**
 * Whether the release must check this scheduled job against its job. Guarded
 * jobs always; and, for a manual message written before the guard existed,
 * one addressed to a client of the job. Crew and studio mail never.
 */
export function releaseChecksClientOutreach(job: Row, project: unknown): boolean {
  if (!text(job.projectId)) return false;
  if (job.clientOutreachGuard === true) return true;
  if (job.clientOutreachGuard !== undefined && job.clientOutreachGuard !== null) return false;
  return text(job.type) === "manual_message" && isClientOfProject(project, job.contactId);
}

/**
 * What the release writes for one due scheduled job: queued to go (guarded,
 * so `sendEmail` reads the job again as it sends), or held with its reason.
 */
export function scheduledReleaseUpdate(
  job: Row,
  project: unknown,
  now: string,
): Row {
  if (!releaseChecksClientOutreach(job, project))
    return { status: "queued", updatedAt: now };
  const hold = clientOutreachHoldFor(job, project);
  if (hold)
    return {
      status: "succeeded",
      result: {
        held: "client_outreach_stopped",
        reason: hold,
        type: text(job.type) || null,
        heldAt: "release",
      },
      error: null,
      completedAt: now,
      updatedAt: now,
    };
  return { status: "queued", clientOutreachGuard: true, updatedAt: now };
}
