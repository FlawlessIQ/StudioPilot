import { isSalesConsultation } from "../booking/consultation-purpose.js";
import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { isReturned, liveAssignmentFor } from "../planning/questionnaire-lifecycle.js";
import { allowsTbd, isTbd, suggestedFromOf, TBD, type SuggestedFrom } from "../planning/field-extras.js";

/**
 * The studio's event form, on the couple's inquiry page.
 *
 * GR Productions (2026-10-01): "Between inquiry received and consultation we
 * need to add 'client fills out event form'. Studio needs info from that for
 * the meeting. And for the contract." The couple already has one page from the
 * studio's first reply — /i/<token>, tell us about your day, pick a time to
 * talk (inquiry-link.ts). The form goes on that page, before the times, with
 * no sign-in: the token is the credential, as for the rest of the page.
 *
 * The answers are an ordinary `questionnaireResponses` record on the job, the
 * same shape "Send the form" makes (planning/commands.ts, assignQuestionnaire),
 * so the studio's questionnaire views, the crew brief and the contract's
 * {{form.answers}} read it unchanged. It is marked `source: "inquiry_page"`.
 *
 * A response needs a job, and an inquiry without a date has none yet
 * (convert.ts returns `no_date`). So a dateless inquiry is asked for its date
 * first — the page's details step, which turns the inquiry into a job the
 * moment the date arrives — and the form comes after. Booking a call needs
 * the job too (public-scheduling.ts, EVENT_DATE_REQUIRED), and needs the form
 * sent, so by the time a consultation exists the response does as well.
 *
 * The AI read of the answers waits for the call (queueInquiryFormAnalysis):
 * it is charged to the studio, and a couple who never books shouldn't cost one.
 *
 * The pure parts are exported for tests/inquiry-event-form.test.ts.
 */

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** What the setting applies to until a studio can choose: weddings. */
export const INQUIRY_FORM_EVENT_TYPES: readonly string[] = ["wedding"];

/** Where the setting lives: the studio's inquiry settings, one per tenant. */
export const INQUIRY_FORM_SETTINGS_PATH = (tenantId: string) => `leadCaptureSettings/${tenantId}`;

/** Marks a response made on the inquiry page, for the studio and the portal. */
export const INQUIRY_FORM_SOURCE = "inquiry_page";

/**
 * What kind of event an inquiry is, in one word.
 *
 * `eventTypeId` on a lead is the studio's default ("wedding") whatever the
 * couple asked for; the label is what they actually picked on the form
 * ("Engagement", "Corporate" — form-email.ts, eventTypeFrom). So the label
 * decides when there is one, and the id when there is not.
 */
export function inquiryEventKind(input: {
  eventTypeId?: unknown;
  eventTypeLabel?: unknown;
  /**
   * The kind of the studio's own type, from its inquiry form
   * (inquiry-form-config.ts). It decides when present: a studio can call its
   * wedding type "Big Day", and it is still a wedding; a type it says is not
   * a wedding is not one, whatever its name.
   */
  eventKind?: unknown;
}): string {
  const label = text(input.eventTypeLabel).toLowerCase();
  const kind = text(input.eventKind).toLowerCase();
  if (kind === "wedding") return "wedding";
  if (kind) return label.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || kind;
  if (label) {
    if (/wedding|elopement|marriage|ceremony/.test(label)) return "wedding";
    return label.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }
  return text(input.eventTypeId).toLowerCase() || "wedding";
}

/** The one rule for which inquiries are asked to fill in the form. */
export function inquiryGetsEventForm(
  inquiry: { eventTypeId?: unknown; eventTypeLabel?: unknown; eventKind?: unknown },
  appliesTo: readonly string[] = INQUIRY_FORM_EVENT_TYPES,
): boolean {
  return appliesTo.includes(inquiryEventKind(inquiry));
}

type TemplateLike = {
  id: string;
  status?: unknown;
  name?: unknown;
  supersedesTemplateId?: unknown;
  archivedAt?: unknown;
};

/**
 * The template the studio chose, as it stands now.
 *
 * Editing a template makes a new version with a new id and archives the old
 * one (planning/commands.ts, updateQuestionnaireTemplate), so the id the
 * setting was saved with goes stale on the first edit. This follows
 * `supersedesTemplateId` forward to the live version. A chain that ends in
 * nothing active — the studio archived the form — means no form.
 */
export function resolveInquiryFormTemplate<T extends TemplateLike>(
  templates: readonly T[],
  chosenId: string,
): T | null {
  let current = templates.find((template) => template.id === chosenId) ?? null;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.status === "active" && !current.archivedAt) return current;
    seen.add(current.id);
    const from: string = current.id;
    current = templates.find((template) => text(template.supersedesTemplateId) === from) ?? null;
  }
  return null;
}

