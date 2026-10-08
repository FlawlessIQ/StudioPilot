import { getFirestore, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { clientOutreachStop } from "../post-event/client-outreach.js";
import { INQUIRY_FORM_SETTINGS_PATH, resolveInquiryFormTemplate } from "../intake/inquiry-form.js";
import { isReturned, liveAssignmentFor } from "./questionnaire-lifecycle.js";
import { questionnaireLinkFor } from "./questionnaire-link.js";
import { queuePartnerSends } from "../client/partner-invitations.js";
import { detailsLocked, planningFormOpensOn, resolvePlanningTimeline, type PlanningTimeline } from "./planning-timeline.js";
import { sendNewQuestionnaire } from "./send-questionnaire.js";
import { detailsFormOpensOn, jobKindOf } from "../job-kinds/job-kinds.js";

/**
 * The planning form, sent when the studio's timeline says.
 *
 * GR Productions (2026-10-02): send it six months before — couples get
 * nervous — or let each studio pick. A studio whose timeline is set to send
 * automatically (planning-timeline.ts, `formSend: "auto"`) has its planning
 * form sent to every booked couple on that day, by exactly what "Send the
 * form" does (send-questionnaire.ts). A studio left on "remind" sees Today's
 * "Send the form" from that day instead, and nothing is sent for it here.
 *
 * Never to a quiet job (imported, paused, cancelled, on hold, archived), and
 * never a second copy: a job that has the form already is left alone.
 */

const BOOKED = ["BOOKED", "PLANNING", "READY"];
type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Pure: whether this job's planning form is due to go out today. */
export function planningFormDue(project: Row, timeline: PlanningTimeline, today: string): boolean {
  if (timeline.formSend !== "auto") return false;
  if (!BOOKED.includes(text(project.state))) return false;
  const eventDate = text(project.eventDate).slice(0, 10);
  // A wedding's form follows the studio's timeline; a session's goes two
  // weeks out (job-kinds.ts).
  const opensOn = detailsFormOpensOn(project, eventDate, planningFormOpensOn(eventDate, timeline));
  if (!opensOn || today < opensOn || today >= eventDate) return false;
  return clientOutreachStop(project) === null;
}

type Studio = { timeline: PlanningTimeline; templates: Array<Row & { id: string }>; inquiryFormId: string | null };

/** The form this studio's couples get: the chosen one at its live version, else the newest for the event type that isn't the inquiry form. */
export function planningFormTemplate(
  studio: Studio,
  eventTypeId: string,
  /** The studio's chosen form is its wedding planning form; other kinds get their own. */
  useStudioChoice = true,
): (Row & { id: string }) | null {
  if (useStudioChoice && studio.timeline.formTemplateId) return resolveInquiryFormTemplate(studio.templates as never, studio.timeline.formTemplateId) as (Row & { id: string }) | null;
  const inquiry = studio.inquiryFormId ? resolveInquiryFormTemplate(studio.templates as never, studio.inquiryFormId) : null;
  const candidates = studio.templates
    .filter((template) => template.status === "active" && !template.archivedAt)
    .filter((template) => template.id !== (inquiry as { id?: string } | null)?.id)
    .filter((template) => !eventTypeId || text(template.eventTypeId) === eventTypeId)
    .sort((left, right) => text(right.createdAt).localeCompare(text(left.createdAt)));
  return candidates.find((template) => /planning/i.test(text(template.name))) ?? candidates[0] ?? null;
}

async function loadStudio(db: Firestore, tenantId: string): Promise<Studio> {
  const [tenant, templates, inquirySettings] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(),
    db.collection("questionnaireTemplates").where("tenantId", "==", tenantId).limit(200).get(),
    db.doc(INQUIRY_FORM_SETTINGS_PATH(tenantId)).get(),
  ]);
  return {
    timeline: resolvePlanningTimeline(tenant.get("planningTimeline")),
    templates: templates.docs.map((template) => ({ id: template.id, ...template.data() })),
    inquiryFormId: text((inquirySettings.get("inquiryEventForm") as Row | null | undefined)?.templateId) || null,
  };
}

/**
 * The shot list is due a week before the day, whatever the template says.
 * Gabe (GR, 2026-10-08): "Shot-list should be due one week prior." It used to
 * take the template's own date, which for GR's copy was the 4-week lock.
 */
export const SHOT_LIST_DUE_DAYS_BEFORE = 7;

/**
 * The shot list, on the planning form's day (planning-timeline.ts,
 * `shotListTemplateId`). Weddings only, once per job, never a second copy, and
 * due a week before the day (SHOT_LIST_DUE_DAYS_BEFORE). A failure here is
 * logged and never costs the couple their planning form.
 */
