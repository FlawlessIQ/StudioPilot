import { createHash } from "node:crypto";
import { getFirestore, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { clientOutreachStop } from "../post-event/client-outreach.js";
import { contractFormAnswers } from "../contracts/form-answers.js";
import { eventDetailsFrom, type EventDetailRow } from "../contracts/event-details.js";
import { formatContractDate } from "../contracts/document.js";
import { isReturned } from "./questionnaire-lifecycle.js";
import { detailsLockOn, resolvePlanningTimeline } from "./planning-timeline.js";
import { finalDetailsLockApplies, jobKindOf } from "../job-kinds/job-kinds.js";

/**
 * The couple's final details, confirmed when they lock.
 *
 * GR Productions (2026-10-02): lock the final details four weeks before. On
 * the lock day the couple is asked to confirm them — every location and time
 * from their forms, and the day's timeline as the studio published it — with
 * their name, as they signed the agreement. Schedule A in the agreement
 * (contracts/event-details.ts) said this would happen; this is it.
 *
 * `detailSignoffs/{tenantId}_{projectId}`:
 *   awaiting_couple → confirmed. A change the studio accepts afterwards is
 *   added to `changes` (the confirmed snapshot stays as it was signed); one
 *   accepted while still awaiting refreshes the snapshot they will confirm.
 *
 * Never for a quiet job (imported, paused, cancelled, on hold, archived).
 */

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const detailSignoffId = (tenantId: string, projectId: string) => `${tenantId}_${projectId}`;

export type TimelineRow = { time: string; title: string; location: string | null };
export type FinalDetailsSnapshot = {
  rows: EventDetailRow[];
  timeline: TimelineRow[];
  responseIds: string[];
  scheduleId: string | null;
  scheduleVersion: number | null;
};

/** The snapshot's hash: what the couple confirmed, exactly. */
export function finalDetailsHash(snapshot: FinalDetailsSnapshot): string {
  return createHash("sha256").update(JSON.stringify({ rows: snapshot.rows, timeline: snapshot.timeline })).digest("hex");
}

function clock(iso: string, timezone: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.valueOf())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone || "UTC" }).format(instant);
  } catch {
    return "";
  }
}

/** Pure: the published timeline as the couple sees it — their items, in order, with where. */
export function coupleTimeline(schedule: Row | null): TimelineRow[] {
  if (!schedule) return [];
  const timezone = text(schedule.timezone);
  return (Array.isArray(schedule.items) ? schedule.items : [])
    .map(record)
    .filter((item) => ["client", "shared"].includes(text(item.visibility)))
    .sort((left, right) => text(left.startAt).localeCompare(text(right.startAt)))
    .map((item) => ({
      time: clock(text(item.startAt), timezone),
      title: text(item.title) || "Moment",
      location: [text(item.location), text(item.address)].filter(Boolean).join(", ") || null,
    }))
    .slice(0, 60);
}

/** What the couple confirms: their forms' details (newest answer to each question wins) and the published timeline. */
export async function finalDetailsSnapshot(db: Firestore, tenantId: string, projectId: string): Promise<FinalDetailsSnapshot> {
  const [project, responses, schedules] = await Promise.all([
    db.doc(`projects/${projectId}`).get(),
    db.collection("questionnaireResponses").where("tenantId", "==", tenantId).where("projectId", "==", projectId).limit(20).get(),
    db.collection("schedules").where("tenantId", "==", tenantId).where("projectId", "==", projectId).orderBy("version", "desc").limit(5).get(),
  ]);
  const returned = responses.docs
    .filter((response) => isReturned(response.get("status")) && !response.get("archivedAt"))
    .sort((left, right) => text(left.get("submittedAt")).localeCompare(text(right.get("submittedAt"))));
  const byQuestion = new Map<string, { question: string; answer: string }>();
  for (const response of returned)
    for (const row of contractFormAnswers({ sections: record(response.get("templateSnapshot")).sections, answers: response.get("answers"), limit: 60 }))
      byQuestion.set(row.question.trim().toLowerCase(), row);
  const eventDate = text(project.get("eventDate")).slice(0, 10);
  const details = eventDetailsFrom({
    eventType: text(project.get("eventType")) || "Wedding",
    eventKind: jobKindOf(project.data()),
    date: /^\d{4}-\d{2}-\d{2}$/.test(eventDate) ? formatContractDate(eventDate) : null,
    venue: text(project.get("venueName")) || null,
    coverage: null,
    answers: [...byQuestion.values()],
  });
  const schedule = schedules.docs.find((candidate) => !["superseded", "draft"].includes(text(candidate.get("status")))) ?? null;
  return {
    rows: details.rows,
    timeline: coupleTimeline(schedule?.data() ?? null),
    responseIds: returned.map((response) => response.id),
    scheduleId: schedule?.id ?? null,
    scheduleVersion: schedule ? Number(schedule.get("version") ?? 0) || null : null,
  };
}

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");

