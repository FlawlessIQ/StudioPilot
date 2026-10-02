import { getFirestore, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { clientOutreachStop } from "../post-event/client-outreach.js";
import { coupleFormSections, coupleVisibleAnswers, type CoupleSection } from "../intake/inquiry-form.js";
import { coupleInquiryUrl } from "./consultation-email.js";

/**
 * "Ahead of our call" — the couple's own answers and the call's details, the
 * day before their consultation.
 *
 * Until 2026-10-02 nothing reached the couple between booking the call and
 * the call itself: the `consultation_reminder` template existed and nothing
 * queued it. Conor: send them a summary ahead of the consultation.
 *
 * Two parts, kept apart on purpose:
 *   - the facts — when and how the call happens, and what they told us on
 *     the event form, read from the records;
 *   - "a few things we'd like to talk about" — from the AI's read of their
 *     answers (questionnaire analysis, which runs when the call is booked).
 *
 * The draft with both waits for the studio on Today. A studio that has
 * switched this message to automatic (Settings → Messages, or the trust
 * dial's offer after three unedited approvals) sends the facts alone: a
 * model's words never go to a couple without a person reading them.
 *
 * Hourly, so a call booked for tomorrow afternoon still gets its note.
 * One per consultation, ever: `aiActions/ai_consultation_prep_{id}`.
 */

export const CONSULTATION_PREP_TRIGGER = "consultation_prep";
export const CONSULTATION_PREP_CAPABILITY = "consultation_prep_draft";

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export type ConsultationPrepSetting = { enabled: boolean; offsetDays: number; autoSend: boolean };
export const DEFAULT_CONSULTATION_PREP: ConsultationPrepSetting = { enabled: true, offsetDays: -1, autoSend: false };

/** The studio's setting, from tenants/{id}.lifecycleMessaging.consultation_prep. */
export function consultationPrepSetting(lifecycleMessaging: unknown): ConsultationPrepSetting {
  const entry = record(record(lifecycleMessaging)[CONSULTATION_PREP_TRIGGER]);
  const offset = Number(entry.offsetDays);
  return {
    enabled: typeof entry.enabled === "boolean" ? entry.enabled : DEFAULT_CONSULTATION_PREP.enabled,
    offsetDays: Number.isInteger(offset) && offset <= 0 && offset >= -7 ? offset : DEFAULT_CONSULTATION_PREP.offsetDays,
    autoSend: entry.autoSend === true,
  };
}

/**
 * Pure: whether the note is due now. `offsetDays` before the call (the day
 * before, by default); a call booked later than that gets it at once. Zero
 * means the morning of: three hours before. Never once the call has started.
 */
export function consultationPrepDue(input: { startsAt: string; offsetDays: number; now: Date }): boolean {
  const start = Date.parse(input.startsAt);
  if (!Number.isFinite(start)) return false;
  const now = input.now.valueOf();
  if (now >= start) return false;
  const lead = input.offsetDays === 0 ? 3 * 3_600_000 : -input.offsetDays * 86_400_000;
  return now >= start - lead;
}

/** "Thursday, October 8 at 3:00 PM (EDT)". */
export function spokenCallTime(startsAt: string, timezone: string | null): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.valueOf())) return startsAt;
  const zone = timezone || "UTC";
  try {
    const day = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: zone }).format(date);
    const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone, timeZoneName: "short" }).formatToParts(date);
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
    const zoneName = part("timeZoneName");
    return `${day} at ${part("hour")}:${part("minute")} ${part("dayPeriod")}${zoneName ? ` (${zoneName})` : ""}`;
  } catch {
    return date.toUTCString();
  }
}

/** How the call happens, in the couple's words. */
export function howWeMeet(consultation: Row): string {
  const mode = text(consultation.mode);
  const joinUrl = text(consultation.joinUrl);
  const location = text(consultation.location);
  if (mode === "zoom") return joinUrl ? `On Zoom: ${joinUrl}` : "On Zoom — we'll send you the link before the call.";
  if (mode === "phone") return location ? `We'll call you on ${location}.` : "We'll call you at the number you gave us.";
  if (mode === "in_person") return location ? `In person, at ${location}.` : "In person — we'll confirm where.";
  return location ? `Where: ${location}` : "";
}

