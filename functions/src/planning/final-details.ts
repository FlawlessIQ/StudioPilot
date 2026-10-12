import { createHash } from "node:crypto";
import { getFirestore, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { clientOutreachStop } from "../post-event/client-outreach.js";
import { contractFormAnswers } from "../contracts/form-answers.js";
import { eventDetailsFrom, type EventDetailRow } from "../contracts/event-details.js";
import { formatContractDate } from "../contracts/document.js";
import { isReturned } from "./questionnaire-lifecycle.js";
import { detailsLockOn, resolvePlanningTimeline, type PlanningTimeline } from "./planning-timeline.js";
import { mintBookingLink } from "../booking/booking-link.js";
import { FINAL_DETAILS_PURPOSE } from "../booking/consultation-purpose.js";
import { getConsultationSettings } from "../booking/availability.js";
import { finalDetailsLockApplies, jobKindOf } from "../job-kinds/job-kinds.js";
import { tradeOf, tradeProfile } from "../trades/trades.js";
import { newestPartyNames, type BeautyService } from "./party-list.js";
import { FINAL_DETAILS_STATES, finalDetailsDue, finalDetailsToday } from "./final-details-due.js";

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
 *
 * A client priced per person (makeup, hair; trades.ts `perPersonPricing`) is
 * asked one thing instead: still this many getting ready? The sign-off is
 * `kind: "headcount"`, carries the names on their party list, and is
 * confirmed in one tap (server/planning/final-details.ts). No call is booked:
 * Phase 2 of simpler vendor journeys (Conor, 2026-10-09). It is never opened
 * before their party list is back: with no list there is no headcount, and
 * the sweep asked "Still 0 getting ready?" (Jess Styles Bridal, 2026-10-12).
 *
 * When: the daily sweep opens it on the lock day. A job that books inside its
 * lock window, or whose party list comes back after the lock, does not wait
 * for the next sweep — up to a day, which for an event tomorrow is the day
 * itself — `openFinalDetailsIfDue` opens it then, under the same rule
 * (final-details-due.ts). Asked at booking before their form came back, what
 * they confirm follows the form when it does (`refreshAwaitingSignoff`).
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
  /** A per-person client's party list: who counts toward the headcount. Absent for everyone else. */
  people?: string[];
};

/** The snapshot's hash: what the couple confirmed, exactly. The names count when there are any. */
export function finalDetailsHash(snapshot: FinalDetailsSnapshot): string {
  return createHash("sha256")
    .update(JSON.stringify({ rows: snapshot.rows, timeline: snapshot.timeline, ...(snapshot.people ? { people: snapshot.people } : {}) }))
    .digest("hex");
}

/** The studio's own service, for reading a party list (party-list.ts). */
export const ownService = (trade: unknown): BeautyService => (tradeOf(trade) === "hair" ? "hair" : "makeup");

/**
 * The names on a per-person client's party list: the newest returned answer
 * to "party-list" (recommended-templates.ts), one person per line, counting
 * only those having the studio's service.
 */
export function partyPeople(answers: ReadonlyArray<unknown>, trade: unknown): string[] {
  return newestPartyNames(answers, ownService(trade));
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
  const [project, responses, schedules, tenant] = await Promise.all([
    db.doc(`projects/${projectId}`).get(),
    db.collection("questionnaireResponses").where("tenantId", "==", tenantId).where("projectId", "==", projectId).limit(20).get(),
    db.collection("schedules").where("tenantId", "==", tenantId).where("projectId", "==", projectId).orderBy("version", "desc").limit(5).get(),
    db.doc(`tenants/${tenantId}`).get(),
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
    trade: text(tenant.get("trade")) || null,
  });
  const schedule = schedules.docs.find((candidate) => !["superseded", "draft"].includes(text(candidate.get("status")))) ?? null;
  const perPerson = tradeProfile(tenant.get("trade")).perPersonPricing;
  return {
    rows: details.rows,
    timeline: coupleTimeline(schedule?.data() ?? null),
    responseIds: returned.map((response) => response.id),
    scheduleId: schedule?.id ?? null,
    scheduleVersion: schedule ? Number(schedule.get("version") ?? 0) || null : null,
    // Oldest first, so the newest party list wins.
    ...(perPerson ? { people: partyPeople(returned.map((response) => record(response.get("answers"))["party-list"]), tenant.get("trade")) } : {}),
  };
}

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");

