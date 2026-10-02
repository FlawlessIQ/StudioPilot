import { getFirestore, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { clientOutreachStop } from "../post-event/client-outreach.js";
import { INQUIRY_FORM_SETTINGS_PATH, resolveInquiryFormTemplate } from "../intake/inquiry-form.js";
import { liveAssignmentFor } from "./questionnaire-lifecycle.js";
import { planningFormOpensOn, resolvePlanningTimeline, type PlanningTimeline } from "./planning-timeline.js";
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

async function sendOne(db: Firestore, project: DocumentSnapshot, studio: Studio, today: string, now: string): Promise<string> {
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
  if (live) return "has_it";
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
