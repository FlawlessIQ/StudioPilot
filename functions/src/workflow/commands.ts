import { randomUUID } from "node:crypto";
import type {
  DocumentData,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

type CheckpointStatus =
  | "not_started"
  | "ready"
  | "in_progress"
  | "waiting_on_client"
  | "waiting_on_vendor"
  | "waiting_on_subcontractor"
  | "under_review"
  | "complete"
  | "waived"
  | "failed";

const dueDateRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("absolute"), date: z.string().date() }),
  z.object({
    type: z.literal("relative"),
    anchor: z.enum([
      "event_date",
      "project_created",
      "booking_date",
      "workflow_started",
    ]),
    offsetDays: z.number().int().min(-3650).max(3650),
  }),
]);

const checkpointTemplateSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000),
  category: z.string().trim().min(2).max(80),
  ownerType: z.enum(["studio", "client", "vendor", "subcontractor", "system"]),
  assignedUserId: z.string().nullable(),
  assignedContactId: z.string().nullable(),
  dueDateRule: dueDateRuleSchema,
  visibility: z.enum(["studio", "client", "crew", "shared"]),
  blocking: z.boolean(),
  dependencies: z.array(z.string().regex(/^[a-z0-9-]+$/)),
  completionMethod: z.enum([
    "manual",
    "form_submitted",
    "file_uploaded",
    "contract_completed",
    "invoice_paid",
    "schedule_approved",
    "assignment_accepted",
    "webhook_event",
    "system_rule",
  ]),
  requiredEvidence: z.array(z.string().min(1).max(120)),
  reminderRules: z.array(
    z.object({
      daysBeforeDue: z.number().int().nonnegative().max(365),
      channel: z.enum(["email", "sms", "internal"]),
      recipient: z.enum([
        "studio",
        "client",
        "vendor",
        "subcontractor",
        "system",
      ]),
    }),
  ),
  escalationRules: z.array(
    z.object({
      daysOverdue: z.number().int().nonnegative().max(365),
      notifyRole: z.enum([
        "studio_owner",
        "studio_admin",
        "studio_coordinator",
      ]),
    }),
  ),
  waiverAllowed: z.boolean(),
});

const automationRuleSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(160),
  trigger: z.string().min(2).max(120),
  conditions: z.array(
    z.object({
      field: z.string().min(1),
      operator: z.string().min(1),
      value: z.unknown(),
    }),
  ),
  actions: z
    .array(
      z.object({
        key: z.string().min(1),
        type: z.string().min(1),
        configuration: z.record(z.string(), z.unknown()),
        requiresApproval: z.boolean(),
      }),
    )
    .min(1),
  active: z.boolean(),
});