/** "Venue: The Barn at Hudson" lines, for every question they answered that a couple can read back. */
export function answerLines(sections: readonly CoupleSection[], answers: Row): string[] {
  const lines: string[] = [];
  for (const section of sections) {
    for (const field of section.fields) {
      if (["information", "acknowledgement", "checkbox", "file"].includes(field.type)) continue;
      const value = answers[field.id];
      const spoken = Array.isArray(value)
        ? value.map((entry) => text(entry)).filter(Boolean).join(", ")
        : typeof value === "string"
          ? value.trim()
          : typeof value === "number"
            ? String(value)
            : "";
      if (!spoken) continue;
      const shown = field.type === "time" && /^\d{2}:\d{2}$/.test(spoken)
        ? `${Number(spoken.slice(0, 2)) % 12 || 12}:${spoken.slice(3)} ${Number(spoken.slice(0, 2)) < 12 ? "AM" : "PM"}`
        : field.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(spoken)
          ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${spoken}T12:00:00Z`))
          : spoken.replace(/\s+/g, " ").slice(0, 300);
      lines.push(`• ${field.label.replace(/[:?]\s*$/, "")}: ${shown}`);
    }
  }
  return lines.slice(0, 25);
}

/** Pure: the note. `talkAbout` empty = the facts alone (what auto-send sends). */
export function consultationPrepMessage(input: {
  studioName: string;
  callTime: string;
  meeting: string;
  answers: string[];
  talkAbout: string[];
  inquiryUrl: string | null;
}): { subject: string; body: string } {
  const paragraphs = [
    `Looking forward to our call on ${input.callTime}.`,
    ...(input.meeting ? [input.meeting] : []),
  ];
  if (input.answers.length)
    paragraphs.push(`Here's what you've told us about your day so far:\n${input.answers.join("\n")}`);
  if (input.talkAbout.length)
    paragraphs.push(`A few things we'd like to talk about:\n${input.talkAbout.map((line) => `• ${line}`).join("\n")}`);
  paragraphs.push(
    input.inquiryUrl
      ? `If anything's changed, or you need to move the call, you can do it here: ${input.inquiryUrl}`
      : "If anything's changed, just reply to this email.",
  );
  paragraphs.push(`See you then,\n${input.studioName}`);
  return { subject: `Ahead of our call — ${input.callTime.split(" at ")[0]}`, body: paragraphs.join("\n\n") };
}

/** Couple-facing questions from the AI's read: its suggested questions, never its internal notes. */
export function talkAboutFrom(aiReview: unknown): string[] {
  const review = record(aiReview);
  const questions = (Array.isArray(review.suggestedQuestions) ? review.suggestedQuestions : [])
    .map((entry) => text(entry))
    .filter((entry) => entry.length > 3 && entry.length <= 240);
  return [...new Set(questions)].slice(0, 4);
}

async function prepareOne(db: Firestore, consultation: DocumentSnapshot, now: Date): Promise<string> {
  const data = consultation.data() ?? {};
  const tenantId = text(data.tenantId);
  const projectId = text(data.projectId);
  if (!tenantId || !projectId || data.archivedAt || text(data.status) !== "scheduled") return "skipped";
  const actionId = `ai_consultation_prep_${consultation.id}`;
  const actionReference = db.doc(`aiActions/${actionId}`);
  if ((await actionReference.get()).exists) return "skipped";

  const [tenant, project] = await Promise.all([db.doc(`tenants/${tenantId}`).get(), db.doc(`projects/${projectId}`).get()]);
  const setting = consultationPrepSetting(tenant.get("lifecycleMessaging"));
  if (!setting.enabled) return "off";
  if (!consultationPrepDue({ startsAt: text(data.startsAt), offsetDays: setting.offsetDays, now })) return "not_yet";
  const job = project.data() ?? null;
  if (!job || job.tenantId !== tenantId) return "skipped";
  // Archived, paused (an imported booking), cancelled, on hold: nothing goes.
  if (clientOutreachStop(job)) return "quiet";

  // Who it's for: the consultation's contact, else the job's first client contact.
  const contactIds = [text(data.contactId), ...(Array.isArray(job.clientContactIds) ? (job.clientContactIds as unknown[]).map(text) : [])].filter(Boolean);
  let recipientEmail: string | null = null;
  let recipientName: string | null = null;
  let contactId: string | null = null;
  for (const id of [...new Set(contactIds)].slice(0, 4)) {
    const contact = (await db.doc(`contacts/${id}`).get()).data();
    if (!contact || contact.tenantId !== tenantId || !text(contact.email).includes("@")) continue;
    recipientEmail = text(contact.email);
    recipientName = text(contact.displayName) || [text(contact.firstName), text(contact.lastName)].filter(Boolean).join(" ") || null;
    contactId = id;
    break;
  }

  // Their event form, and the AI's read of it when there is one.
  const responses = await db
    .collection("questionnaireResponses")
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", projectId)
    .limit(20)
    .get();
  const form = responses.docs
    .filter((response) => !response.get("archivedAt") && text(response.get("status")) !== "withdrawn")
    .sort((left, right) => (left.get("source") === "inquiry_page" ? -1 : 0) - (right.get("source") === "inquiry_page" ? -1 : 0))[0];
  const sections = form ? coupleFormSections(record(form.get("templateSnapshot")).sections) : [];
  const answers = form ? answerLines(sections, coupleVisibleAnswers(sections, record(form.get("answers")))) : [];
  const talkAbout = form ? talkAboutFrom(form.get("aiReview")) : [];

  const studioName = text(tenant.get("brandName")) || text(tenant.get("businessName")) || "The studio";
  const callTime = spokenCallTime(text(data.startsAt), text(data.timezone) || text(job.timezone) || text(tenant.get("timezone")) || null);
  const meeting = howWeMeet(data);
  const inquiryUrl = text(data.selfServeUrl) || (await coupleInquiryUrl(db, { tenantId, projectId, now: now.toISOString() }).catch(() => null));
  const full = consultationPrepMessage({ studioName, callTime, meeting, answers, talkAbout, inquiryUrl });
  const factsOnly = consultationPrepMessage({ studioName, callTime, meeting, answers, talkAbout: [], inquiryUrl });

  const autoSend = setting.autoSend && Boolean(recipientEmail);
  const draft = autoSend ? factsOnly : full;
  const couple = text(job.name).replace(/\s+wedding$/i, "") || "the couple";
  const at = now.toISOString();
  const issues = recipientEmail
    ? []
    : [{ code: "MISSING_RECIPIENT", severity: "warning" as const, message: "There's no email on the couple's client record.", field: "recipientEmail" }];

  const batch = db.batch();
  batch.create(actionReference, {
    id: actionId,
    tenantId,
    projectId,
    actorId: "consultation-prep-scheduler",
    title: `Ahead of the call: ${couple}`,
    // The trust dial counts these by trigger (features/messaging/trust-dial.ts).
    lifecycleTrigger: CONSULTATION_PREP_TRIGGER,
    capability: CONSULTATION_PREP_CAPABILITY,
    authorityBoundary: "draft_requires_review",
    status: autoSend ? "executed" : "review_required",
    modelProvider: "studiocue",
    // The words are a template; the "talk about" lines are the questionnaire
    // analysis's, which a person reads before they go.
    modelVersion: talkAbout.length && !autoSend ? "deterministic_template+questionnaire_review" : "deterministic_template",
    instructionVersion: "consultation_prep_v1",
    outputSchemaVersion: "message_draft_output_v1",
    sourceReferences: [
      { entityType: "consultation", entityId: consultation.id, versionId: null, label: `Call on ${callTime}`, locator: null },
      ...(form ? [{ entityType: "questionnaire_response", entityId: form.id, versionId: null, label: text(form.get("templateName")) || "Event form", locator: "answers" }] : []),
    ],
    structuredOutput: {
      trigger: CONSULTATION_PREP_TRIGGER,
      subject: draft.subject,
      body: draft.body,
      recipientEmail,
      recipientName,
      contactId,
      consultationId: consultation.id,
      callStartsAt: text(data.startsAt),
      highlights: talkAbout,
    },
    confidence: { overall: issues.length ? 0.7 : 0.95, label: issues.length ? "medium" : "high", uncertainFields: [] },
    validation: { status: issues.length ? "pending" : "passed", issues },
    decision: autoSend
      ? { actorId: "consultation-prep-scheduler", action: "approved", decidedAt: at, note: "Sent under the studio's automatic setting: their answers and the call's details only.", editDelta: null }
      : null,
    downstreamCommand: autoSend ? { commandType: "queue_lifecycle_email", commandId: `consultation_prep_email_${consultation.id}`, executedAt: at } : null,
    usage: { inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0, latencyMs: 0, estimatedMinutesSaved: 10 },
    failure: null,
    snoozedUntil: null,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
    createdBy: "consultation-prep-scheduler",
    updatedBy: "consultation-prep-scheduler",
  });
  if (autoSend) {
    const emailJobId = `consultation_prep_email_${consultation.id}`;
    batch.create(db.doc(`emailJobs/${emailJobId}`), {
      id: emailJobId,
      tenantId,
      projectId,
      contactId,
      recipient: recipientEmail,
      recipientName,
      projectName: text(job.name) || null,
      type: "manual_message",
      customSubject: draft.subject,
      customBody: draft.body,
      actionLabel: text(data.joinUrl) ? "Join the video call" : null,
      actionUrl: text(data.joinUrl) || null,
      category: "general",
      aiActionId: actionId,
      clientOutreachGuard: true,
      status: "queued",
      scheduledFor: null,
      attempts: 0,
      createdAt: at,
      updatedAt: at,
    });
    const receiptId = `receipt_${actionId}`;
    batch.set(db.doc(`actionReceipts/${receiptId}`), {
      id: receiptId,
      tenantId,
      projectId,
      title: `Sent "Ahead of our call" to ${couple}`,
      summary: "Their answers and the call's details, under the studio's automatic setting.",
      status: "completed",
      source: "consultation_prep",
      affectedEntityType: "aiAction",
      affectedEntityId: actionId,
      providerEvidence: { emailJobId },
      reversible: false,
      retryable: false,
      canCancel: false,
      canRetry: false,
      createdAt: at,
      updatedAt: at,
    });
  }
  await batch.commit();
  return autoSend ? "sent" : "drafted";
}

/**
 * Pure: whether an approval still makes sense — the call it's for is still
 * on, and still ahead. A draft for a call that moved or passed must not go.
 */
export function consultationPrepStale(consultation: Row | null, now: Date): string | null {
  if (!consultation) return "CONSULTATION_PREP_STALE";
  if (text(consultation.status) !== "scheduled" || consultation.archivedAt) return "CONSULTATION_PREP_STALE";
  const start = Date.parse(text(consultation.startsAt));
  return Number.isFinite(start) && start > now.valueOf() ? null : "CONSULTATION_PREP_STALE";
}

export const consultationPrepScheduler = onSchedule(
  { schedule: "every 60 minutes", timeZone: "UTC", retryCount: 2 },
  async () => {
    const db = getFirestore();
    const now = new Date();
    // Up to a week ahead covers every offset a studio can choose.
    const horizon = new Date(now.valueOf() + 8 * 86_400_000).toISOString();
    const tally: Record<string, number> = {};
    const upcoming = await db
      .collection("consultations")
      .where("startsAt", ">=", now.toISOString())
      .where("startsAt", "<=", horizon)
      .orderBy("startsAt")
      .limit(500)
      .get();
    for (const consultation of upcoming.docs) {
      try {
        const outcome = await prepareOne(db, consultation, now);
        tally[outcome] = (tally[outcome] ?? 0) + 1;
      } catch (caught) {
        tally.failed = (tally.failed ?? 0) + 1;
        console.error(
          JSON.stringify({
            severity: "ERROR",
            event: "consultation_prep.failed",
            consultationId: consultation.id,
            reason: caught instanceof Error ? caught.message : String(caught),
          }),
        );
      }
    }
    console.log(JSON.stringify({ severity: "INFO", event: "consultation_prep.swept", ...tally }));
  },
);