export type CoupleField = {
  id: string;
  label: string;
  type: string;
  required: boolean;
  locked: boolean;
  options: string[];
  conditionalOn: { fieldId: string; equals: unknown } | null;
  /** A note under the question, "TBD" allowed, a suggested time (planning/field-extras.ts). */
  help?: string;
  allowTbd?: boolean;
  suggestedFrom?: SuggestedFrom;
};
export type CoupleSection = { id: string; title: string; fields: CoupleField[] };

/**
 * Answer types the inquiry page can take. `file` is left out: an upload goes
 * to the client portal's storage path, which needs a signed-in couple. The
 * studio sees an unanswered file question on the job as usual.
 */
const COUPLE_TYPES = new Set([
  "text",
  "long_text",
  "email",
  "phone",
  "date",
  "time",
  "address",
  "dropdown",
  "multi_select",
  "radio",
  "checkbox",
  "contact",
  "repeating_group",
  "acknowledgement",
  "information",
]);

/** The template's sections as the couple sees them: no internal or file questions. */
export function coupleFormSections(sections: unknown): CoupleSection[] {
  return (Array.isArray(sections) ? sections : []).flatMap((value, index) => {
    const section = record(value);
    const fields = (Array.isArray(section.fields) ? section.fields : []).flatMap((candidate) => {
      const field = record(candidate);
      const id = text(field.id);
      const type = text(field.type) || "text";
      if (!id || field.internalOnly === true || !COUPLE_TYPES.has(type)) return [];
      const condition = record(field.conditionalOn);
      return [
        {
          id,
          label: text(field.label) || id,
          type,
          required: field.required === true && type !== "information",
          locked: field.locked === true,
          options: Array.isArray(field.options) ? field.options.map(String) : [],
          conditionalOn: text(condition.fieldId) ? { fieldId: text(condition.fieldId), equals: condition.equals } : null,
          ...(text(field.help) ? { help: text(field.help).slice(0, 500) } : {}),
          ...(allowsTbd(field) ? { allowTbd: true } : {}),
          ...(suggestedFromOf(field.suggestedFrom) ? { suggestedFrom: suggestedFromOf(field.suggestedFrom)! } : {}),
        } satisfies CoupleField,
      ];
    });
    return fields.length
      ? [{ id: text(section.id) || `section-${index + 1}`, title: text(section.title) || "About your day", fields }]
      : [];
  });
}

/** Whether a field shows, given the answers so far (as the portal decides it). */
function shows(field: CoupleField, answers: Record<string, unknown>): boolean {
  return (
    !field.conditionalOn ||
    JSON.stringify(answers[field.conditionalOn.fieldId]) === JSON.stringify(field.conditionalOn.equals)
  );
}

/** The same "answered" the portal uses (features/questionnaires/outstanding.ts). */
export function answerIsPresent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value;
  return String(value ?? "").trim().length > 0;
}

/** Required questions showing and still empty, in form order. */
export function outstandingCoupleFields(sections: readonly CoupleSection[], answers: Record<string, unknown>): CoupleField[] {
  return sections.flatMap((section) =>
    section.fields.filter((field) => field.required && shows(field, answers) && !answerIsPresent(answers[field.id])),
  );
}

/** How much of what was asked for is in, for the studio's "Answered n%". */
export function coupleCompletionPercent(sections: readonly CoupleSection[], answers: Record<string, unknown>): number {
  const required = sections.flatMap((section) => section.fields.filter((field) => field.required && shows(field, answers)));
  if (!required.length) return answersPresent(sections, answers) ? 100 : 0;
  const done = required.filter((field) => answerIsPresent(answers[field.id])).length;
  return Math.round((done / required.length) * 100);
}

function answersPresent(sections: readonly CoupleSection[], answers: Record<string, unknown>): boolean {
  return sections.some((section) => section.fields.some((field) => answerIsPresent(answers[field.id])));
}

const MAX_TEXT = 5000;

/**
 * One answer, checked against its question, or `undefined` to drop it.
 *
 * The browser is not trusted with the shape: a choice must be one of the
 * options, a date a date, a tick a boolean. An empty value clears an answer.
 */