const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("createWorkflowTemplate"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      name: z.string().trim().min(2).max(160),
      description: z.string().trim().min(10).max(3000),
      eventTypeId: z.string().min(1),
      eventTypeLabel: z.string().min(2).max(80),
      status: z.enum(["draft", "active"]),
      checkpointTemplates: z.array(checkpointTemplateSchema).min(1),
      automationRules: z.array(automationRuleSchema),
    }),
  }),
  z.object({
    type: z.literal("instantiateWorkflow"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      workflowTemplateId: z.string().min(1),
      bookingDate: z.string().date().nullable(),
    }),
  }),
  z.object({
    type: z.literal("resolveCheckpoint"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      checkpointId: z.string().min(1),
      resolution: z.enum(["complete", "waived"]),
      reason: z.string().trim().max(2000).nullable(),
      waiverExpiresAt: z.string().datetime().nullable(),
      evidence: z.array(
        z.object({
          type: z.enum([
            "document",
            "form",
            "provider_event",
            "manual_note",
            "system_rule",
          ]),
          referenceId: z.string().min(1),
          label: z.string().min(1).max(160),
        }),
      ),
      notes: z.string().max(5000).nullable(),
    }),
  }),
  z.object({
    type: z.literal("createTask"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      projectId: z.string().min(1),
      workflowRunId: z.string().nullable(),
      checkpointId: z.string().nullable(),
      title: z.string().trim().min(2).max(200),
      description: z.string().trim().max(3000),
      assignedUserId: z.string().nullable(),
      assignedRole: z.string().nullable(),
      dueDate: z.string().date().nullable(),
      priority: z.enum(["low", "normal", "high", "urgent"]),
      blocking: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal("completeTask"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({ taskId: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("recalculateReadiness"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({ projectId: z.string().min(1) }),
  }),
]);

type Membership = {
  role: string;
  status: string;
  projectIds?: string[];
};

type CheckpointDocument = {
  id: string;
  tenantId: string;
  projectId: string;
  workflowRunId: string;
  templateKey: string;
  name: string;
  ownerType: string;
  dueDateRule: z.infer<typeof dueDateRuleSchema>;
  resolvedDueDate: string | null;
  blocking: boolean;
  dependencyIds: string[];
  requiredEvidence: string[];
  waiverAllowed: boolean;
  status: CheckpointStatus;
  waiverExpiresAt: string | null;
  [key: string]: unknown;
};

type ReadinessProjection = {
  score: number;
  ready: boolean;
  totalRequired: number;
  satisfiedRequired: number;
  blockingItems: Array<Record<string, unknown>>;
  atRiskItems: Array<Record<string, unknown>>;
  overdueItems: Array<Record<string, unknown>>;
  recommendedNextAction: string;
};

const managerRoles = ["studio_owner", "studio_admin"];
const operatorRoles = [...managerRoles, "studio_coordinator"];

function hasProjectAccess(membership: Membership, projectId: string): boolean {
  return (
    managerRoles.includes(membership.role) ||
    membership.projectIds?.includes(projectId) === true
  );
}

function addUtcDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) throw new Error("INVALID_DATE_ANCHOR");
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function resolveDueDate(
  rule: z.infer<typeof dueDateRuleSchema>,
  anchors: {
    eventDate: string;
    projectCreated: string;
    bookingDate: string | null;
    workflowStarted: string;
  },
): string | null {
  if (rule.type === "none") return null;
  if (rule.type === "absolute") return rule.date;
  const anchor = {
    event_date: anchors.eventDate,
    project_created: anchors.projectCreated,
    booking_date: anchors.bookingDate,
    workflow_started: anchors.workflowStarted,
  }[rule.anchor];
  if (!anchor) throw new Error("MISSING_DATE_ANCHOR");
  return addUtcDays(anchor, rule.offsetDays);
}

function checkpointSatisfied(
  checkpoint: CheckpointDocument,
  timestamp: string,
): boolean {
  if (checkpoint.status === "complete") return true;
  return (
    checkpoint.status === "waived" &&
    (!checkpoint.waiverExpiresAt || checkpoint.waiverExpiresAt > timestamp)
  );
}

function readinessItem(
  checkpoint: CheckpointDocument,
  reason: string,
): Record<string, unknown> {
  return {
    checkpointId: checkpoint.id,
    name: checkpoint.name,
    status: checkpoint.status,
    ownerType: checkpoint.ownerType,
    dueDate: checkpoint.resolvedDueDate,
    reason,
  };
}

function calculateReadiness(
  checkpoints: readonly CheckpointDocument[],
  timestamp: string,
): ReadinessProjection {
  const today = timestamp.slice(0, 10);
  const riskThrough = addUtcDays(today, 7);
  const required = checkpoints.filter((checkpoint) => checkpoint.blocking);
  const satisfied = required.filter((checkpoint) =>
    checkpointSatisfied(checkpoint, timestamp),
  );
  const blockingItems = required
    .filter((checkpoint) => !checkpointSatisfied(checkpoint, timestamp))
    .map((checkpoint) =>
      readinessItem(
        checkpoint,
        checkpoint.status === "waived"
          ? "Waiver expired"
          : checkpoint.status === "failed"
            ? "Required checkpoint failed"
            : "Required checkpoint is incomplete",
      ),
    );
  const overdueItems = checkpoints
    .filter(
      (checkpoint) =>
        !checkpointSatisfied(checkpoint, timestamp) &&
        checkpoint.resolvedDueDate !== null &&
        checkpoint.resolvedDueDate < today,
    )
    .map((checkpoint) =>
      readinessItem(checkpoint, "Past its resolved due date"),
    );
  const atRiskItems = checkpoints
    .filter(
      (checkpoint) =>
        !checkpointSatisfied(checkpoint, timestamp) &&
        checkpoint.resolvedDueDate !== null &&
        checkpoint.resolvedDueDate >= today &&
        checkpoint.resolvedDueDate <= riskThrough,
    )
    .map((checkpoint) => readinessItem(checkpoint, "Due within seven days"));
  const primary = overdueItems[0] ?? blockingItems[0] ?? atRiskItems[0];
  return {
    score:
      required.length === 0
        ? 0
        : Math.round((satisfied.length / required.length) * 100),
    ready: required.length > 0 && blockingItems.length === 0,
    totalRequired: required.length,
    satisfiedRequired: satisfied.length,
    blockingItems,
    atRiskItems,
    overdueItems,
    recommendedNextAction: required.length === 0
      ? "Set up required readiness checkpoints"
      : primary
      ? `${String(primary.name)} · ${String(primary.ownerType)}`
      : "No readiness blockers",
  };
}

function auditDocument(input: {
  id: string;
  tenantId: string;
  projectId?: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  timestamp: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  correlationId: string;
  userAgent: string | null;
}): Record<string, unknown> {
  return {
    ...input,
    actorType: "user",
    ipAddress: null,
    userAgent: input.userAgent,
    automationRunId: null,
    providerEventId: null,
  };
}

function writeExecution(
  transaction: Transaction,
  reference: FirebaseFirestore.DocumentReference<DocumentData>,
  tenantId: string,
  idempotencyKey: string,
  result: Record<string, unknown>,
  timestamp: string,
): void {
  transaction.create(reference, {
    tenantId,
    idempotencyKey,
    result,
    createdAt: timestamp,
  });
}

async function writeReadiness(
  transaction: Transaction,
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    workflowRunId: string | null;
    checkpoints: readonly CheckpointDocument[];
    timestamp: string;
    actorId: string;
  },
): Promise<ReadinessProjection> {
  const projection = calculateReadiness(input.checkpoints, input.timestamp);
  transaction.set(db.doc(`readinessAssessments/${input.projectId}`), {
    id: input.projectId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    workflowRunId: input.workflowRunId,
    ...projection,
    calculatedAt: input.timestamp,
    rulesVersion: 1,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    createdBy: input.actorId,
    updatedBy: input.actorId,
    archivedAt: null,
  });
  transaction.update(db.doc(`projects/${input.projectId}`), {
    readinessScore: projection.score,
    nextAction: projection.recommendedNextAction,
    updatedAt: input.timestamp,
    updatedBy: input.actorId,
  });
  return projection;
}

export const workflowCommand = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }

    let identity;
    try {
      await requireAppCheck(request);
      identity = await requireIdentity(request);
    } catch {
      response.status(401).json({ error: "AUTHENTICATION_REQUIRED" });
      return;
    }

    const parsed = commandSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: "INVALID_COMMAND",
        fields: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
      return;
    }
    const command = parsed.data;
    const db = getFirestore();
    const membershipSnapshot = await db
      .doc(`memberships/${command.tenantId}_${identity.uid}`)
      .get();
    const membership = membershipSnapshot.data() as Membership | undefined;
    if (
      !membership ||
      membership.status !== "active" ||
      !operatorRoles.includes(membership.role)
    ) {
      response.status(403).json({ error: "FORBIDDEN" });
      return;
    }
    if (
      command.type === "createWorkflowTemplate" &&
      !managerRoles.includes(membership.role)
    ) {
      response.status(403).json({ error: "FORBIDDEN" });
      return;
    }
    if (
      command.type === "resolveCheckpoint" &&
      command.input.resolution === "waived" &&
      membership.role !== "studio_owner"
    ) {
      response.status(403).json({ error: "WAIVER_PERMISSION_REQUIRED" });
      return;
    }

    const executionReference = db.doc(
      `commandExecutions/workflow_${command.tenantId}_${command.idempotencyKey}`,
    );
    const prior = await executionReference.get();
    if (prior.exists) {
      response.status(200).json(prior.data()?.result);
      return;
    }

    const timestamp = new Date().toISOString();
    const correlationId = request.header("x-correlation-id") ?? randomUUID();
    const userAgent = request.header("user-agent") ?? null;

    try {
      const result = await db.runTransaction(async (transaction) => {
        const execution = await transaction.get(executionReference);
        if (execution.exists) {
          return execution.data()?.result as Record<string, unknown>;
        }

        if (command.type === "createWorkflowTemplate") {
          /**
           * Version by name; supersede by event type.
           *
           * These were both keyed on name, and booking-time selection is
           * keyed on eventTypeId — so two differently-named active
           * templates for the same event type both stayed active, tied on
           * version, and the one that actually ran was whichever Firestore
           * happened to return first. Silently, and differently on
           * different days.
           *
           * The version counter stays per-name so a template's own history
           * reads as v1, v2, v3. Supersession moves to event type, because
           * "the workflow for weddings" is what the runtime resolves and
           * there can only usefully be one.
           */
          const [versions, activeForEventType] = await Promise.all([
            transaction.get(
              db
                .collection("workflowTemplates")
                .where("tenantId", "==", command.tenantId)
                .where("name", "==", command.input.name)
                .orderBy("version", "desc")
                .limit(20),
            ),
            transaction.get(
              db
                .collection("workflowTemplates")
                .where("tenantId", "==", command.tenantId)
                .where("eventTypeId", "==", command.input.eventTypeId)
                .where("status", "==", "active")
                .limit(20),
            ),
          ]);
          const version =
            ((versions.docs[0]?.data().version as number | undefined) ?? 0) + 1;
          if (command.input.status === "active") {
            // The two queries overlap whenever the new version shares its
            // name with the outgoing one, which is the common case.
            const superseded = new Set<string>();
            for (const document of [
              ...versions.docs,
              ...activeForEventType.docs,
            ]) {
              if (document.data().status !== "active") continue;
              if (superseded.has(document.ref.path)) continue;
              superseded.add(document.ref.path);
              transaction.update(document.ref, {
                status: "superseded",
                updatedAt: timestamp,
                updatedBy: identity.uid,
              });
            }
          }
          const templateId = randomUUID();
          transaction.create(db.doc(`workflowTemplates/${templateId}`), {
            id: templateId,
            tenantId: command.tenantId,
            ...command.input,
            version,
            immutable: command.input.status === "active",
            publishedAt: command.input.status === "active" ? timestamp : null,
            publishedBy:
              command.input.status === "active" ? identity.uid : null,
            createdAt: timestamp,
            updatedAt: timestamp,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          });
          const auditId = randomUUID();
          transaction.create(
            db.doc(`auditEvents/${auditId}`),
            auditDocument({
              id: auditId,
              tenantId: command.tenantId,
              actorId: identity.uid,
              action: "workflow_template.created",
              entityType: "workflowTemplate",
              entityId: templateId,
              timestamp,
              before: null,
              after: {
                version,
                status: command.input.status,
                checkpointCount: command.input.checkpointTemplates.length,
              },
              correlationId,
              userAgent,
            }),
          );
          const output = { workflowTemplateId: templateId, version };
          writeExecution(
            transaction,
            executionReference,
            command.tenantId,
            command.idempotencyKey,
            output,
            timestamp,
          );
          return output;
        }

        if (command.type === "instantiateWorkflow") {
          if (!hasProjectAccess(membership, command.input.projectId)) {
            throw new Error("PROJECT_ACCESS_DENIED");
          }
          const projectReference = db.doc(
            `projects/${command.input.projectId}`,
          );
          const templateReference = db.doc(
            `workflowTemplates/${command.input.workflowTemplateId}`,
          );
          const [projectSnapshot, templateSnapshot, activeRuns] =
            await Promise.all([
              transaction.get(projectReference),
              transaction.get(templateReference),
              transaction.get(
                db
                  .collection("workflowRuns")
                  .where("tenantId", "==", command.tenantId)
                  .where("projectId", "==", command.input.projectId)
                  .where("status", "==", "active")
                  .limit(1),
              ),
            ]);
          const project = projectSnapshot.data() as
            | {
                tenantId: string;
                eventTypeId: string;
                eventDate: string;
                createdAt: string;
                state: string;
              }
            | undefined;
          const template = templateSnapshot.data() as
            | {
                id: string;
                tenantId: string;
                name: string;
                description: string;
                eventTypeId: string;
                eventTypeLabel: string;
                version: number;
                status: string;
                checkpointTemplates: z.infer<typeof checkpointTemplateSchema>[];
                automationRules: z.infer<typeof automationRuleSchema>[];
              }
            | undefined;
          if (!project || project.tenantId !== command.tenantId) {
            throw new Error("PROJECT_NOT_FOUND");
          }
          if (
            !template ||
            template.tenantId !== command.tenantId ||
            template.status !== "active"
          ) {
            throw new Error("WORKFLOW_TEMPLATE_NOT_FOUND");
          }
          if (template.eventTypeId !== project.eventTypeId) {
            throw new Error("EVENT_TYPE_MISMATCH");
          }
          const activeRun = activeRuns.docs[0];
          if (activeRun) {
            const output = {
              workflowRunId: activeRun.id,
              existing: true,
            };
            writeExecution(
              transaction,
              executionReference,
              command.tenantId,
              command.idempotencyKey,
              output,
              timestamp,
            );
            return output;
          }

          const runId = randomUUID();
          const checkpointIds = new Map(
            template.checkpointTemplates.map((checkpoint) => [
              checkpoint.key,
              randomUUID(),
            ]),
          );
          const checkpointDocuments: CheckpointDocument[] =
            template.checkpointTemplates.map((definition) => {
              const checkpointId = checkpointIds.get(definition.key);
              if (!checkpointId) throw new Error("CHECKPOINT_ID_FAILED");
              const dependencyIds = definition.dependencies.map((key) => {
                const dependencyId = checkpointIds.get(key);
                if (!dependencyId)
                  throw new Error("INVALID_CHECKPOINT_DEPENDENCY");
                return dependencyId;
              });
              return {
                id: checkpointId,
                tenantId: command.tenantId,
                projectId: command.input.projectId,
                workflowRunId: runId,
                templateKey: definition.key,
                name: definition.name,
                description: definition.description,
                category: definition.category,
                ownerType: definition.ownerType,
                assignedUserId: definition.assignedUserId,
                assignedContactId: definition.assignedContactId,
                dueDateRule: definition.dueDateRule,
                resolvedDueDate: resolveDueDate(definition.dueDateRule, {
                  eventDate: project.eventDate,
                  projectCreated: project.createdAt.slice(0, 10),
                  bookingDate: command.input.bookingDate,
                  workflowStarted: timestamp.slice(0, 10),
                }),
                visibility: definition.visibility,
                blocking: definition.blocking,
                dependencyIds,
                completionMethod: definition.completionMethod,
                requiredEvidence: definition.requiredEvidence,
                reminderRules: definition.reminderRules,
                escalationRules: definition.escalationRules,
                waiverAllowed: definition.waiverAllowed,
                status: dependencyIds.length === 0 ? "ready" : "not_started",
                completionTimestamp: null,
                completionActorId: null,
                evidence: [],
                notes: null,
                waiverReason: null,
                waiverExpiresAt: null,
                createdAt: timestamp,
                updatedAt: timestamp,
                createdBy: identity.uid,
                updatedBy: identity.uid,
                archivedAt: null,
              };
            });
          transaction.create(db.doc(`workflowRuns/${runId}`), {
            id: runId,
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            workflowTemplateId: command.input.workflowTemplateId,
            workflowVersion: template.version,
            status: "active",
            inputSnapshot: {
              eventDate: project.eventDate,
              eventTypeId: project.eventTypeId,
              projectState: project.state,
              bookingDate: command.input.bookingDate,
            },
            templateSnapshot: {
              name: template.name,
              description: template.description,
              eventTypeId: template.eventTypeId,
              eventTypeLabel: template.eventTypeLabel,
              version: template.version,
              checkpointTemplates: template.checkpointTemplates,
              automationRules: template.automationRules,
            },
            checkpointIds: checkpointDocuments.map(
              (checkpoint) => checkpoint.id,
            ),
            startedAt: timestamp,
            completedAt: null,
            failureReason: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          });
          for (const checkpoint of checkpointDocuments) {
            transaction.create(
              db.doc(`checkpoints/${checkpoint.id}`),
              checkpoint,
            );
          }
          const projection = await writeReadiness(transaction, db, {
            tenantId: command.tenantId,
            projectId: command.input.projectId,
            workflowRunId: runId,
            checkpoints: checkpointDocuments,
            timestamp,
            actorId: identity.uid,
          });
          const auditId = randomUUID();
          transaction.create(
            db.doc(`auditEvents/${auditId}`),
            auditDocument({
              id: auditId,
              tenantId: command.tenantId,
              projectId: command.input.projectId,
              actorId: identity.uid,
              action: "workflow.instantiated",
              entityType: "workflowRun",
              entityId: runId,
              timestamp,
              before: null,
              after: {
                workflowVersion: template.version,
                checkpointCount: checkpointDocuments.length,
                readinessScore: projection.score,
              },
              correlationId,
              userAgent,
            }),
          );
          const output = {
            workflowRunId: runId,
            checkpointCount: checkpointDocuments.length,
            readinessScore: projection.score,
            existing: false,
          };
          writeExecution(
            transaction,
            executionReference,
            command.tenantId,
            command.idempotencyKey,
            output,
            timestamp,
          );
          return output;
        }

        if (command.type === "resolveCheckpoint") {
          const checkpointReference = db.doc(
            `checkpoints/${command.input.checkpointId}`,
          );
          const checkpointSnapshot = await transaction.get(checkpointReference);
          const checkpoint = checkpointSnapshot.data() as
            | CheckpointDocument
            | undefined;
          if (!checkpoint || checkpoint.tenantId !== command.tenantId) {
            throw new Error("CHECKPOINT_NOT_FOUND");
          }
          if (!hasProjectAccess(membership, checkpoint.projectId)) {
            throw new Error("PROJECT_ACCESS_DENIED");
          }
          if (
            command.input.resolution === "waived" &&
            (!checkpoint.waiverAllowed ||
              (command.input.reason?.length ?? 0) < 10)
          ) {
            throw new Error("INVALID_WAIVER");
          }
          if (
            command.input.resolution === "complete" &&
            checkpoint.requiredEvidence.length > 0 &&
            command.input.evidence.length === 0
          ) {
            throw new Error("EVIDENCE_REQUIRED");
          }
          const checkpointsQuery = db
            .collection("checkpoints")
            .where("tenantId", "==", command.tenantId)
            .where("projectId", "==", checkpoint.projectId)
            .where("archivedAt", "==", null);
          const checkpointsSnapshot = await transaction.get(checkpointsQuery);
          const allCheckpoints = checkpointsSnapshot.docs.map(
            (document) =>
              ({
                id: document.id,
                ...document.data(),
              }) as CheckpointDocument,
          );
          const dependencies = checkpoint.dependencyIds.map((id) =>
            allCheckpoints.find((candidate) => candidate.id === id),
          );
          if (
            command.input.resolution === "complete" &&
            dependencies.some(
              (dependency) =>
                !dependency || !checkpointSatisfied(dependency, timestamp),
            )
          ) {
            throw new Error("DEPENDENCIES_INCOMPLETE");
          }

          const resolved: CheckpointDocument = {
            ...checkpoint,
            status: command.input.resolution,
            completionTimestamp: timestamp,
            completionActorId: identity.uid,
            evidence: command.input.evidence.map((evidence) => ({
              ...evidence,
              recordedAt: timestamp,
              recordedBy: identity.uid,
            })),
            notes: command.input.notes,
            waiverReason:
              command.input.resolution === "waived"
                ? command.input.reason
                : null,
            waiverExpiresAt:
              command.input.resolution === "waived"
                ? command.input.waiverExpiresAt
                : null,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          };
          const projected = allCheckpoints.map((candidate) =>
            candidate.id === checkpoint.id ? resolved : candidate,
          );
          const satisfiedIds = new Set(
            projected
              .filter((candidate) => checkpointSatisfied(candidate, timestamp))
              .map((candidate) => candidate.id),
          );
          const unlocked = projected.map((candidate) => {
            if (
              candidate.status === "not_started" &&
              candidate.dependencyIds.every((id) => satisfiedIds.has(id))
            ) {
              return {
                ...candidate,
                status: "ready" as const,
                updatedAt: timestamp,
                updatedBy: identity.uid,
              };
            }
            return candidate;
          });
          for (const candidate of unlocked) {
            const original = allCheckpoints.find(
              (item) => item.id === candidate.id,
            );
            if (
              candidate.id === checkpoint.id ||
              original?.status !== candidate.status
            ) {
              transaction.set(db.doc(`checkpoints/${candidate.id}`), candidate);
            }
          }
          const projection = await writeReadiness(transaction, db, {
            tenantId: command.tenantId,
            projectId: checkpoint.projectId,
            workflowRunId: checkpoint.workflowRunId,
            checkpoints: unlocked,
            timestamp,
            actorId: identity.uid,
          });
          const auditId = randomUUID();
          transaction.create(
            db.doc(`auditEvents/${auditId}`),
            auditDocument({
              id: auditId,
              tenantId: command.tenantId,
              projectId: checkpoint.projectId,
              actorId: identity.uid,
              action:
                command.input.resolution === "waived"
                  ? "checkpoint.waived"
                  : "checkpoint.completed",
              entityType: "checkpoint",
              entityId: checkpoint.id,
              timestamp,
              before: { status: checkpoint.status },
              after: {
                status: command.input.resolution,
                readinessScore: projection.score,
                reason: command.input.reason,
              },
              correlationId,
              userAgent,
            }),
          );
          const output = {
            checkpointId: checkpoint.id,
            status: command.input.resolution,
            readinessScore: projection.score,
            ready: projection.ready,
          };
          writeExecution(
            transaction,
            executionReference,
            command.tenantId,
            command.idempotencyKey,
            output,
            timestamp,
          );
          return output;
        }

        if (command.type === "createTask") {
          if (!hasProjectAccess(membership, command.input.projectId)) {
            throw new Error("PROJECT_ACCESS_DENIED");
          }
          const project = await transaction.get(
            db.doc(`projects/${command.input.projectId}`),
          );
          if (
            !project.exists ||
            project.data()?.tenantId !== command.tenantId
          ) {
            throw new Error("PROJECT_NOT_FOUND");
          }
          const taskId = randomUUID();
          transaction.create(db.doc(`tasks/${taskId}`), {
            id: taskId,
            tenantId: command.tenantId,
            ...command.input,
            status: "not_started",
            completedAt: null,
            completedBy: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          });
          const output = { taskId, status: "not_started" };
          writeExecution(
            transaction,
            executionReference,
            command.tenantId,
            command.idempotencyKey,
            output,
            timestamp,
          );
          return output;
        }

        if (command.type === "completeTask") {
          const taskReference = db.doc(`tasks/${command.input.taskId}`);
          const taskSnapshot = await transaction.get(taskReference);
          const task = taskSnapshot.data() as
            | { tenantId: string; projectId: string; status: string }
            | undefined;
          if (!task || task.tenantId !== command.tenantId) {
            throw new Error("TASK_NOT_FOUND");
          }
          if (!hasProjectAccess(membership, task.projectId)) {
            throw new Error("PROJECT_ACCESS_DENIED");
          }
          transaction.update(taskReference, {
            status: "complete",
            completedAt: timestamp,
            completedBy: identity.uid,
            updatedAt: timestamp,
            updatedBy: identity.uid,
          });
          const output = { taskId: command.input.taskId, status: "complete" };
          writeExecution(
            transaction,
            executionReference,
            command.tenantId,
            command.idempotencyKey,
            output,
            timestamp,
          );
          return output;
        }

        const projectId = command.input.projectId;
        if (!hasProjectAccess(membership, projectId)) {
          throw new Error("PROJECT_ACCESS_DENIED");
        }
        const projectSnapshot = await transaction.get(
          db.doc(`projects/${projectId}`),
        );
        if (
          !projectSnapshot.exists ||
          projectSnapshot.data()?.tenantId !== command.tenantId
        ) {
          throw new Error("PROJECT_NOT_FOUND");
        }
        const checkpointsSnapshot = await transaction.get(
          db
            .collection("checkpoints")
            .where("tenantId", "==", command.tenantId)
            .where("projectId", "==", projectId)
            .where("archivedAt", "==", null),
        );
        const checkpoints = checkpointsSnapshot.docs.map(
          (document) =>
            ({
              id: document.id,
              ...document.data(),
            }) as CheckpointDocument,
        );
        const workflowRunId = checkpoints[0]?.workflowRunId ?? null;
        const projection = await writeReadiness(transaction, db, {
          tenantId: command.tenantId,
          projectId,
          workflowRunId,
          checkpoints,
          timestamp,
          actorId: identity.uid,
        });
        const output = {
          projectId,
          readinessScore: projection.score,
          ready: projection.ready,
          blockingCount: projection.blockingItems.length,
        };
        writeExecution(
          transaction,
          executionReference,
          command.tenantId,
          command.idempotencyKey,
          output,
          timestamp,
        );
        return output;
      });
      response.status(200).json(result);
    } catch (caught: unknown) {
      const code =
        caught instanceof Error ? caught.message : "WORKFLOW_COMMAND_FAILED";
      const status = code.endsWith("_NOT_FOUND")
        ? 404
        : code.includes("ACCESS") || code.includes("PERMISSION")
          ? 403
          : code === "EVIDENCE_REQUIRED" || code === "INVALID_WAIVER"
            ? 422
            : 409;
      response.status(status).json({ error: code });
    }
  },
);

