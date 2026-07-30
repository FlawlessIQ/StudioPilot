import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import {
  onDocumentCreated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { z } from "zod";
import { photographerRelativeDateMilestone } from "./relative-date.js";

const domainEventTopic = "studiocue-domain-events";

const triggerSchema = z.enum([
  "lead_created",
  "consultation_scheduled",
  "consultation_completed",
  "package_selected",
  "proposal_sent",
  "proposal_accepted",
  "contract_sent",
  "contract_completed",
  "invoice_created",
  "invoice_paid",
  "form_submitted",
  "document_uploaded",
  "coi_received",
  "coi_approved",
  "schedule_approved",
  "crew_assignment_accepted",
  "relative_date_reached",
  "project_status_changed",
  "delivery_completed",
  "review_request_sent",
]);

type Trigger = z.infer<typeof triggerSchema>;
type Value = FirebaseFirestore.DocumentData;

const watchedCollections = new Set([
  "leads",
  "consultations",
  "packageSnapshots",
  "proposals",
  "contracts",
  "invoiceReferences",
  "questionnaireResponses",
  "documents",
  "insuranceRequests",
  "schedules",
  "crewAssignments",
  "projects",
  "deliveryRecords",
  "reviewRequests",
]);

function stable(...parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function changed(
  before: Value | undefined,
  after: Value,
  field: string,
  value: string,
): boolean {
  return before?.[field] !== value && after[field] === value;
}

function triggerFor(
  collectionId: string,
  before: Value | undefined,
  after: Value,
): Trigger | null {
  if (collectionId === "leads" && !before) return "lead_created";
  if (collectionId === "consultations") {
    if (!before) return "consultation_scheduled";
    if (changed(before, after, "status", "completed")) {
      return "consultation_completed";
    }
  }
  if (collectionId === "packageSnapshots" && !before) return "package_selected";
  if (collectionId === "proposals") {
    if (changed(before, after, "status", "sent")) return "proposal_sent";
    if (changed(before, after, "status", "accepted")) return "proposal_accepted";
  }
  if (collectionId === "contracts") {
    if (changed(before, after, "status", "sent")) return "contract_sent";
    if (changed(before, after, "status", "completed")) {
      return "contract_completed";
    }
  }
  if (collectionId === "invoiceReferences") {
    if (!before) return "invoice_created";
    if (changed(before, after, "status", "paid")) return "invoice_paid";
  }
  if (
    collectionId === "questionnaireResponses" &&
    changed(before, after, "status", "submitted")
  ) {
    return "form_submitted";
  }
  if (collectionId === "documents" && !before) return "document_uploaded";
  if (collectionId === "insuranceRequests") {
    if (changed(before, after, "status", "received")) return "coi_received";
    if (changed(before, after, "status", "approved")) return "coi_approved";
  }
  if (
    collectionId === "schedules" &&
    changed(before, after, "status", "approved")
  ) {
    return "schedule_approved";
  }
  if (
    collectionId === "crewAssignments" &&
    changed(before, after, "status", "accepted")
  ) {
    return "crew_assignment_accepted";
  }
  if (collectionId === "projects" && before?.state !== after.state) {
    return "project_status_changed";
  }
  if (
    collectionId === "deliveryRecords" &&
    (!before || changed(before, after, "status", "delivery_sent"))
  ) {
    return "delivery_completed";
  }
  if (
    collectionId === "reviewRequests" &&
    changed(before, after, "status", "sent")
  ) {
    return "review_request_sent";
  }
  return null;
}

function matches(
  payload: Readonly<Record<string, unknown>>,
  condition: Value,
): boolean {
  const actual = payload[String(condition.field)];
  const expected = condition.value;
  switch (condition.operator) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "equals":
      return actual === expected;
    case "not_equals":
      return actual !== expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "not_in":
      return Array.isArray(expected) && !expected.includes(actual);
    case "greater_than":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        actual > expected
      );
    case "less_than":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        actual < expected
      );
    default:
      return false;
  }
}

function actionNeedsApproval(action: Value): boolean {
  return (
    action.requiresApproval === true ||
    [
      "send_sms",
      "create_invoice",
      "create_docusign_envelope",
      "update_project_status",
    ].includes(String(action.type))
  );
}