/**
 * The couple's link to book their final details call, minted with the
 * sign-off (GR, 2026-10-08: "after the schedule is set 1 month out a
 * zoom/phone call should be part of the journey… the client and studio go
 * over any final details and make changes to the final schedule"). Booked
 * through the same page as a consultation, and kept apart from it by its
 * purpose (booking/consultation-purpose.ts). Null when the studio has it off,
 * or the couple has no address.
 */
async function finalCallLink(
  db: Firestore,
  project: DocumentSnapshot,
  timeline: PlanningTimeline,
  now: string,
): Promise<{ linkId: string; bookingUrl: string; record: Record<string, unknown> } | null> {
  if (!timeline.finalCall) return null;
  const tenantId = text(project.get("tenantId"));
  const ids = Array.isArray(project.get("clientContactIds")) ? (project.get("clientContactIds") as unknown[]) : [];
  for (const id of ids) {
    const contact = await db.doc(`contacts/${text(id)}`).get();
    const email = text(contact.get("email")).toLowerCase();
    if (!contact.exists || contact.get("tenantId") !== tenantId || !email.includes("@")) continue;
    const settings = await getConsultationSettings(db, tenantId);
    // A call, on video if the studio meets that way, else by phone.
    const formats = settings.meetingFormats as readonly string[];
    const mode = formats.includes("zoom") ? "zoom" : formats.includes("phone") ? "phone" : "zoom";
    const days = Math.max(3, timeline.lockDaysBefore - 3);
    return mintBookingLink({
      tenantId,
      projectId: project.id,
      contactId: contact.id,
      email,
      mode,
      purpose: FINAL_DETAILS_PURPOSE,
      actorId: "final-details-scheduler",
      now,
      days,
    });
  }
  return null;
}

/** Firestore's ALREADY_EXISTS: another opener got there first. */
const alreadyExists = (caught: unknown) => {
  const code = (caught as { code?: unknown } | null)?.code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
};

/**
 * Opens the sign-off and queues its email, once. "opened"; "exists" when one
 * is open already; "no_party_list" for a client priced per person whose
 * party list has not come back, or names nobody having the studio's service —
 * nothing is written, and it opens when the list is in.
 */
export async function openSignoff(
  db: Firestore,
  project: DocumentSnapshot,
  lockOn: string,
  timeline: PlanningTimeline,
  now: string,
  trade: unknown = null,
): Promise<string> {
  const tenantId = text(project.get("tenantId"));
  const reference = db.doc(`detailSignoffs/${detailSignoffId(tenantId, project.id)}`);
  if ((await reference.get()).exists) return "exists";
  const snapshot = await finalDetailsSnapshot(db, tenantId, project.id);
  const emailId = `final_details_request_${tenantId}_${project.id}`;
  // Priced per person: the headcount in one tap, and no call to book.
  const headcount = tradeProfile(trade).perPersonPricing ? (snapshot.people ?? []).length : null;
  // No list, no headcount: "Still 0 getting ready?" asked nothing anyone could answer.
  if (headcount === 0) return "no_party_list";
  const call =
    headcount !== null
      ? null
      : await finalCallLink(db, project, timeline, now).catch((caught: unknown) => {
          // The sign-off goes out regardless; the call can be offered by hand.
          console.error(JSON.stringify({ severity: "ERROR", event: "final_call.link_failed", projectId: project.id, reason: caught instanceof Error ? caught.message : String(caught) }));
          return null;
        });
  const batch = db.batch();
  if (call) batch.set(db.doc(`consultationBookingLinks/${call.linkId}`), call.record);
  batch.create(reference, {
    id: reference.id,
    tenantId,
    projectId: project.id,
    status: "awaiting_couple",
    lockOn,
    // Whether the final details call's link went with it, for the journey:
    // "invited" only when it did (features/consultations/final-call.ts).
    ...(headcount !== null ? { kind: "headcount", headcount } : { finalCallLinkId: call?.linkId ?? null }),
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
    // The second button: book the final details call.
    finalCallUrl: call?.bookingUrl ?? null,
    // Per person: "Still N getting ready?" (communications/email-templates.ts).
    ...(headcount !== null ? { headcount } : {}),
    clientOutreachGuard: true,
    status: "queued",
    attempts: 0,
    maxAttempts: 5,
    createdAt: now,
    updatedAt: now,
  });
  try {
    await batch.commit();
  } catch (caught) {
    // The sweep and a booking (or a returned party list) opening it at once.
    if (alreadyExists(caught)) return "exists";
    throw caught;
  }
  return "opened";
}