/**
 * Booking-time workflow start.
 *
 * The booking gate's promise — "confirmed booking idempotently creates the
 * workflow run, dated tasks, and checkpoints" — had no caller: the
 * instantiateWorkflow command existed but nothing invoked it, so readiness
 * never engaged for real projects. This runs from the booking side-effects
 * job with the same construction as the command, minus end-user identity.
 *
 * Idempotent: an existing active run short-circuits, and the transaction
 * re-checks before writing. Missing template or event date skips quietly —
 * booking completion must never fail because planning isn't configured.
 */
export async function autoInstantiateWorkflow(input: {
  tenantId: string;
  projectId: string;
  actorId: string;
}): Promise<
  | {
      workflowRunId: string;
      checkpointCount: number;
      readinessScore: number;
      existing: boolean;
    }
  | {
      skipped:
        | "project_not_found"
        | "no_event_date"
        | "no_active_template"
        | "template_invalid";
    }
> {
  const db = getFirestore();
  const timestamp = new Date().toISOString();
  const activeRunQuery = db
    .collection("workflowRuns")
    .where("tenantId", "==", input.tenantId)
    .where("projectId", "==", input.projectId)
    .where("status", "==", "active")
    .limit(1);
  const [projectSnapshot, templates, activeRuns] = await Promise.all([
    db.doc(`projects/${input.projectId}`).get(),
    db
      .collection("workflowTemplates")
      .where("tenantId", "==", input.tenantId)
      .where("status", "==", "active")
      .limit(50)
      .get(),
    activeRunQuery.get(),
  ]);
  const project = projectSnapshot.data() as
    | {
        tenantId: string;
        eventTypeId: string;
        eventDate: string;
        createdAt: string;
        state: string;
      }
    | undefined;
  if (!project || project.tenantId !== input.tenantId)
    return { skipped: "project_not_found" };
  if (!project.eventDate) return { skipped: "no_event_date" };
  const existingRun = activeRuns.docs[0];
  if (existingRun) {
    const checkpointIds = existingRun.get("checkpointIds");
    return {
      workflowRunId: existingRun.id,
      checkpointCount: Array.isArray(checkpointIds) ? checkpointIds.length : 0,
      readinessScore: 0,
      existing: true,
    };
  }
  const templateSnapshot = templates.docs
    .filter((candidate) => candidate.get("eventTypeId") === project.eventTypeId)
    .sort(
      (left, right) =>
        Number(right.get("version") ?? 0) - Number(left.get("version") ?? 0),
    )[0];
  if (!templateSnapshot) return { skipped: "no_active_template" };
  const parsedTemplates = z
    .array(checkpointTemplateSchema)
    .safeParse(templateSnapshot.get("checkpointTemplates"));
  if (!parsedTemplates.success) return { skipped: "template_invalid" };
  const template = {
    name: String(templateSnapshot.get("name") ?? ""),
    description: String(templateSnapshot.get("description") ?? ""),
    eventTypeId: String(templateSnapshot.get("eventTypeId") ?? ""),
    eventTypeLabel: String(templateSnapshot.get("eventTypeLabel") ?? ""),
    version: Number(templateSnapshot.get("version") ?? 1),
    checkpointTemplates: parsedTemplates.data,
    automationRules: templateSnapshot.get("automationRules") ?? [],
  };
  const bookingDate = timestamp.slice(0, 10);

  return db.runTransaction(async (transaction) => {
    const again = await transaction.get(activeRunQuery);
    const alreadyRunning = again.docs[0];
    if (alreadyRunning) {
      const checkpointIds = alreadyRunning.get("checkpointIds");
      return {
        workflowRunId: alreadyRunning.id,
        checkpointCount: Array.isArray(checkpointIds)
          ? checkpointIds.length
          : 0,
        readinessScore: 0,
        existing: true,
      };
    }
    const runId = randomUUID();
    const checkpointIds = new Map(
      template.checkpointTemplates.map((checkpoint) => [
        checkpoint.key,
        randomUUID(),
      ]),
    );
    const checkpointDocuments: CheckpointDocument[] =
      template.checkpointTemplates.map((definition) => {
        const checkpointId = checkpointIds.get(definition.key);
        if (!checkpointId) throw new Error("CHECKPOINT_ID_FAILED");
        const dependencyIds = definition.dependencies.map((key) => {
          const dependencyId = checkpointIds.get(key);
          if (!dependencyId) throw new Error("INVALID_CHECKPOINT_DEPENDENCY");
          return dependencyId;
        });
        return {
          id: checkpointId,
          tenantId: input.tenantId,
          projectId: input.projectId,
          workflowRunId: runId,
          templateKey: definition.key,
          name: definition.name,
          description: definition.description,
          category: definition.category,
          ownerType: definition.ownerType,
          assignedUserId: definition.assignedUserId,
          assignedContactId: definition.assignedContactId,
          dueDateRule: definition.dueDateRule,
          resolvedDueDate: resolveDueDate(definition.dueDateRule, {
            eventDate: project.eventDate,
            projectCreated: String(project.createdAt ?? timestamp).slice(0, 10),
            bookingDate,
            workflowStarted: timestamp.slice(0, 10),
          }),
          visibility: definition.visibility,
          blocking: definition.blocking,
          dependencyIds,
          completionMethod: definition.completionMethod,
          requiredEvidence: definition.requiredEvidence,
          reminderRules: definition.reminderRules,
          escalationRules: definition.escalationRules,
          waiverAllowed: definition.waiverAllowed,
          status: dependencyIds.length === 0 ? "ready" : "not_started",
          completionTimestamp: null,
          completionActorId: null,
          evidence: [],
          notes: null,
          waiverReason: null,
          waiverExpiresAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          createdBy: input.actorId,
          updatedBy: input.actorId,
          archivedAt: null,
        };
      });
    transaction.create(db.doc(`workflowRuns/${runId}`), {
      id: runId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      workflowTemplateId: templateSnapshot.id,
      workflowVersion: template.version,
      status: "active",
      inputSnapshot: {
        eventDate: project.eventDate,
        eventTypeId: project.eventTypeId,
        projectState: project.state,
        bookingDate,
      },
      templateSnapshot: {
        name: template.name,
        description: template.description,
        eventTypeId: template.eventTypeId,
        eventTypeLabel: template.eventTypeLabel,
        version: template.version,
        checkpointTemplates: template.checkpointTemplates,
        automationRules: template.automationRules,
      },
      checkpointIds: checkpointDocuments.map((checkpoint) => checkpoint.id),
      startedAt: timestamp,
      completedAt: null,
      failureReason: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      archivedAt: null,
    });
    for (const checkpoint of checkpointDocuments) {
      transaction.create(db.doc(`checkpoints/${checkpoint.id}`), checkpoint);
    }
    const projection = await writeReadiness(transaction, db, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      workflowRunId: runId,
      checkpoints: checkpointDocuments,
      timestamp,
      actorId: input.actorId,
    });
    const auditId = randomUUID();
    transaction.create(
      db.doc(`auditEvents/${auditId}`),
      auditDocument({
        id: auditId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: "workflow.instantiated",
        entityType: "workflowRun",
        entityId: runId,
        timestamp,
        before: null,
        after: {
          workflowVersion: template.version,
          checkpointCount: checkpointDocuments.length,
          readinessScore: projection.score,
          trigger: "booking_completed",
        },
        correlationId: `booking_workflow_${input.projectId}`,
        userAgent: null,
      }),
    );
    return {
      workflowRunId: runId,
      checkpointCount: checkpointDocuments.length,
      readinessScore: projection.score,
      existing: false,
    };
  });
}