async function executeRun(runReference: FirebaseFirestore.DocumentReference) {
  const db = getFirestore();
  const runSnapshot = await runReference.get();
  if (!runSnapshot.exists) return;
  const run = runSnapshot.data() ?? {};
  if (!["queued", "retry_scheduled"].includes(String(run.status))) return;

  const actions = Array.isArray(run.actions) ? run.actions : [];
  const now = new Date().toISOString();
  await runReference.update({
    status: "running",
    attemptCount: Number(run.attemptCount ?? 0) + 1,
    startedAt: run.startedAt ?? now,
    updatedAt: now,
  });

  try {
    const result: Record<string, unknown> = {};
    for (const rawAction of actions) {
      const action = z.record(z.string(), z.unknown()).parse(rawAction);
      const actionKey = String(action.key);
      const actionType = String(action.type);
      const artifactId = stable(runReference.id, actionKey);
      if (actionNeedsApproval(action)) {
        await db.doc(`automationApprovals/${artifactId}`).set(
          {
            id: artifactId,
            tenantId: run.tenantId,
            projectId: run.projectId ?? null,
            automationRunId: runReference.id,
            actionKey,
            actionType,
            configuration: action.configuration ?? {},
            status: "pending",
            requestedAt: now,
            requestedBy: "automation-engine",
            decidedAt: null,
            decidedBy: null,
            decisionReason: null,
            createdAt: now,
            updatedAt: now,
          },
          { merge: false },
        );
        result[actionKey] = { status: "approval_required", id: artifactId };
        continue;
      }

      if (actionType === "create_task" || actionType === "assign_task") {
        const configuration = z
          .record(z.string(), z.unknown())
          .parse(action.configuration ?? {});
        await db.doc(`tasks/${artifactId}`).set(
          {
            id: artifactId,
            tenantId: run.tenantId,
            projectId: run.projectId ?? null,
            title: text(configuration.title) ?? "Automation follow-up",
            description: text(configuration.description) ?? "",
            assignedUserId: text(configuration.assignedUserId),
            assignedRole: text(configuration.assignedRole) ?? "studio_admin",
            dueDate: text(configuration.dueDate),
            status: "not_started",
            priority: text(configuration.priority) ?? "normal",
            source: "automation",
            automationRunId: runReference.id,
            createdAt: now,
            updatedAt: now,
            createdBy: "automation-engine",
            updatedBy: "automation-engine",
            archivedAt: null,
          },
          { merge: false },
        );
        result[actionKey] = { status: "created", taskId: artifactId };
        continue;
      }

      if (actionType === "send_internal_alert") {
        const configuration = z
          .record(z.string(), z.unknown())
          .parse(action.configuration ?? {});
        await db.doc(`notifications/${artifactId}`).set(
          {
            id: artifactId,
            tenantId: run.tenantId,
            projectId: run.projectId ?? null,
            type: "automation_alert",
            title: text(configuration.title) ?? "Workflow needs attention",
            body: text(configuration.body) ?? "Open the project to review.",
            readAt: null,
            createdAt: now,
            createdBy: "automation-engine",
          },
          { merge: false },
        );
        result[actionKey] = { status: "created", notificationId: artifactId };
        continue;
      }

      if (actionType === "send_email") {
        const configuration = z
          .record(z.string(), z.unknown())
          .parse(action.configuration ?? {});
        const templateKey =
          text(configuration.templateKey) ?? text(configuration.template);
        if (!templateKey || !run.projectId) {
          throw new Error("EMAIL_TEMPLATE_AND_PROJECT_REQUIRED");
        }
        const configuredValues = z
          .record(z.string(), z.unknown())
          .safeParse(configuration.values);
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app";
        await db.doc(`emailJobs/${artifactId}`).set(
          {
            id: artifactId,
            tenantId: run.tenantId,
            projectId: run.projectId,
            type: templateKey,
            values: {
              ...(configuredValues.success ? configuredValues.data : {}),
              portalUrl: `${appUrl}/client`,
              scheduleUrl: `${appUrl}/client/schedule`,
            },
            automationRunId: runReference.id,
            status: "queued",
            attempts: 0,
            maxAttempts: 5,
            createdAt: now,
            updatedAt: now,
          },
          { merge: false },
        );
        result[actionKey] = { status: "queued", emailJobId: artifactId };
        continue;
      }

      if (actionType === "complete_checkpoint") {
        const configuration = z
          .record(z.string(), z.unknown())
          .parse(action.configuration ?? {});
        const templateKey = text(configuration.templateKey);
        if (!templateKey || !run.projectId) {
          throw new Error("CHECKPOINT_TEMPLATE_KEY_REQUIRED");
        }
        const checkpoints = await db
          .collection("checkpoints")
          .where("tenantId", "==", run.tenantId)
          .where("projectId", "==", run.projectId)
          .where("templateKey", "==", templateKey)
          .limit(1)
          .get();
        const checkpoint = checkpoints.docs[0];
        if (!checkpoint) throw new Error("CHECKPOINT_NOT_FOUND");
        await checkpoint.ref.update({
          status: "complete",
          completionTimestamp: now,
          completionActorId: "automation-engine",
          evidence: [
            {
              type: "domain_event",
              referenceId: String(run.idempotencyKey),
              recordedAt: now,
            },
          ],
          updatedAt: now,
          updatedBy: "automation-engine",
        });
        result[actionKey] = {
          status: "completed",
          checkpointId: checkpoint.id,
        };
        continue;
      }

      await db.doc(`providerJobs/${artifactId}`).set(
        {
          id: artifactId,
          tenantId: run.tenantId,
          projectId: run.projectId ?? null,
          type: `automation_${actionType}`,
          configuration: action.configuration ?? {},
          idempotencyKey: artifactId,
          automationRunId: runReference.id,
          status: "queued",
          attempts: 0,
          maxAttempts: 5,
          createdAt: now,
          updatedAt: now,
        },
        { merge: false },
      );
      result[actionKey] = { status: "queued", jobId: artifactId };
    }

    const completedAt = new Date().toISOString();
    await runReference.update({
      status: "succeeded",
      result,
      error: null,
      completedAt,
      updatedAt: completedAt,
    });
  } catch (caught: unknown) {
    const attemptCount = Number(run.attemptCount ?? 0) + 1;
    const maxAttempts = Number(run.maxAttempts ?? 5);
    const delayMinutes = Math.min(60, 2 ** Math.max(0, attemptCount - 1));
    const next = new Date(Date.now() + delayMinutes * 60_000).toISOString();
    const failedAt = new Date().toISOString();
    await runReference.update({
      status: attemptCount >= maxAttempts ? "dead_letter" : "retry_scheduled",
      error: {
        code: "AUTOMATION_ACTION_FAILED",
        message:
          caught instanceof Error ? caught.message : "Automation action failed.",
        retryable: attemptCount < maxAttempts,
      },
      nextAttemptAt: attemptCount >= maxAttempts ? null : next,
      completedAt: attemptCount >= maxAttempts ? failedAt : null,
      updatedAt: failedAt,
    });
  }
}