function coerce(field: CoupleField, value: unknown): unknown {
  if (value === null || value === "") return null;
  // "Not decided yet", where the studio offers it: answered, and said so.
  if (field.allowTbd && isTbd(value)) return TBD;
  switch (field.type) {
    case "checkbox":
    case "acknowledgement":
      return typeof value === "boolean" ? value : undefined;
    case "multi_select": {
      if (!Array.isArray(value)) return undefined;
      const picked = [...new Set(value.map(String))];
      if (field.options.length && picked.some((option) => !field.options.includes(option))) return undefined;
      return picked.slice(0, 50);
    }
    case "dropdown":
    case "radio":
      if (typeof value !== "string") return undefined;
      return !field.options.length || field.options.includes(value) ? value : undefined;
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
    case "time":
      return typeof value === "string" && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : undefined;
    case "email":
      return typeof value === "string" && value.length <= 254 ? value.trim() : undefined;
    default:
      return typeof value === "string" ? value.slice(0, MAX_TEXT) : undefined;
  }
}

export type CoupleSave = {
  /** Every answer the response will hold: the prior ones, with the couple's changes. */
  answers: Record<string, unknown>;
  /** Field ids whose value changed. */
  changed: string[];
  /** Labels of required questions still empty — a submit is refused while any are. */
  missing: string[];
};

/**
 * What a couple's save does to the answers.
 *
 * Merges like saveQuestionnaire (planning/questionnaire-answers.ts): it can
 * change a field and never removes one it did not mention, so the studio's
 * internal answers survive. A couple may write only questions they are shown
 * — not internal, not locked, not information, not files — and anything that
 * does not fit its question is dropped rather than stored.
 */
export function applyCoupleAnswers(input: {
  sections: readonly CoupleSection[];
  prior: Record<string, unknown>;
  incoming: Record<string, unknown>;
}): CoupleSave {
  const writable = new Map(
    input.sections.flatMap((section) =>
      section.fields.filter((field) => !field.locked && field.type !== "information").map((field) => [field.id, field] as const),
    ),
  );
  const answers = { ...input.prior };
  const changed: string[] = [];
  for (const [fieldId, value] of Object.entries(input.incoming)) {
    const field = writable.get(fieldId);
    if (!field) continue;
    const next = coerce(field, value);
    if (next === undefined) continue;
    if (JSON.stringify(answers[fieldId] ?? null) === JSON.stringify(next)) continue;
    answers[fieldId] = next;
    changed.push(fieldId);
  }
  return {
    answers,
    changed,
    missing: outstandingCoupleFields(input.sections, answers).map((field) => field.label),
  };
}

/** Only the answers to questions the couple sees: never the studio's internal ones. */
export function coupleVisibleAnswers(sections: readonly CoupleSection[], answers: Record<string, unknown>) {
  const ids = new Set(sections.flatMap((section) => section.fields.map((field) => field.id)));
  return Object.fromEntries(Object.entries(answers).filter(([fieldId]) => ids.has(fieldId)));
}

const labelKey = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Questions the couple just answered on the page's details step, by label. */
const INQUIRY_DETAIL_ALIASES: ReadonlyArray<{
  labels: readonly string[];
  value: (lead: { get(field: string): unknown }) => string | null;
}> = [
  {
    labels: ["expected guest count", "guest count", "estimated guest count", "number of guests", "how many guests"],
    value: (lead) => {
      const count = Number(lead.get("estimatedGuestCount"));
      return Number.isFinite(count) && count > 0 ? String(Math.round(count)) : null;
    },
  },
  {
    labels: ["second partner s full name", "partner s name", "partner name", "partner s full name", "your partner s name"],
    value: (lead) => text(lead.get("partnerName")) || null,
  },
  {
    labels: ["first partner s full name", "your full name", "your name"],
    value: (lead) => {
      const first = text(lead.get("firstName"));
      const last = text(lead.get("lastName"));
      return first && last ? `${first} ${last}` : null;
    },
  },
];

/**
 * What the couple already told the page, as answers to the same questions on
 * the studio's form.
 *
 * The dateless walk (2026-10-01): the date step asks for their partner's name
 * and roughly how many guests, and the form that opens straight after asked
 * "Second partner's full name" and "Expected guest count" again. The job holds
 * neither (intake/convert.ts), so verifiedPrefill — which reads the job —
 * could not fill them. These come from the inquiry itself, marked as the
 * couple's own answer, not a verified fact; the job's facts win where both
 * have one. Text-like questions only: a choice or a time is theirs to pick.
 */