/**
 * Opens the final details now, when they are due and nothing has opened them
 * yet — for the moments that cannot wait for the daily sweep:
 *
 * - the job books inside its lock window (operations/provider-runtime.ts
 *   `completeBookingResources`, which every booking path queues);
 * - a client's form comes back after the lock (crew-brief-trigger.ts): for a
 *   makeup or hair client that is the party list the headcount is counted from.
 *
 * Priya Shah's sangeet was booked the day of the event, and its final
 * headcount would have waited for the 16:00 UTC sweep (Jess Styles Bridal,
 * 2026-10-12). Under the sweep's own rule (final-details-due.ts): booked, not
 * quiet, a job with a lock, past its lock and not past its day. Idempotent:
 * an open sign-off is left as it is. Returns what happened, for the caller's log.
 */
export async function openFinalDetailsIfDue(
  db: Firestore,
  input: { tenantId: string; projectId: string },
  now: string,
): Promise<string> {
  const project = await db.doc(`projects/${input.projectId}`).get();
  const data = project.data();
  if (!project.exists || !data || text(data.tenantId) !== input.tenantId) return "no_project";
  // The cheap reasons first, before the studio's timeline is read.
  if (!FINAL_DETAILS_STATES.includes(text(data.state))) return "not_booked";
  if (clientOutreachStop(data)) return "quiet";
  if (!finalDetailsLockApplies(data)) return "no_lock";
  const tenant = await db.doc(`tenants/${input.tenantId}`).get();
  const timeline = resolvePlanningTimeline(tenant.get("planningTimeline"));
  const lockOn = detailsLockOn(text(data.eventDate), timeline);
  // The job's own calendar day, not UTC's: a same-day job booked in a US
  // evening is still today (final-details-due.ts `finalDetailsToday`).
  const today = finalDetailsToday(now, data.timezone, tenant.get("timezone"));
  const due = finalDetailsDue({ state: data.state, quiet: false, eventDate: data.eventDate, lockOn, today });
  if (due !== "due" || !lockOn) return due;
  return openSignoff(db, project, lockOn, timeline, now, tenant.get("trade") ?? null);
}

/**
 * Their form back while the sign-off still waits on them: what they confirm
 * is the details as they now stand, as when the studio accepts a change
 * (detail-changes.ts). A job booked inside its lock window is asked at
 * booking, before its planning form has come back, and would otherwise be
 * asked to confirm details without their own answers in them.
 *
 * Inside a transaction, so a confirmation that lands first is left exactly as
 * it was signed.
 *
 * Not a headcount. Its `headcount` is the number when the details locked: the
 * floor the agreement holds them to ("people can be added but not taken
 * off"), and what confirming never goes below (server/planning/final-details.ts
 * `confirmHeadcount`). A list that shrinks afterwards must not lower it, and
 * one that grows is counted when they confirm, from the list as it stands
 * (`livePeople`). It only opens once a list names someone (`openSignoff`), so
 * there is nothing to catch up — except one the sweep opened at 0 before
 * 2026-10-12 ("Still 0 getting ready?"), which takes the list's number the
 * first time it names someone, and never again.
 */
/** A headcount sign-off's number at the lock, when it has one above 0. */
const lockedHeadcount = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0;

