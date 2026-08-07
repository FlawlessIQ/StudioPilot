import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { productEvent } from "../operations/product-events.js";
import {
  dueLifecycleMessages,
  renderLifecycleDraft,
  resolveLifecycleSettings,
  type LifecycleFacts,
} from "./lifecycle-core.js";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * Lifecycle comms pack — the scheduler half.
 *
 * Once a day, every booked project close to its event date gets its due
 * lifecycle drafts (T-30 schedule confirmation, T-30 final balance summary,
 * T-1 checklist) created as review_required aiActions. Drafts are rendered
 * deterministically from verified facts — no model call, no AI quota — and a
 * human approves each one in the AI review queue before anything is sent.
 * Draft IDs are stable per (project, trigger): reruns never duplicate work.
 */
export const lifecycleMessageScheduler = onSchedule(
  { schedule: "every day 13:00", timeZone: "UTC", retryCount: 3 },
  async () => {
    const db = getFirestore();
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const horizon = new Date(Date.now() + 32 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const projects = await db
      .collection("projects")
      .where("eventDate", ">", today)
      .where("eventDate", "<=", horizon)
      .limit(500)
      .get();

    const tenantSettings = new Map<
      string,
      { settings: ReturnType<typeof resolveLifecycleSettings>; studioName: string }
    >();

    for (const project of projects.docs) {
      const tenantId = text(project.get("tenantId"));
      if (!tenantId) continue;
      let tenantEntry = tenantSettings.get(tenantId);
      if (!tenantEntry) {
        const tenant = await db.doc(`tenants/${tenantId}`).get();
        tenantEntry = {
          settings: resolveLifecycleSettings(tenant.get("lifecycleMessaging")),
          studioName:
            text(tenant.get("brandName")) ||
            text(tenant.get("businessName")) ||
            "Your studio",
        };
        tenantSettings.set(tenantId, tenantEntry);
      }

      const due = dueLifecycleMessages({
        project: {
          id: project.id,
          tenantId,
          state: text(project.get("state")),
          eventDate: text(project.get("eventDate")) || null,
        },
        settings: tenantEntry.settings,
        today,
      });
      if (!due.length) continue;

      // Shared enrichment for every draft on this project.
      let recipientEmail: string | null = null;
      let recipientName: string | null = null;
      const contactIds = Array.isArray(project.get("clientContactIds"))
        ? (project.get("clientContactIds") as unknown[]).map(String)
        : [];
      if (contactIds[0]) {
        const contact = await db.doc(`contacts/${contactIds[0]}`).get();
        if (contact.exists && contact.get("tenantId") === tenantId) {
          recipientEmail = text(contact.get("email")) || null;
          recipientName = text(contact.get("displayName")) || null;
        }
      }
      let packageTotalCents: number | null = null;
      let retainerCents: number | null = null;
      const snapshotId = text(project.get("packageSnapshotId"));
      if (snapshotId) {
        const snapshot = await db.doc(`packageSnapshots/${snapshotId}`).get();
        if (snapshot.exists && snapshot.get("tenantId") === tenantId) {
          packageTotalCents =
            typeof snapshot.get("totalCents") === "number"
              ? (snapshot.get("totalCents") as number)
              : null;
          retainerCents =
            typeof snapshot.get("retainerCents") === "number"
              ? (snapshot.get("retainerCents") as number)
              : null;
        }
      }
      const publishedSchedule = await db
        .collection("schedules")
        .where("tenantId", "==", tenantId)
        .where("projectId", "==", project.id)
        .where("status", "==", "published")
        .limit(1)
        .get();
      const scheduleUrl = publishedSchedule.docs[0]
        ? `/client/schedule?project=${project.id}`
        : null;

      for (const item of due) {
        const actionId = `ai_${item.idempotencyKey}`;
        const actionReference = db.doc(`aiActions/${actionId}`);
        const existing = await actionReference.get();
        if (existing.exists) continue;

        const facts: LifecycleFacts = {
          studioName: tenantEntry.studioName,
          clientFirstName: recipientName?.split(" ")[0] ?? null,
          projectName: text(project.get("name")) || "your event",
          eventDate: text(project.get("eventDate")) || null,
          venueName: text(project.get("venueName")) || null,
          packageTotalCents,
          retainerPaidCents: retainerCents,
          balanceDueCents:
            packageTotalCents !== null && retainerCents !== null
              ? Math.max(0, packageTotalCents - retainerCents)
              : null,
          scheduleUrl,
          recipientEmail,
          recipientName,
        };
        const draft = renderLifecycleDraft(item.trigger, facts);
        const issues = draft.missingInformation.map((message) => ({
          code: "MISSING_INFORMATION",
          severity: "warning" as const,
          message,
          field: null,
        }));
        // Trust dial: an owner may opt this deterministic message into
        // auto-send. Only clean drafts (recipient present, nothing missing)
        // qualify; anything uncertain still waits for review.
        const autoSend =
          tenantEntry.settings[item.trigger].autoSend === true &&
          Boolean(recipientEmail) &&
          draft.missingInformation.length === 0;

        const batch = db.batch();
        batch.set(actionReference, {
          id: actionId,
          tenantId,
          projectId: project.id,
          actorId: "lifecycle-message-scheduler",
          title: `Review ${item.trigger.replaceAll("_", " ")}`,
          capability: "delivery_message_draft",
          authorityBoundary: "draft_requires_review",
          status: autoSend ? "executed" : "review_required",
          modelProvider: "studiocue",
          modelVersion: "deterministic_template",
          instructionVersion: "lifecycle_v1",
          outputSchemaVersion: "message_draft_output_v1",
          sourceReferences: [
            {
              entityType: "project",
              entityId: project.id,
              versionId: null,
              label: text(project.get("name")) || "Project",
              locator: null,
            },
            {
              entityType: "tenant",
              entityId: tenantId,
              versionId: null,
              label: tenantEntry.studioName,
              locator: null,
            },
          ],
          structuredOutput: {
            trigger: item.trigger,
            subject: draft.subject,
            body: draft.body,
            recipientEmail: draft.recipientEmail,
            recipientName: draft.recipientName,
            highlights: draft.highlights,
          },
          confidence: {
            overall: draft.missingInformation.length ? 0.7 : 0.95,
            label: draft.missingInformation.length ? "medium" : "high",
            uncertainFields: draft.missingInformation.slice(0, 8),
          },
          validation: {
            status: issues.length ? "pending" : "passed",
            issues,
          },
          decision: autoSend
            ? {
                actorId: "lifecycle-message-scheduler",
                action: "approved",
                decidedAt: now,
                note: "Auto-send enabled by the studio owner for this deterministic lifecycle message.",
                editDelta: null,
              }
            : null,
          downstreamCommand: autoSend
            ? {
                commandType: "queue_lifecycle_email",
                commandId: `lifecycle_email_${actionId}`,
                executedAt: now,
              }
            : null,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostMicros: 0,
            latencyMs: 0,
            estimatedMinutesSaved: 10,
          },
          failure: null,
          snoozedUntil: null,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
          createdBy: "lifecycle-message-scheduler",
          updatedBy: "lifecycle-message-scheduler",
        });
        if (autoSend) {
          const emailJobId = `lifecycle_email_${actionId}`;
          batch.set(db.doc(`emailJobs/${emailJobId}`), {
            id: emailJobId,
            tenantId,
            projectId: project.id,
            contactId: contactIds[0] ?? null,
            recipient: recipientEmail,
            recipientName,
            projectName: text(project.get("name")) || null,
            type: "manual_message",
            customSubject: draft.subject,
            customBody: draft.body,
            actionLabel: null,
            actionUrl: null,
            category: "general",
            aiActionId: actionId,
            status: "queued",
            scheduledFor: null,
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          });
          const receiptId = `receipt_${actionId}`;
          batch.set(db.doc(`actionReceipts/${receiptId}`), {
            id: receiptId,
            tenantId,
            projectId: project.id,
            title: `Sent ${item.trigger.replaceAll("_", " ")}`,
            summary:
              "Deterministic lifecycle message sent under the studio's auto-send setting.",
            status: "completed",
            source: "lifecycle_scheduler",
            affectedEntityType: "aiAction",
            affectedEntityId: actionId,
            providerEvidence: { emailJobId },
            reversible: false,
            retryable: false,
            canCancel: false,
            canRetry: false,
            attempts: 1,
            createdAt: now,
            updatedAt: now,
            completedAt: now,
            createdBy: "lifecycle-message-scheduler",
            updatedBy: "lifecycle-message-scheduler",
            archivedAt: null,
          });
        }
        const event = productEvent({
          tenantId,
          projectId: project.id,
          actorId: "lifecycle-message-scheduler",
          actorType: "system",
          name: autoSend ? "ai_action.executed" : "ai_action.completed",
          occurredAt: now,
          correlationId: actionId,
          sourceEntityType: "aiAction",
          sourceEntityId: actionId,
          properties: {
            capability: "delivery_message_draft",
            trigger: item.trigger,
            deterministic: true,
            humanReviewRequired: !autoSend,
            autoSend,
          },
        });
        batch.set(db.doc(`productEvents/${event.id}`), event);
        await batch.commit();
      }
    }
  },
);