export function inquiryDetailsPrefill(
  lead: { get(field: string): unknown },
  sections: unknown,
): { answers: Record<string, unknown>; answerProvenance: Record<string, unknown> } {
  const answers: Record<string, unknown> = {};
  const answerProvenance: Record<string, unknown> = {};
  for (const section of Array.isArray(sections) ? sections : []) {
    for (const candidate of Array.isArray(record(section).fields) ? (record(section).fields as unknown[]) : []) {
      const field = record(candidate);
      const fieldId = text(field.id);
      if (!fieldId || field.internalOnly === true || field.locked === true) continue;
      if (!["text", "long_text", ""].includes(text(field.type))) continue;
      const label = labelKey(field.label ?? field.id);
      const alias = INQUIRY_DETAIL_ALIASES.find((item) => item.labels.includes(label));
      const value = alias?.value(lead);
      if (!value) continue;
      answers[fieldId] = value;
      answerProvenance[fieldId] = {
        sourceType: "client_answer",
        sourceId: fieldId,
        label: "From their inquiry details",
        verified: false,
      };
    }
  }
  return { answers, answerProvenance };
}

/**
 * The response's id when the inquiry page makes it: one per job and form, so
 * a retried save, or two tabs, can only ever make the one.
 */
export function inquiryFormResponseId(tenantId: string, projectId: string, templateId: string): string {
  return `questionnaire_response_${createHash("sha256")
    .update(`${tenantId}:inquiry_form:${projectId}:${templateId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

/** Whether the couple still owes the form — what holds the time step back. */
export function inquiryFormOwed(form: { status: string } | null): boolean {
  return Boolean(form) && !isReturned(form!.status);
}

export type InquiryFormState = {
  template: FirebaseFirestore.QueryDocumentSnapshot;
  /** The response on the job for this form, if one exists (theirs or the studio's). */
  response: FirebaseFirestore.QueryDocumentSnapshot | null;
  /** No job yet: the couple gives the date first, which makes one. */
  requiresDate: boolean;
  status: string;
};

/**
 * Whether this inquiry gets the studio's event form, and where it stands.
 *
 * Null — the page goes straight to times as before — when the studio has not
 * chosen a form, the form is no longer active, the inquiry is not a wedding,
 * the studio withdrew this job's copy, or there is no job and the inquiry
 * already has a date (held as "Maybe an inquiry": nothing to attach answers
 * to, and nothing for the couple to do about it).
 */
export async function inquiryFormState(
  db: Firestore,
  context: {
    tenantId: string;
    lead: FirebaseFirestore.DocumentSnapshot;
    project: FirebaseFirestore.DocumentSnapshot | null;
  },
): Promise<InquiryFormState | null> {
  const settings = await db.doc(INQUIRY_FORM_SETTINGS_PATH(context.tenantId)).get();
  const setting = record(settings.get("inquiryEventForm"));
  const chosenId = text(setting.templateId);
  if (!chosenId) return null;
  const appliesTo = Array.isArray(setting.eventTypes) && setting.eventTypes.length
    ? setting.eventTypes.map(String)
    : INQUIRY_FORM_EVENT_TYPES;
  // The kind the couple chose on the form stands for the job too, until the
  // studio changes the job's event type.
  const kind = context.project
    ? {
        eventTypeId: context.project.get("eventTypeId"),
        eventTypeLabel: context.project.get("eventType"),
        eventKind:
          context.project.get("eventType") === context.lead.get("eventTypeLabel") ? context.lead.get("eventKind") : null,
      }
    : {
        eventTypeId: context.lead.get("eventTypeId"),
        eventTypeLabel: context.lead.get("eventTypeLabel"),
        eventKind: context.lead.get("eventKind"),
      };
  if (!inquiryGetsEventForm(kind, appliesTo)) return null;
  const templates = await db
    .collection("questionnaireTemplates")
    .where("tenantId", "==", context.tenantId)
    .limit(300)
    .get();
  const template = resolveInquiryFormTemplate(
    templates.docs.map((document) => ({ ...document.data(), id: document.id, snapshot: document })),
    chosenId,
  )?.snapshot;
  if (!template) return null;
  if (!context.project) {
    return /^\d{4}-\d{2}-\d{2}$/.test(text(context.lead.get("eventDate")))
      ? null
      : { template, response: null, requiresDate: true, status: "not_started" };
  }
  const onJob = await db
    .collection("questionnaireResponses")
    .where("tenantId", "==", context.tenantId)
    .where("projectId", "==", context.project.id)
    .limit(50)
    .get();
  const rows: Array<Record<string, unknown> & { id: string }> = onJob.docs.map((document) => ({
    ...document.data(),
    id: document.id,
  }));
  const sameForm = (row: Record<string, unknown>) =>
    row.templateId === template.id || (typeof row.templateName === "string" && row.templateName === template.get("name"));
  const live = liveAssignmentFor(rows, { id: template.id, name: text(template.get("name")) });
  // The studio took this job's copy back: not the couple's to fill in.
  if (!live && rows.some((row) => sameForm(row) && row.status === "withdrawn")) return null;
  const response = live ? (onJob.docs.find((document) => document.id === live.id) ?? null) : null;
  return {
    template,
    response,
    requiresDate: false,
    status: response ? text(response.get("status")) || "not_started" : "not_started",
  };
}

/* ── The AI read of the answers, when the studio needs it ───────────────── */

/**
 * One analysis job per response, whoever queues it — the id the portal's
 * saveQuestionnaire (planning/commands.ts) and the inquiry page share.
 */
export const questionnaireAnalysisJobId = (responseId: string) => `questionnaire_${responseId}`;

/** The aiJobs document saveQuestionnaire queues, in the one shape. */
export function questionnaireAnalysisJob(input: {
  tenantId: string;
  projectId: string;
  responseId: string;
  now: string;
}) {
  return {
    id: questionnaireAnalysisJobId(input.responseId),
    tenantId: input.tenantId,
    projectId: input.projectId,
    responseId: input.responseId,
    type: "questionnaire_analysis",
    status: "queued",
    attempts: 0,
    humanReviewRequired: true,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** A call that happened or is still to: not cancelled, moved, or missed. */
export function consultationStands(status: unknown): boolean {
  return ["scheduled", "completed"].includes(text(status));
}

/** Whether the job has a call that stands — the meeting the brief is for. */
export async function jobHasConsultation(
  db: Firestore,
  input: { tenantId: string; projectId: string },
): Promise<boolean> {
  const consultations = await db
    .collection("consultations")
    .where("tenantId", "==", input.tenantId)
    .where("projectId", "==", input.projectId)
    .limit(20)
    .get();
  // The sales call: the final details call a month out is not "the meeting
  // the brief is for" (booking/consultation-purpose.ts).
  return consultations.docs.some(
    (document) => isSalesConsultation(document.data()) && consultationStands(document.get("status")),
  );
}

/**
 * Queue the AI read of a form the couple sent from the inquiry page — once,
 * and only when the studio needs it.
 *
 * Analysis is charged to the studio's AI allowance, and the inquiry page is
 * public: a couple who fills the form in and never books would cost the studio
 * a run for an inquiry that went nowhere. The brief is for the meeting, so the
 * analysis waits for the meeting: the couple booking their call (inquiry_book),
 * the studio booking one (scheduleConsultation), a scheduling link, or — when
 * no call was booked here at all — the proposal going out. A form sent after
 * the call is already booked is queued at submit (public-scheduling.ts).
 *
 * `create`, not a merge: each of those moments can recur (a call moved, a
 * proposal resent) and none should run it again. A resubmit after the studio
 * reopens the form re-runs it from the submit path, as the portal does.
 *
 * Never throws: the read is never a reason to fail a booking.
 */
export async function queueInquiryFormAnalysis(
  db: Firestore,
  input: { tenantId: string; projectId: string; now: string },
): Promise<string[]> {
  try {
    const responses = await db
      .collection("questionnaireResponses")
      .where("tenantId", "==", input.tenantId)
      .where("projectId", "==", input.projectId)
      .limit(50)
      .get();
    const queued: string[] = [];
    for (const response of responses.docs) {
      if (response.get("source") !== INQUIRY_FORM_SOURCE) continue;
      if (!isReturned(response.get("status")) || response.get("archivedAt")) continue;
      try {
        await db
          .doc(`aiJobs/${questionnaireAnalysisJobId(response.id)}`)
          .create(
            questionnaireAnalysisJob({
              tenantId: input.tenantId,
              projectId: input.projectId,
              responseId: response.id,
              now: input.now,
            }),
          );
        queued.push(response.id);
      } catch (caught) {
        if (!alreadyExists(caught)) throw caught;
      }
    }
    return queued;
  } catch (caught) {
    console.error(
      JSON.stringify({
        event: "inquiry_form.analysis_queue_failed",
        tenantId: input.tenantId,
        projectId: input.projectId,
        message: (caught instanceof Error ? caught.message : String(caught)).slice(0, 300),
      }),
    );
    return [];
  }
}

/** Firestore's "that document is already there" (gRPC code 6). */
function alreadyExists(caught: unknown): boolean {
  const code = (caught as { code?: unknown })?.code;
  return (
    code === 6 ||
    code === "already-exists" ||
    /ALREADY_EXISTS/.test(caught instanceof Error ? caught.message : "")
  );
}
