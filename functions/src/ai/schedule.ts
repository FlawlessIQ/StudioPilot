import { createHash, randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
import { consumeAiQuota } from "../saas/usage.js";
import { productEvent } from "../operations/product-events.js";

type Json = Record<string, unknown>;
const record = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};

const inputSchema = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  coverageMinutes: z.number().int().positive().max(1440),
  photographerIds: z.array(z.string().min(1)).max(20),
  coverageStartsAt: z.string().datetime(),
  coverageEndsAt: z.string().datetime(),
  ceremonyTime: z.string().datetime().nullable(),
  receptionTime: z.string().datetime().nullable(),
  locations: z.array(
    z.object({
      name: z.string().min(1).max(160),
      address: z.string().max(300).nullable(),
    }),
  ),
  preferences: z.string().max(4000),
});

const draftItemSchema = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  title: z.string().min(1).max(160),
  description: z.string().max(1000),
  location: z.string().max(160).nullable(),
  address: z.string().max(300).nullable(),
  travelMinutes: z.number().int().nonnegative().max(600),
  photographerIds: z.array(z.string()),
  participants: z.array(z.string()),
  vendorContactIds: z.array(z.string()),
  equipment: z.array(z.string()),
  notes: z.string().max(1000).nullable(),
  visibility: z.enum(["studio", "client", "crew", "shared"]),
  blockingIssues: z.array(z.string()),
  sourceReferences: z
    .array(
      z.object({
        type: z.enum([
          "project_fact",
          "questionnaire_answer",
          "timing_rule",
          "package_fact",
          "crew_fact",
          "assumption",
        ]),
        sourceId: z.string().min(1),
        label: z.string().min(1),
      }),
    )
    .max(20),
});

const outputSchema = z.object({
  items: z.array(draftItemSchema).min(1).max(100),
  assumptions: z.array(z.string()).max(30),
  missingInformation: z.array(z.string()).max(30),
  conflicts: z.array(z.string()).max(30),
  risks: z.array(z.string()).max(30),
  suggestedQuestions: z.array(z.string()).max(30),
});

async function accessToken() {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!response.ok) throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");
  const body = record(await response.json());
  if (typeof body.access_token !== "string")
    throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");
  return body.access_token;
}