export const normalizeDomainEvent = onDocumentWritten(
  {
    document: "{collectionId}/{documentId}",
    retry: false,
  },
  async (event) => {
    const collectionId = event.params.collectionId;
    if (!watchedCollections.has(collectionId)) return;
    const afterSnapshot = event.data?.after;
    if (!afterSnapshot?.exists) return;
    const after = afterSnapshot.data();
    if (!after) return;
    const beforeSnapshot = event.data?.before;
    const before = beforeSnapshot?.exists ? beforeSnapshot.data() : undefined;
    const trigger = triggerFor(collectionId, before, after);
    if (!trigger) return;

    const tenantId = text(after.tenantId);
    if (!tenantId) return;
    const projectId =
      text(after.projectId) ??
      (collectionId === "projects" ? event.params.documentId : null);
    const occurredAt =
      text(after.updatedAt) ?? text(after.createdAt) ?? new Date().toISOString();
    const eventId = stable(
      collectionId,
      event.params.documentId,
      trigger,
      occurredAt,
    );
    const payload = {
      ...after,
      entityId: event.params.documentId,
      collectionId,
      state: after.state ?? after.status ?? null,
      previousState: before?.state ?? before?.status ?? null,
    };
    await getFirestore().doc(`domainEvents/${eventId}`).set(
      {
        id: eventId,
        tenantId,
        projectId,
        type: trigger,
        occurredAt,
        source: collectionId,
        correlationId: eventId,
        payload,
        processingStatus: "pending",
        createdAt: new Date().toISOString(),
      },
      { merge: false },
    );
  },
);