async function sendShotList(db: Firestore, project: DocumentSnapshot, studio: Studio, today: string, now: string): Promise<void> {
  const data = project.data() ?? {};
  const tenantId = text(data.tenantId);
  const templateId = studio.timeline.shotListTemplateId;
  if (!templateId || jobKindOf(data) !== "wedding") return;
  // Past the lock it would arrive already overdue.
  if (detailsLocked(text(data.eventDate).slice(0, 10), today, studio.timeline)) return;
  const template = resolveInquiryFormTemplate(studio.templates as never, templateId) as (Row & { id: string }) | null;
  if (!template) return;
  const responses = await db.collection("questionnaireResponses").where("tenantId", "==", tenantId).where("projectId", "==", project.id).get();
  if (liveAssignmentFor(responses.docs.map((response) => ({ id: response.id, ...response.data() })), { id: template.id, name: text(template.name) })) return;
  try {
    await sendNewQuestionnaire(db, {
      tenantId,
      projectId: project.id,
      project,
      template: await db.doc(`questionnaireTemplates/${template.id}`).get(),
      idempotencyKey: `shot_list_${project.id}_${template.id}`,
      actorId: "planning-form-scheduler",
      now,
      allowAi: false,
      dueDaysBeforeEvent: SHOT_LIST_DUE_DAYS_BEFORE,
    });
  } catch (caught) {
    // ALREADY_EXISTS: yesterday's run sent it.
    if ((caught as { code?: unknown })?.code === 6) return;
    console.error(JSON.stringify({ severity: "ERROR", event: "shot_list.failed", projectId: project.id, reason: caught instanceof Error ? caught.message : String(caught) }));
  }
}

async function sendOne(db: Firestore, project: DocumentSnapshot, studio: Studio, today: string, now: string): Promise<string> {
  const outcome = await sendPlanningForm(db, project, studio, today, now);
  // With the planning form, on its day — whether that sent it, asked for a
  // review, or found it already out. Not on a day the form isn't due.
  if (outcome !== "not_due") await sendShotList(db, project, studio, today, now);
  return outcome;
}

async function sendPlanningForm(db: Firestore, project: DocumentSnapshot, studio: Studio, today: string, now: string): Promise<string> {
  const data = project.data() ?? {};
  const tenantId = text(data.tenantId);
  if (!planningFormDue(data, studio.timeline, today)) return "not_due";
  const kind = jobKindOf(data);
  const template =
    planningFormTemplate(studio, text(data.eventTypeId), kind === "wedding") ??
    // A job filed under a studio's own id still finds the form for its kind.
    planningFormTemplate(studio, kind, kind === "wedding");
  if (!template) return "no_form";
  const responses = await db.collection("questionnaireResponses").where("tenantId", "==", tenantId).where("projectId", "==", project.id).get();
  const live = liveAssignmentFor(
    responses.docs.map((response) => ({ id: response.id, ...response.data() })),
    { id: template.id, name: text(template.name) },
  );
  if (live) return requestReview(db, project, live as Row & { id?: string }, studio, today, now);
  const templateSnapshot = await db.doc(`questionnaireTemplates/${template.id}`).get();
  await sendNewQuestionnaire(db, {
    tenantId,
    projectId: project.id,
    project,
    template: templateSnapshot,
    // One send per job and form version, however often this runs.
    idempotencyKey: `planning_form_${project.id}_${template.id}`,
    actorId: "planning-form-scheduler",
    now,
    allowAi: false,
  });
  return "sent";
}

/**
 * Pure: whether a couple who already has the form should be asked, today, to
 * review it. GR (2026-10-05): the final schedule goes out when the contract is
 * signed and "again 6 months out", and at 6 months they "actively update and
 * change times" in the same form — so it is a request to look again, never a
 * second copy. Once per form; only one they have filled in (one still blank
 * has its own reminders); never after the details lock.
 */
export function planningReviewDue(input: {
  response: Row;
  timeline: PlanningTimeline;
  eventDate: string;
  today: string;
}): boolean {
  if (!input.timeline.reviewAtFormDate || input.timeline.formSend !== "auto") return false;
  if (!isReturned(input.response.status)) return false;
  if (text(input.response.reviewRequestedAt)) return false;
  if (detailsLocked(input.eventDate, input.today, input.timeline)) return false;
  // Asked for at the form date only when it went out before it (at booking).
  const opensOn = planningFormOpensOn(input.eventDate, input.timeline);
  return Boolean(opensOn) && text(input.response.createdAt).slice(0, 10) < opensOn!;
}