async function openSignoff(db: Firestore, project: DocumentSnapshot, lockOn: string, now: string): Promise<string> {
  const tenantId = text(project.get("tenantId"));
  const reference = db.doc(`detailSignoffs/${detailSignoffId(tenantId, project.id)}`);
  if ((await reference.get()).exists) return "exists";
  const snapshot = await finalDetailsSnapshot(db, tenantId, project.id);
  const emailId = `final_details_request_${tenantId}_${project.id}`;
  const batch = db.batch();
  batch.create(reference, {
    id: reference.id,
    tenantId,
    projectId: project.id,
    status: "awaiting_couple",
    lockOn,
    snapshot,
    snapshotHash: finalDetailsHash(snapshot),
    changes: [],
    confirmedAt: null,
    confirmedBy: null,
    createdAt: now,
    updatedAt: now,
  });
  batch.create(db.doc(`emailJobs/${emailId}`), {
    id: emailId,
    tenantId,
    projectId: project.id,
    type: "final_details_request",
    portalUrl: `${appUrl()}/client?final-details=1`,
    clientOutreachGuard: true,
    status: "queued",
    attempts: 0,
    maxAttempts: 5,
    createdAt: now,
    updatedAt: now,
  });
  await batch.commit();
  return "opened";
}

export const finalDetailsScheduler = onSchedule(
  { schedule: "every day 16:00", timeZone: "UTC", retryCount: 2 },
  async () => {
    const db = getFirestore();
    const nowDate = new Date();
    const today = nowDate.toISOString().slice(0, 10);
    const now = nowDate.toISOString();
    // The longest lock a studio can choose is 90 days.
    const horizon = new Date(nowDate.valueOf() + 91 * 86_400_000).toISOString().slice(0, 10);
    const timelines = new Map<string, Promise<ReturnType<typeof resolvePlanningTimeline>>>();
    const tally: Record<string, number> = {};
    const page = await db.collection("projects").where("eventDate", ">=", today).where("eventDate", "<=", horizon).orderBy("eventDate").limit(1000).get();
    for (const project of page.docs) {
      const data = project.data();
      const tenantId = text(data.tenantId);
      if (!tenantId || !["BOOKED", "PLANNING", "READY"].includes(text(data.state))) continue;
      // Archived, paused (imported), cancelled, on hold: nobody is asked.
      if (clientOutreachStop(data)) continue;
      // A wedding's final-details lock and sign-off; a one-hour family
      // session or a game has neither (job-kinds.ts).
      if (!finalDetailsLockApplies(data)) continue;
      try {
        if (!timelines.has(tenantId))
          timelines.set(tenantId, db.doc(`tenants/${tenantId}`).get().then((tenant) => resolvePlanningTimeline(tenant.get("planningTimeline"))));
        const lockOn = detailsLockOn(text(data.eventDate), await timelines.get(tenantId)!);
        if (!lockOn || today < lockOn) continue;
        const outcome = await openSignoff(db, project, lockOn, now);
        tally[outcome] = (tally[outcome] ?? 0) + 1;
      } catch (caught) {
        tally.failed = (tally.failed ?? 0) + 1;
        console.error(JSON.stringify({ severity: "ERROR", event: "final_details.failed", projectId: project.id, reason: caught instanceof Error ? caught.message : String(caught) }));
      }
    }
    console.log(JSON.stringify({ severity: "INFO", event: "final_details.swept", ...tally }));
  },
);