async function publishDomainEvent(eventId: string): Promise<string> {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? "";
  if (!projectId) throw new Error("GOOGLE_CLOUD_PROJECT_REQUIRED");
  const identityResponse = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!identityResponse.ok) throw new Error("PUBSUB_IDENTITY_UNAVAILABLE");
  const identity = z
    .object({ access_token: z.string().min(1) })
    .parse(await identityResponse.json());
  const response = await fetch(
    `https://pubsub.googleapis.com/v1/projects/${encodeURIComponent(
      projectId,
    )}/topics/${domainEventTopic}:publish`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${identity.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            data: Buffer.from(JSON.stringify({ eventId })).toString("base64"),
            attributes: {
              source: "studiocue-domain-outbox",
              schemaVersion: "1",
            },
          },
        ],
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`DOMAIN_EVENT_PUBLISH_FAILED:${response.status}`);
  }
  const result = z
    .object({ messageIds: z.array(z.string()).min(1) })
    .parse(await response.json());
  const messageId = result.messageIds[0];
  if (!messageId) throw new Error("DOMAIN_EVENT_MESSAGE_ID_MISSING");
  await getFirestore().doc(`domainEvents/${eventId}`).set(
    {
      processingStatus: "published",
      pubsubMessageId: messageId,
      publishedAt: new Date().toISOString(),
      publishError: null,
    },
    { merge: true },
  );
  return messageId;
}

export const processDomainEvent = onDocumentCreated(
  {
    document: "domainEvents/{eventId}",
    retry: true,
  },
  async (event) => {
    if (!event.data) return;
    try {
      await publishDomainEvent(event.params.eventId);
    } catch (caught: unknown) {
      await event.data.ref.set(
        {
          processingStatus: "publish_retry",
          publishError:
            caught instanceof Error
              ? caught.message.slice(0, 500)
              : "DOMAIN_EVENT_PUBLISH_FAILED",
          publishFailedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      throw caught;
    }
  },
);

async function processDomainEventRecord(eventId: string) {
    const eventSnapshot = await getFirestore()
      .doc(`domainEvents/${eventId}`)
      .get();
    if (!eventSnapshot.exists) return;
    const domainEvent = eventSnapshot.data();
    if (!domainEvent || domainEvent.processingStatus === "processed") return;
    const trigger = triggerSchema.safeParse(domainEvent.type);
    if (!trigger.success) {
      await eventSnapshot.ref.update({ processingStatus: "ignored" });
      return;
    }
    const tenantId = text(domainEvent.tenantId);
    const projectId = text(domainEvent.projectId);
    if (!tenantId || !projectId) {
      await eventSnapshot.ref.update({ processingStatus: "no_project" });
      return;
    }

    const db = getFirestore();
    const runs = await db
      .collection("workflowRuns")
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId)
      .where("status", "==", "active")
      .limit(10)
      .get();
    let matched = 0;
    for (const workflowRun of runs.docs) {
      const workflow = workflowRun.data();
      const snapshot = z
        .record(z.string(), z.unknown())
        .safeParse(workflow.templateSnapshot);
      if (!snapshot.success) continue;
      const rules = Array.isArray(snapshot.data.automationRules)
        ? snapshot.data.automationRules
        : [];
      for (const rawRule of rules) {
        const rule = z.record(z.string(), z.unknown()).safeParse(rawRule);
        if (
          !rule.success ||
          rule.data.active !== true ||
          rule.data.trigger !== trigger.data
        ) {
          continue;
        }
        const conditions = Array.isArray(rule.data.conditions)
          ? rule.data.conditions
          : [];
        const payload = z
          .record(z.string(), z.unknown())
          .parse(domainEvent.payload ?? {});
        if (
          !conditions.every((condition) =>
            matches(
              payload,
              z.record(z.string(), z.unknown()).parse(condition),
            ),
          )
        ) {
          continue;
        }
        const ruleKey = text(rule.data.key);
        const actions = Array.isArray(rule.data.actions)
          ? rule.data.actions
          : [];
        if (!ruleKey || actions.length === 0) continue;
        const runId = stable(eventId, workflowRun.id, ruleKey);
        const reference = db.doc(`automationRuns/${runId}`);
        const now = new Date().toISOString();
        try {
          await reference.create({
            id: runId,
            tenantId,
            projectId,
            workflowRunId: workflowRun.id,
            workflowVersion: Number(workflow.workflowVersion ?? 1),
            automationRuleKey: ruleKey,
            trigger: trigger.data,
            idempotencyKey: `${eventId}:${workflowRun.id}:${ruleKey}`,
            inputSnapshot: payload,
            actionTypes: actions.map((action) =>
              String(
                z.record(z.string(), z.unknown()).parse(action).type,
              ),
            ),
            actions,
            attemptCount: 0,
            maxAttempts: 5,
            status: "queued",
            result: null,
            error: null,
            nextAttemptAt: null,
            startedAt: null,
            completedAt: null,
            manualRerunOfId: null,
            createdAt: now,
            updatedAt: now,
            createdBy: "automation-engine",
            updatedBy: "automation-engine",
            archivedAt: null,
          });
        } catch (caught: unknown) {
          if (
            !(caught instanceof Error) ||
            !caught.message.toLowerCase().includes("already exists")
          ) {
            throw caught;
          }
        }
        await executeRun(reference);
        matched += 1;
      }
    }
    await eventSnapshot.ref.update({
      processingStatus: "processed",
      matchedRuleCount: matched,
      processedAt: new Date().toISOString(),
    });
}

export const consumeDomainEvent = onMessagePublished(
  {
    topic: domainEventTopic,
    retry: true,
  },
  async (event) => {
    const payload = z
      .object({ eventId: z.string().min(1).max(300) })
      .parse(event.data.message.json);
    await processDomainEventRecord(payload.eventId);
  },
);

export const domainEventOutboxScheduler = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "UTC",
    retryCount: 3,
  },
  async () => {
    const pending = await getFirestore()
      .collection("domainEvents")
      .where("processingStatus", "in", ["pending", "publish_retry"])
      .limit(100)
      .get();
    for (const event of pending.docs) {
      await publishDomainEvent(event.id);
    }
  },
);