export async function refreshAwaitingSignoff(
  db: Firestore,
  input: { tenantId: string; projectId: string },
  now: string,
): Promise<"refreshed" | "unchanged" | "not_awaiting"> {
  const reference = db.doc(`detailSignoffs/${detailSignoffId(input.tenantId, input.projectId)}`);
  const before = await reference.get();
  if (!before.exists || text(before.get("tenantId")) !== input.tenantId || before.get("status") !== "awaiting_couple") return "not_awaiting";
  if (before.get("kind") === "headcount" && lockedHeadcount(before.get("headcount"))) return "unchanged";
  const snapshot = await finalDetailsSnapshot(db, input.tenantId, input.projectId);
  const snapshotHash = finalDetailsHash(snapshot);
  return db.runTransaction(async (transaction) => {
    const signoff = await transaction.get(reference);
    if (!signoff.exists || signoff.get("status") !== "awaiting_couple") return "not_awaiting";
    if (signoff.get("snapshotHash") === snapshotHash) return "unchanged";
    if (signoff.get("kind") === "headcount") {
      const people = (snapshot.people ?? []).length;
      // Only the old "Still 0", once the list names someone.
      if (lockedHeadcount(signoff.get("headcount")) || !people) return "unchanged";
      transaction.update(reference, { snapshot, snapshotHash, headcount: people, updatedAt: now });
      return "refreshed";
    }
    transaction.update(reference, { snapshot, snapshotHash, updatedAt: now });
    return "refreshed";
  });
}

export const finalDetailsScheduler = onSchedule(
  { schedule: "every day 16:00", timeZone: "UTC", retryCount: 2 },
  async () => {
    const db = getFirestore();
    const nowDate = new Date();
    const now = nowDate.toISOString();
    // A day either side of UTC's: each job is then judged on its own
    // calendar (final-details-due.ts `finalDetailsToday`), which may be a day
    // behind or ahead of it. The longest lock a studio can choose is 90 days.
    const from = new Date(nowDate.valueOf() - 86_400_000).toISOString().slice(0, 10);
    const horizon = new Date(nowDate.valueOf() + 92 * 86_400_000).toISOString().slice(0, 10);
    // Each studio's timeline, trade and zone, read once per sweep.
    const studios = new Map<string, Promise<{ timeline: ReturnType<typeof resolvePlanningTimeline>; trade: unknown; zone: unknown }>>();
    const tally: Record<string, number> = {};
    const page = await db.collection("projects").where("eventDate", ">=", from).where("eventDate", "<=", horizon).orderBy("eventDate").limit(1000).get();
    for (const project of page.docs) {
      const data = project.data();
      const tenantId = text(data.tenantId);
      if (!tenantId || !FINAL_DETAILS_STATES.includes(text(data.state))) continue;
      // Archived, paused (imported), cancelled, on hold: nobody is asked.
      if (clientOutreachStop(data)) continue;
      // A wedding's final-details lock and sign-off; a one-hour family
      // session or a game has neither (job-kinds.ts).
      if (!finalDetailsLockApplies(data)) continue;
      try {
        if (!studios.has(tenantId))
          studios.set(
            tenantId,
            db.doc(`tenants/${tenantId}`).get().then((tenant) => ({
              timeline: resolvePlanningTimeline(tenant.get("planningTimeline")),
              trade: tenant.get("trade") ?? null,
              zone: tenant.get("timezone") ?? null,
            })),
          );
        const { timeline, trade, zone } = await studios.get(tenantId)!;
        // A planner settles the final details with the couple at the venue
        // walkthrough (trades.ts `journey.walkthrough`): no sign-off, no
        // call. The form still locks (details-lock.ts).
        if (tradeProfile(trade).journey.walkthrough) {
          tally.walkthrough_instead = (tally.walkthrough_instead ?? 0) + 1;
          continue;
        }
        const lockOn = detailsLockOn(text(data.eventDate), timeline);
        // The job's own day: the same one the booking path and the job page read.
        const today = finalDetailsToday(nowDate, data.timezone, zone);
        if (!lockOn || finalDetailsDue({ state: data.state, quiet: false, eventDate: data.eventDate, lockOn, today }) !== "due") continue;
        // "no_party_list": a makeup or hair client whose list isn't back.
        // Counted, and opened when it comes back (crew-brief-trigger.ts).
        const outcome = await openSignoff(db, project, lockOn, timeline, now, trade);
        tally[outcome] = (tally[outcome] ?? 0) + 1;
      } catch (caught) {
        tally.failed = (tally.failed ?? 0) + 1;
        console.error(JSON.stringify({ severity: "ERROR", event: "final_details.failed", projectId: project.id, reason: caught instanceof Error ? caught.message : String(caught) }));
      }
    }
    console.log(JSON.stringify({ severity: "INFO", event: "final_details.swept", ...tally }));
  },
);