async function generate(input: z.infer<typeof inputSchema>, context: Json) {
  const project = process.env.VERTEX_AI_PROJECT_ID;
  const location = process.env.VERTEX_AI_LOCATION ?? "us-east4";
  const model = process.env.VERTEX_AI_SCHEDULE_MODEL;
  if (!project || !model) throw new Error("VERTEX_AI_SCHEDULE_NOT_CONFIGURED");
  const token = await accessToken();
  const response = await fetch(
    `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text:
                "Draft a photography run-of-show from only the supplied facts. Never invent a confirmed venue, person, vendor, travel time, approval, or provider status. Put unknowns in missingInformation and assumptions. Use ISO 8601 timestamps with offsets. All items must fit within coverage start and end unless a conflict is explicitly reported. Every item must cite at least one sourceReferences entry from a project_fact, questionnaire_answer, timing_rule, package_fact, or crew_fact. If no verified source supports an item, cite an assumption and label it plainly. This is an unapproved draft requiring human review.",
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify({ input, context }) }],
          },
        ],
        generationConfig: {
          temperature: 0.15,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              items: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    startAt: { type: "STRING" },
                    endAt: { type: "STRING" },
                    title: { type: "STRING" },
                    description: { type: "STRING" },
                    location: { type: "STRING", nullable: true },
                    address: { type: "STRING", nullable: true },
                    travelMinutes: { type: "INTEGER" },
                    photographerIds: { type: "ARRAY", items: { type: "STRING" } },
                    participants: { type: "ARRAY", items: { type: "STRING" } },
                    vendorContactIds: { type: "ARRAY", items: { type: "STRING" } },
                    equipment: { type: "ARRAY", items: { type: "STRING" } },
                    notes: { type: "STRING", nullable: true },
                    visibility: { type: "STRING", enum: ["studio", "client", "crew", "shared"] },
                    blockingIssues: { type: "ARRAY", items: { type: "STRING" } },
                    sourceReferences: {
                      type: "ARRAY",
                      items: {
                        type: "OBJECT",
                        properties: {
                          type: {
                            type: "STRING",
                            enum: [
                              "project_fact",
                              "questionnaire_answer",
                              "timing_rule",
                              "package_fact",
                              "crew_fact",
                              "assumption",
                            ],
                          },
                          sourceId: { type: "STRING" },
                          label: { type: "STRING" },
                        },
                        required: ["type", "sourceId", "label"],
                      },
                    },
                  },
                  required: [
                    "startAt",
                    "endAt",
                    "title",
                    "description",
                    "location",
                    "address",
                    "travelMinutes",
                    "photographerIds",
                    "participants",
                    "vendorContactIds",
                    "equipment",
                    "notes",
                    "visibility",
                    "blockingIssues",
                    "sourceReferences",
                  ],
                },
              },
              assumptions: { type: "ARRAY", items: { type: "STRING" } },
              missingInformation: { type: "ARRAY", items: { type: "STRING" } },
              conflicts: { type: "ARRAY", items: { type: "STRING" } },
              risks: { type: "ARRAY", items: { type: "STRING" } },
              suggestedQuestions: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: [
              "items",
              "assumptions",
              "missingInformation",
              "conflicts",
              "risks",
              "suggestedQuestions",
            ],
          },
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`VERTEX_AI_SCHEDULE_FAILED:${response.status}`);
  const body = record(await response.json());
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const parts = Array.isArray(record(record(candidates[0]).content).parts)
    ? (record(record(candidates[0]).content).parts as unknown[])
    : [];
  const text = record(parts[0]).text;
  if (typeof text !== "string") throw new Error("VERTEX_AI_EMPTY_OUTPUT");
  return outputSchema.parse(JSON.parse(text));
}

export const aiScheduleCommand = onRequest(
  { cors: studioHubCors, invoker: "private", timeoutSeconds: 60 },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      const input = inputSchema.parse(request.body);
      const db = getFirestore();
      const [membership, project] = await Promise.all([
        db.doc(`memberships/${input.tenantId}_${identity.uid}`).get(),
        db.doc(`projects/${input.projectId}`).get(),
      ]);
      const role = String(membership.get("role"));
      const assigned = Array.isArray(membership.get("projectIds"))
        ? (membership.get("projectIds") as unknown[]).includes(input.projectId)
        : false;
      if (
        !membership.exists ||
        membership.get("status") !== "active" ||
        !["studio_owner", "studio_admin", "studio_coordinator"].includes(role) ||
        (!["studio_owner", "studio_admin"].includes(role) && !assigned) ||
        !project.exists ||
        project.get("tenantId") !== input.tenantId
      )
        throw new Error("FORBIDDEN");
      if (
        Date.parse(input.coverageEndsAt) <= Date.parse(input.coverageStartsAt)
      )
        throw new Error("INVALID_COVERAGE_RANGE");
      const now = new Date().toISOString();
      await db.runTransaction((transaction) =>
        consumeAiQuota(transaction, db, input.tenantId, now),
      );
      const [questionnaires, timingRules, crewAssignments, packageSnapshot] =
        await Promise.all([
          db
            .collection("questionnaireResponses")
            .where("tenantId", "==", input.tenantId)
            .where("projectId", "==", input.projectId)
            .get(),
          db
            .collection("timingRules")
            .where("tenantId", "==", input.tenantId)
            .get(),
          db
            .collection("crewAssignments")
            .where("tenantId", "==", input.tenantId)
            .where("projectId", "==", input.projectId)
            .get(),
          typeof project.get("packageSnapshotId") === "string"
            ? db
                .doc(
                  `packageSnapshots/${String(project.get("packageSnapshotId"))}`,
                )
                .get()
            : Promise.resolve(null),
        ]);
      const questionnaireFacts = questionnaires.docs
        .filter((item) =>
          ["submitted", "locked"].includes(String(item.get("status"))),
        )
        .map((item) => ({
          sourceId: item.id,
          templateName: item.get("templateName"),
          answers: item.get("answers"),
          answerProvenance: item.get("answerProvenance"),
        }));
      const approvedTimingRules = timingRules.docs
        .filter(
          (item) =>
            item.get("active") === true &&
            String(item.get("eventTypeId")).toLowerCase() ===
              String(
                project.get("eventTypeId") ??
                  project.get("eventType") ??
                  "wedding",
              ).toLowerCase(),
        )
        .map((item) => ({
          sourceId: item.id,
          name: item.get("name"),
          anchor: item.get("anchor"),
          offsetMinutes: item.get("offsetMinutes"),
          durationMinutes: item.get("durationMinutes"),
          bufferBeforeMinutes: item.get("bufferBeforeMinutes"),
          bufferAfterMinutes: item.get("bufferAfterMinutes"),
          version: item.get("version"),
        }));
      const result = await generate(input, {
        project: {
          id: project.id,
          name: project.get("name"),
          eventType: project.get("eventType"),
          eventDate: project.get("eventDate"),
          timezone: project.get("timezone"),
          venueName: project.get("venueName"),
          city: project.get("city"),
        },
        questionnaireFacts,
        approvedTimingRules,
        packageFact:
          packageSnapshot?.exists
            ? {
                sourceId: packageSnapshot.id,
                packageName: packageSnapshot.get("packageName"),
                coverageMinutes:
                  packageSnapshot.get("includedCoverageMinutes") ??
                  packageSnapshot.get("coverageMinutes"),
                addOns:
                  packageSnapshot.get("addOns") ??
                  packageSnapshot.get("selectedAddOns"),
              }
            : null,
        crewFacts: crewAssignments.docs
          .filter((item) => item.get("status") === "accepted")
          .map((item) => ({
            sourceId: item.id,
            role: item.get("role"),
            crewProfileId: item.get("crewProfileId"),
          })),
      });
      const start = Date.parse(input.coverageStartsAt);
      const end = Date.parse(input.coverageEndsAt);
      const normalized = result.items
        .map((item, index) => ({
          ...item,
          id: `draft_${index + 1}`,
          sourceReferences: item.sourceReferences.length
            ? item.sourceReferences
            : [
                {
                  type: "assumption" as const,
                  sourceId: `assumption_draft_${index + 1}`,
                  label: "AI draft assumption requiring human review",
                },
              ],
        }))
        .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
      const deterministicConflicts = normalized.flatMap((item, index) => {
        const issues: string[] = [];
        const itemStart = Date.parse(item.startAt);
        const itemEnd = Date.parse(item.endAt);
        if (itemEnd <= itemStart) issues.push(`${item.title}: end must be after start.`);
        if (itemStart < start || itemEnd > end)
          issues.push(`${item.title}: outside the configured coverage window.`);
        const previous = normalized[index - 1];
        if (previous && Date.parse(previous.endAt) > itemStart)
          issues.push(`${previous.title} overlaps ${item.title}.`);
        return issues;
      });
      const interactionId = `ai_schedule_${randomUUID()}`;
      const output = {
        ...result,
        items: normalized,
        conflicts: Array.from(
          new Set([...result.conflicts, ...deterministicConflicts]),
        ),
        sourceTrace: {
          questionnaireCount: questionnaireFacts.length,
          timingRuleCount: approvedTimingRules.length,
          crewFactCount: crewAssignments.docs.filter(
            (item) => item.get("status") === "accepted",
          ).length,
          assumptionItemCount: normalized.filter((item) =>
            item.sourceReferences.some(
              (source) => source.type === "assumption",
            ),
          ).length,
        },
        draft: true,
        humanReviewRequired: true,
        interactionId,
      };
      const batch = db.batch();
      const safeInputSummary = {
        coverageMinutes: input.coverageMinutes,
        coverageStartsAt: input.coverageStartsAt,
        coverageEndsAt: input.coverageEndsAt,
        hasCeremonyTime: Boolean(input.ceremonyTime),
        hasReceptionTime: Boolean(input.receptionTime),
        photographerCount: input.photographerIds.length,
        locationCount: input.locations.length,
        hasPreferences: input.preferences.trim().length > 0,
        preferencesSha256: input.preferences.trim()
          ? createHash("sha256").update(input.preferences).digest("hex")
          : null,
      };
      batch.create(db.doc(`aiInteractions/${interactionId}`), {
        id: interactionId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        userId: identity.uid,
        type: "schedule_draft",
        inputSummary: safeInputSummary,
        sourceReferences: {
          projectId: input.projectId,
          questionnaireIds: questionnaireFacts.map((item) => item.sourceId),
          timingRuleIds: approvedTimingRules.map((item) => item.sourceId),
          packageSnapshotId: packageSnapshot?.exists
            ? packageSnapshot.id
            : null,
          crewAssignmentIds: crewAssignments.docs
            .filter((item) => item.get("status") === "accepted")
            .map((item) => item.id),
        },
        resultSummary: {
          itemCount: normalized.length,
          assumptionCount: result.assumptions.length,
          missingInformationCount: result.missingInformation.length,
          conflictCount: output.conflicts.length,
          riskCount: result.risks.length,
          sourceTrace: output.sourceTrace,
          humanReviewRequired: true,
        },
        model: process.env.VERTEX_AI_SCHEDULE_MODEL,
        createdAt: now,
      });
      batch.create(db.doc(`auditEvents/${interactionId}`), {
        id: interactionId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: identity.uid,
        actorType: "user",
        action: "ai.schedule_drafted",
        entityType: "ai_interaction",
        entityId: interactionId,
        timestamp: now,
        before: null,
        after: {
          itemCount: normalized.length,
          conflictCount: output.conflicts.length,
          humanReviewRequired: true,
        },
        ipAddress: request.ip ?? null,
        userAgent: request.get("user-agent") ?? null,
        correlationId: interactionId,
        automationRunId: null,
        providerEventId: null,
      });
      const event = productEvent({
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: identity.uid,
        name: "ai_action.completed",
        occurredAt: now,
        correlationId: interactionId,
        sourceEntityType: "aiInteraction",
        sourceEntityId: interactionId,
        properties: {
          capability: "schedule_draft",
          itemCount: normalized.length,
          sourceTrace: output.sourceTrace,
          humanReviewRequired: true,
        },
      });
      batch.create(db.doc(`productEvents/${event.id}`), event);
      await batch.commit();
      response.status(200).json(output);
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "AI_SCHEDULE_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message });
    }
  },
);