export const automationRetryScheduler = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "UTC",
    retryCount: 3,
  },
  async () => {
    const now = new Date().toISOString();
    const retryable = await getFirestore()
      .collection("automationRuns")
      .where("status", "==", "retry_scheduled")
      .where("nextAttemptAt", "<=", now)
      .limit(100)
      .get();
    for (const run of retryable.docs) await executeRun(run.ref);
  },
);

export async function createRelativeDateDomainEvents(now = new Date()) {
  const db = getFirestore();
  const projects = await db
    .collection("projects")
    .where("state", "in", ["BOOKED", "PLANNING", "READY"])
    .limit(500)
    .get();
  let created = 0;
  for (const project of projects.docs) {
    const eventDate = text(project.get("eventDate"));
    const tenantId = text(project.get("tenantId"));
    if (!eventDate || !tenantId) continue;
    const timeZone = text(project.get("timezone")) ?? "UTC";
    const milestone = photographerRelativeDateMilestone({
      eventDate,
      now,
      timeZone,
    });
    if (!milestone) continue;
    const eventId = stable(
      "relative-date",
      project.id,
      eventDate,
      milestone.key,
    );
    try {
      await db.doc(`domainEvents/${eventId}`).create({
        id: eventId,
        tenantId,
        projectId: project.id,
        type: "relative_date_reached",
        occurredAt: now.toISOString(),
        source: "relative-date-scheduler",
        correlationId: eventId,
        payload: {
          entityId: project.id,
          collectionId: "projects",
          eventDate,
          eventType: String(
            project.get("eventTypeId") ?? project.get("eventType") ?? "",
          ).toLowerCase(),
          daysBeforeEvent: milestone.daysBeforeEvent,
          relativeDateKey: milestone.key,
        },
        processingStatus: "pending",
        createdAt: now.toISOString(),
      });
      created += 1;
    } catch (caught: unknown) {
      if (
        !(caught instanceof Error) ||
        !caught.message.toLowerCase().includes("already exists")
      ) {
        throw caught;
      }
    }
  }
  return { scanned: projects.size, created };
}

export const relativeDateScheduler = onSchedule(
  {
    schedule: "every 1 hours",
    timeZone: "UTC",
    retryCount: 3,
  },
  async () => {
    await createRelativeDateDomainEvents();
  },
);