async function requestReview(
  db: Firestore,
  project: DocumentSnapshot,
  response: Row & { id?: string },
  studio: Studio,
  today: string,
  now: string,
): Promise<string> {
  const data = project.data() ?? {};
  const eventDate = text(data.eventDate).slice(0, 10);
  if (!response.id || !planningReviewDue({ response, timeline: studio.timeline, eventDate, today })) return "has_it";
  const tenantId = text(data.tenantId);
  const emailJobId = `questionnaire_review_${response.id}`;
  const link = await questionnaireLinkFor(db, {
    tenantId,
    projectId: project.id,
    clientContactIds: data.clientContactIds,
    emailJobId,
    actorId: "planning-form-scheduler",
    now,
  });
  const job = {
    id: emailJobId,
    tenantId,
    projectId: project.id,
    // The request email, worded as a review (email-templates.ts).
    type: "questionnaire_request",
    variant: "review",
    formName: text(response.templateName) || null,
    actionUrl: link.actionUrl,
    soleRecipient: link.partnerSends.length > 0,
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  const batch = db.batch();
  // create, not set: one review per form, however often this runs.
  batch.create(db.doc(`emailJobs/${emailJobId}`), job);
  queuePartnerSends(db, batch, job, link.partnerSends);
  if (link.invitationWrite) batch.set(link.invitationWrite.reference, link.invitationWrite.data, { merge: true });
  batch.update(db.doc(`questionnaireResponses/${response.id}`), { reviewRequestedAt: now, updatedAt: now });
  await batch.commit();
  return "review_requested";
}

/**
 * The planning form, the moment a booking is confirmed — when the studio's
 * timeline says so (`formAtBooking`). Called from the booking side effects
 * (operations/provider-runtime.ts, completeBookingResources) on every pass:
 * the same idempotency key as the form-date send, so it goes once, and a job
 * that already has the form is left alone. Never to a quiet job; never fails
 * the booking.
 */
export async function sendPlanningFormAtBooking(db: Firestore, project: DocumentSnapshot, now: string): Promise<string> {
  const data = project.data() ?? {};
  const tenantId = text(data.tenantId);
  if (!tenantId) return "no_tenant";
  const studio = await loadStudio(db, tenantId);
  if (!studio.timeline.formAtBooking) return "off";
  if (jobKindOf(data) !== "wedding") return "not_wedding";
  if (data.importedAt || clientOutreachStop(data) !== null) return "quiet";
  const eventDate = text(data.eventDate).slice(0, 10);
  if (!eventDate || eventDate <= now.slice(0, 10)) return "no_date";
  // Booked inside the planning window (the form date has passed): the shot
  // list goes now, with the form, not on tomorrow's sweep (prod walk,
  // 2026-10-06 — a March wedding booked in October).
  const today = now.slice(0, 10);
  const withShotList = async (outcome: string) => {
    if (planningFormDue(data, studio.timeline, today)) await sendShotList(db, project, studio, today, now);
    return outcome;
  };
  const template = planningFormTemplate(studio, text(data.eventTypeId), true) ?? planningFormTemplate(studio, "wedding", true);
  if (!template) return withShotList("no_form");
  const responses = await db.collection("questionnaireResponses").where("tenantId", "==", tenantId).where("projectId", "==", project.id).get();
  if (liveAssignmentFor(responses.docs.map((response) => ({ id: response.id, ...response.data() })), { id: template.id, name: text(template.name) })) {
    return withShotList("has_it");
  }
  const templateSnapshot = await db.doc(`questionnaireTemplates/${template.id}`).get();
  try {
    await sendNewQuestionnaire(db, {
      tenantId,
      projectId: project.id,
      project,
      template: templateSnapshot,
      // The form-date send's key: whichever runs first sends it.
      idempotencyKey: `planning_form_${project.id}_${template.id}`,
      actorId: "booking-orchestrator",
      now,
      allowAi: false,
    });
  } catch (caught) {
    // ALREADY_EXISTS: a retry, or the form-date send got there first.
    if ((caught as { code?: unknown })?.code === 6) return withShotList("has_it");
    throw caught;
  }
  return withShotList("sent");
}

export const planningFormScheduler = onSchedule(
  { schedule: "every day 15:00", timeZone: "UTC", retryCount: 2 },
  async () => {
    const db = getFirestore();
    const nowDate = new Date();
    const today = nowDate.toISOString().slice(0, 10);
    const now = nowDate.toISOString();
    // Twelve months ahead covers every timeline a studio can pick.
    const horizon = new Date(nowDate.valueOf() + 370 * 86_400_000).toISOString().slice(0, 10);
    const studios = new Map<string, Promise<Studio>>();
    const tally: Record<string, number> = {};
    let last: DocumentSnapshot | null = null;
    for (;;) {
      let query = db.collection("projects").where("eventDate", ">=", today).where("eventDate", "<=", horizon).orderBy("eventDate").limit(300);
      if (last) query = query.startAfter(last);
      const page = await query.get();
      for (const project of page.docs) {
        const tenantId = text(project.get("tenantId"));
        if (!tenantId) continue;
        try {
          if (!studios.has(tenantId)) studios.set(tenantId, loadStudio(db, tenantId));
          const outcome = await sendOne(db, project, await studios.get(tenantId)!, today, now);
          tally[outcome] = (tally[outcome] ?? 0) + 1;
        } catch (caught) {
          tally.failed = (tally.failed ?? 0) + 1;
          console.error(JSON.stringify({ severity: "ERROR", event: "planning_form.failed", projectId: project.id, reason: caught instanceof Error ? caught.message : String(caught) }));
        }
      }
      if (page.size < 300) break;
      last = page.docs[page.docs.length - 1] ?? null;
    }
    console.log(JSON.stringify({ severity: "INFO", event: "planning_form.swept", ...tally }));
  },
);
