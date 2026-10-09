import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { clientOutreachStop } from "../post-event/client-outreach.js";
import { queuePartnerSends } from "../client/partner-invitations.js";
import { jobKindOf } from "../job-kinds/job-kinds.js";
import { tradeProfile } from "../trades/trades.js";
import type { PlanningTimeline } from "./planning-timeline.js";
import { questionnaireLinkFor } from "./questionnaire-link.js";

/**
 * The couple's own shot list, uploaded in their portal (Conor, 2026-10-09:
 * "the client needs to be able to upload a custom must-take photos / shot
 * list to the portal… requested from them 4 weeks before the wedding").
 *
 * One record per job, `clientShotLists/{projectId}`:
 * - written here when it's asked for (`status: "requested"`), on the day the
 *   studio's timeline says (`shotListUploadDaysBefore`, 28 by default) or
 *   when the studio taps "Ask now";
 * - written by the portal (server/planning/shot-list.ts) when the couple
 *   sends theirs (`status: "received"`, the files and a note), which puts it
 *   on the studio's Today until they open it (`studioSeenAt`).
 *
 * Weddings at photo studios, once per job, never to a quiet job, never once
 * the day has come. The typed shot-list form (planning-form-scheduler.ts)
 * carries on beside it; this is for the list a couple already has.
 */

export const SHOT_LIST_PATH = "/client/shot-list";
/** Due two weeks before the day: time for the studio to plan around it. */
export const SHOT_LIST_UPLOAD_DUE_DAYS_BEFORE = 14;

const BOOKED = ["BOOKED", "PLANNING", "READY"];
type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Pure: whether this job's couple should be asked for their shot list today. */
export function shotListRequestDue(input: { project: Row; timeline: PlanningTimeline; trade: unknown; today: string }): boolean {
  const { project, timeline, today } = input;
  if (!timeline.shotListUpload || !tradeProfile(input.trade).shotList) return false;
  if (jobKindOf(project) !== "wedding" || project.importedAt) return false;
  if (!BOOKED.includes(text(project.state))) return false;
  const eventDate = text(project.eventDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || today >= eventDate) return false;
  if (today < addDays(eventDate, -timeline.shotListUploadDaysBefore)) return false;
  return clientOutreachStop(project) === null;
}

/** When it's due: two weeks before the day, or none when that has passed. */
export function shotListDueDate(eventDate: string, today: string): string | null {
  const due = addDays(eventDate.slice(0, 10), -SHOT_LIST_UPLOAD_DUE_DAYS_BEFORE);
  return due > today ? due : null;
}

export type ShotListRequestOutcome = "requested" | "has_it" | "quiet";

/**
 * Ask for it: the record, and the email with a link that opens the page (an
 * invitation for a couple without portal access, as the planning form's).
 * `create`, so the day's sweep and a studio's "Ask now" never ask twice.
 */
export async function requestShotListUpload(
  db: Firestore,
  project: DocumentSnapshot,
  input: { now: string; actorId: string; dueDate: string | null },
): Promise<ShotListRequestOutcome> {
  const data = project.data() ?? {};
  const tenantId = text(data.tenantId);
  if (!tenantId || data.importedAt || clientOutreachStop(data) !== null) return "quiet";
  const reference = db.doc(`clientShotLists/${project.id}`);
  if ((await reference.get()).exists) return "has_it";
  const emailJobId = `shot_list_request_${project.id}`;
  const link = await questionnaireLinkFor(db, {
    tenantId,
    projectId: project.id,
    clientContactIds: data.clientContactIds,
    emailJobId,
    actorId: input.actorId,
    now: input.now,
    path: SHOT_LIST_PATH,
  });
  const job = {
    id: emailJobId,
    tenantId,
    projectId: project.id,
    type: "shot_list_request",
    actionUrl: link.actionUrl,
    dueDate: input.dueDate,
    soleRecipient: link.partnerSends.length > 0,
    // Re-read the job as it goes (operations/jobs.ts): one paused or put
    // away since must not still reach the couple.
    clientOutreachGuard: true,
    status: "queued",
    attempts: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };
  const batch = db.batch();
  batch.create(reference, {
    id: project.id,
    tenantId,
    projectId: project.id,
    status: "requested",
    requestedAt: input.now,
    requestedBy: input.actorId,
    dueDate: input.dueDate,
    files: [],
    note: null,
    receivedAt: null,
    studioSeenAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  });
  batch.create(db.doc(`emailJobs/${emailJobId}`), job);
  queuePartnerSends(db, batch, job, link.partnerSends);
  if (link.invitationWrite) batch.set(link.invitationWrite.reference, link.invitationWrite.data, { merge: true });
  try {
    await batch.commit();
  } catch (caught) {
    // ALREADY_EXISTS: asked a moment ago, by the sweep or the studio.
    if ((caught as { code?: unknown })?.code === 6) return "has_it";
    throw caught;
  }
  return "requested";
}

/** The day's pass, from planningFormScheduler: every job whose day it is. */
export async function requestShotListIfDue(
  db: Firestore,
  project: DocumentSnapshot,
  studio: { timeline: PlanningTimeline; trade: unknown },
  today: string,
  now: string,
): Promise<ShotListRequestOutcome | "not_due"> {
  const data = project.data() ?? {};
  if (!shotListRequestDue({ project: data, timeline: studio.timeline, trade: studio.trade, today })) return "not_due";
  return requestShotListUpload(db, project, {
    now,
    actorId: "planning-form-scheduler",
    dueDate: shotListDueDate(text(data.eventDate), today),
  });
}
