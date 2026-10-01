import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { clientOutreachStop } from "../post-event/client-outreach.js";
import { questionnaireReminderDue } from "./questionnaire-reminders.js";
import { questionnaireLinkFor } from "./questionnaire-link.js";

/**
 * Send the questionnaire reminders templates have always promised.
 *
 * Each template stores the days before its due date to remind the client, and
 * the reminder email existed — but nothing ever queued one. This does, once a
 * day, deciding with questionnaireReminderDue (latest reminder only, never the
 * same day the form went out, nothing once submitted or overdue) and queuing
 * each at most once: the email job's id names the response and the offset, so
 * a second run the same day creates nothing.
 *
 * A quiet imported booking gets none, and neither does a job that is no longer
 * going ahead.
 */
export const questionnaireReminderScheduler = onSchedule(
  { schedule: "every day 14:00", timeZone: "UTC", retryCount: 1, region: "us-east4" },
  async () => {
    const db = getFirestore();
    const today = new Date().toISOString().slice(0, 10);
    const responses = await db
      .collection("questionnaireResponses")
      .where("status", "in", ["not_started", "in_progress"])
      .limit(500)
      .get();
    const templateDays = new Map<string, number[]>();

    for (const response of responses.docs) {
      if (response.get("archivedAt")) continue;
      const projectId = String(response.get("projectId") ?? "");
      const tenantId = String(response.get("tenantId") ?? "");
      if (!projectId || !tenantId) continue;

      let days = response.get("reminderDaysBeforeDue") as unknown;
      if (!Array.isArray(days)) {
        // Responses assigned before the days were snapshotted read the template.
        const templateId = String(response.get("templateId") ?? "");
        if (!templateDays.has(templateId)) {
          const template = templateId ? await db.doc(`questionnaireTemplates/${templateId}`).get() : null;
          const stored = template?.get("reminderDaysBeforeDue");
          templateDays.set(templateId, Array.isArray(stored) ? stored.map(Number) : []);
        }
        days = templateDays.get(templateId);
      }
      const sent = response.get("remindersSent");
      const offset = questionnaireReminderDue({
        status: String(response.get("status")),
        dueDate: typeof response.get("dueDate") === "string" ? String(response.get("dueDate")) : null,
        reminderDaysBeforeDue: (days as unknown[]).map(Number),
        sentOffsets: Array.isArray(sent) ? sent.map(Number) : [],
        assignedOn: String(response.get("createdAt") ?? "").slice(0, 10),
        today,
      });
      if (offset === null) continue;

      const project = await db.doc(`projects/${projectId}`).get();
      if (!project.exists || project.get("tenantId") !== tenantId) continue;
      // Quiet, archived (by state or by `archivedAt`, which this used to miss),
      // cancelled, lost or on hold.
      if (clientOutreachStop(project.data())) continue;

      const now = new Date().toISOString();
      const jobReference = db.doc(`emailJobs/questionnaire_reminder_${response.id}_${offset}`);
      try {
        // A form sent before the couple was in the portal (to an inquiry)
        // reminds them with an invitation, not a sign-in page
        // (questionnaire-link.ts). Written only if this reminder is.
        const link = await questionnaireLinkFor(db, {
          tenantId,
          projectId,
          clientContactIds: project.get("clientContactIds"),
          emailJobId: jobReference.id,
          actorId: "questionnaire-reminder-scheduler",
          now,
        });
        await db.runTransaction(async (transaction) => {
          const existing = await transaction.get(jobReference);
          if (existing.exists) return;
          if (link.invitationWrite)
            transaction.set(link.invitationWrite.reference, link.invitationWrite.data, {
              merge: true,
            });
          transaction.create(jobReference, {
            id: jobReference.id,
            tenantId,
            projectId,
            type: "questionnaire_reminder",
            actionUrl: link.actionUrl,
            questionnaireResponseId: response.id,
            reminderDaysBeforeDue: offset,
            status: "queued",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          });
          // Not updatedAt: a reminder isn't an edit, and the client's form
          // shouldn't see the response change under it.
          transaction.update(response.ref, {
            remindersSent: FieldValue.arrayUnion(offset),
            lastReminderAt: now,
          });
        });
      } catch (caught: unknown) {
        // One response failing to queue must not stop the rest of the run.
        console.error("questionnaire reminder not queued", response.id, caught);
      }
    }
  },
);
