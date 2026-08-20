import { randomUUID } from "node:crypto";
import {
  getFirestore,
  type DocumentSnapshot,
  type Query,
} from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
import { consumeAiQuota } from "../saas/usage.js";
import { productEvent } from "../operations/product-events.js";
import { deterministicIntakeExtraction } from "./intake-prefill.js";

type Json = Record<string, unknown>;

const requestSchema = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  question: z.string().trim().min(3).max(1200),
});

const intakeRequestSchema = z.object({
  kind: z.literal("project_intake"),
  tenantId: z.string().min(1),
  message: z.string().trim().min(10).max(8000),
});

const intakeExtractionSchema = z.object({
  firstName: z.string().max(80).nullable(),
  lastName: z.string().max(80).nullable(),
  partnerName: z.string().max(120).nullable(),
  email: z.string().max(160).nullable(),
  phone: z.string().max(40).nullable(),
  eventType: z.enum(["Wedding", "Corporate", "Sports"]).nullable(),
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  venueName: z.string().max(160).nullable(),
  city: z.string().max(120).nullable(),
  guestCount: z.number().int().min(1).max(100000).nullable(),
  summary: z.string().max(400).nullable(),
});

const responseSchema = z.object({
  answer: z.string().min(1),
  facts: z.array(z.string()).max(12),
  suggestions: z.array(z.string()).max(8),
  citations: z
    .array(
      z.object({
        label: z.string().min(1),
        href: z.string().startsWith("/studio/"),
      }),
    )
    .max(12),
});

const internalRoles = new Set([
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
  "staff_photographer",
]);

const asRecord = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};

async function cloudAccessToken() {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!response.ok) throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");
  const body = asRecord(await response.json());
  if (typeof body.access_token !== "string")
    throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");
  return body.access_token;
}

function compact(document: DocumentSnapshot): Json & { id: string } {
  const data = document.data() ?? {};
  const allowed = [
    "projectId",
    "name",
    "eventType",
    "eventDate",
    "state",
    "readinessScore",
    "nextAction",
    "venueName",
    "venueAddress",
    "status",
    "kind",
    "amountCents",
    "balanceCents",
    "dueDate",
    "completedAt",
    "role",
    "arrivalAt",
    "currentScheduleVersion",
    "acknowledgedScheduleVersion",
    "score",
    "ready",
    "blockingItems",
    "atRiskItems",
    "overdueItems",
    "recommendedNextAction",
    "title",
    "priority",
    "blocking",
    "version",
    "timezone",
    "items",
    "locations",
    "responsibilities",
    "discrepancies",
    "company",
    "contactName",
    "type",
    "planningPackage",
    "approvalState",
  ];
  return {
    id: document.id,
    ...Object.fromEntries(
      allowed
        .filter((key) => data[key] !== undefined)
        .map((key) => [key, data[key]]),
    ),
  };
}

async function scopedDocuments(
  collectionName: string,
  tenantId: string,
  projectIds: string[] | null,
) {
  const db = getFirestore();
  let collectionQuery: Query = db
    .collection(collectionName)
    .where("tenantId", "==", tenantId);
  if (projectIds) {
    if (!projectIds.length) return [];
    collectionQuery = collectionQuery.where(
      "projectId",
      "in",
      projectIds.slice(0, 30),
    );
  }
  const snapshot = await collectionQuery.limit(60).get();
  return snapshot.docs.map(compact);
}

async function generate(question: string, context: Json) {
  const project = process.env.VERTEX_AI_PROJECT_ID;
  const location = process.env.VERTEX_AI_LOCATION ?? "us-east4";
  const model = process.env.VERTEX_AI_COPILOT_MODEL;
  if (!project || !model) throw new Error("VERTEX_AI_COPILOT_NOT_CONFIGURED");
  const token = await cloudAccessToken();
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
                "You are StudioCue Event Copilot. Answer only from the supplied tenant-scoped facts. Never invent prices, payments, signatures, dates, statuses, people, or readiness. Clearly separate facts from suggestions. Do not claim to execute actions. Readiness, insurance approval, contract completion, payment status, and permissions are deterministic system facts and cannot be changed by you. Keep the answer concise and operational. Citations must use only href values present in the supplied citationCandidates.",
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: JSON.stringify({ question, context }),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              answer: { type: "STRING" },
              facts: { type: "ARRAY", items: { type: "STRING" } },
              suggestions: { type: "ARRAY", items: { type: "STRING" } },
              citations: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    label: { type: "STRING" },
                    href: { type: "STRING" },
                  },
                  required: ["label", "href"],
                },
              },
            },
            required: ["answer", "facts", "suggestions", "citations"],
          },
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`VERTEX_AI_COPILOT_FAILED:${response.status}`);
  const body = asRecord(await response.json());
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const content = asRecord(asRecord(candidates[0]).content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const output = asRecord(parts[0]).text;
  if (typeof output !== "string") throw new Error("VERTEX_AI_EMPTY_OUTPUT");
  return responseSchema.parse(JSON.parse(output));
}

/**
 * Project-intake extraction: turn a pasted client message into structured
 * form values. Advisory only — everything lands in editable fields the
 * studio confirms before anything is created. Mock mode and any Vertex
 * failure fall back to the deterministic regex extractor so the feature
 * degrades to "quick read" instead of dying.
 */
async function generateIntake(
  message: string,
): Promise<{
  extraction: z.infer<typeof intakeExtractionSchema>;
  mode: "ai" | "deterministic";
}> {
  const fallback = () => {
    const value = deterministicIntakeExtraction(message);
    return {
      extraction: intakeExtractionSchema.parse({
        ...value,
        guestCount: null,
        summary: null,
      }),
      mode: "deterministic" as const,
    };
  };
  if (process.env.PROVIDER_MOCK_MODE === "true") return fallback();
  const project = process.env.VERTEX_AI_PROJECT_ID;
  const location = process.env.VERTEX_AI_LOCATION ?? "us-east4";
  const model = process.env.VERTEX_AI_EXTRACTION_MODEL;
  if (!project || !model) return fallback();
  try {
    const token = await cloudAccessToken();
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
                text: "Extract booking-intake fields from a prospective photography client's message. Use null for anything not explicitly stated — never guess or invent names, dates, places, or contact details. eventDate must be YYYY-MM-DD. eventType is Wedding, Corporate, or Sports only when the message clearly implies it. summary is one neutral sentence describing what the client asked for, written from the studio's point of view. Return JSON only.",
              },
            ],
          },
          contents: [{ role: "user", parts: [{ text: message }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                firstName: { type: "STRING", nullable: true },
                lastName: { type: "STRING", nullable: true },
                partnerName: { type: "STRING", nullable: true },
                email: { type: "STRING", nullable: true },
                phone: { type: "STRING", nullable: true },
                eventType: {
                  type: "STRING",
                  nullable: true,
                  enum: ["Wedding", "Corporate", "Sports"],
                },
                eventDate: { type: "STRING", nullable: true },
                venueName: { type: "STRING", nullable: true },
                city: { type: "STRING", nullable: true },
                guestCount: { type: "NUMBER", nullable: true },
                summary: { type: "STRING", nullable: true },
              },
            },
          },
        }),
      },
    );
    if (!response.ok)
      throw new Error(`VERTEX_AI_FAILED:${response.status}`);
    const body = asRecord(await response.json());
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const content = asRecord(asRecord(candidates[0]).content);
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const output = asRecord(parts[0]).text;
    if (typeof output !== "string") throw new Error("VERTEX_AI_EMPTY_OUTPUT");
    const parsed = intakeExtractionSchema.safeParse(JSON.parse(output));
    if (!parsed.success) return fallback();
    return { extraction: parsed.data, mode: "ai" };
  } catch {
    // A model outage must never block creating a project by hand.
    return fallback();
  }
}

export const aiCopilotCommand = onRequest(
  { cors: studioHubCors, invoker: "private", timeoutSeconds: 60 },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);

      if (asRecord(request.body).kind === "project_intake") {
        const intake = intakeRequestSchema.parse(request.body);
        const db = getFirestore();
        const intakeMembership = await db
          .doc(`memberships/${intake.tenantId}_${identity.uid}`)
          .get();
        if (
          !intakeMembership.exists ||
          intakeMembership.get("status") !== "active" ||
          !internalRoles.has(String(intakeMembership.get("role")))
        )
          throw new Error("FORBIDDEN");
        const now = new Date().toISOString();
        await db.runTransaction((transaction) =>
          consumeAiQuota(transaction, db, intake.tenantId, now),
        );
        const { extraction, mode } = await generateIntake(intake.message);
        const interactionId = `ai_${randomUUID()}`;
        await db.doc(`aiInteractions/${interactionId}`).create({
          id: interactionId,
          tenantId: intake.tenantId,
          projectId: null,
          userId: identity.uid,
          type: "project_intake_extraction",
          // The message itself is client-provided prose; keep only its size.
          messageLength: intake.message.length,
          result: extraction,
          mode,
          model:
            mode === "ai" ? process.env.VERTEX_AI_EXTRACTION_MODEL : "deterministic",
          createdAt: now,
        });
        response.status(200).json({ extraction, mode, interactionId });
        return;
      }

      const input = requestSchema.parse(request.body);
      const db = getFirestore();
      const membership = await db
        .doc(`memberships/${input.tenantId}_${identity.uid}`)
        .get();
      if (
        !membership.exists ||
        membership.get("status") !== "active" ||
        !internalRoles.has(String(membership.get("role")))
      )
        throw new Error("FORBIDDEN");
      const role = String(membership.get("role"));
      const broadAccess = ["studio_owner", "studio_admin"].includes(role);
      const assigned = Array.isArray(membership.get("projectIds"))
        ? (membership.get("projectIds") as unknown[]).filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      if (input.projectId && !broadAccess && !assigned.includes(input.projectId))
        throw new Error("FORBIDDEN");
      const permittedProjectIds = input.projectId
        ? [input.projectId]
        : broadAccess
          ? null
          : assigned;
      const now = new Date().toISOString();
      await db.runTransaction((transaction) =>
        consumeAiQuota(transaction, db, input.tenantId, now),
      );
      const [
        projects,
        contracts,
        invoices,
        assignments,
        readiness,
        tasks,
        schedules,
        insurance,
        vendors,
        questionnaires,
      ] =
        await Promise.all([
          scopedDocuments("projects", input.tenantId, permittedProjectIds),
          scopedDocuments("contracts", input.tenantId, permittedProjectIds),
          scopedDocuments("invoiceReferences", input.tenantId, permittedProjectIds),
          scopedDocuments("crewAssignments", input.tenantId, permittedProjectIds),
          scopedDocuments("readinessAssessments", input.tenantId, permittedProjectIds),
          scopedDocuments("tasks", input.tenantId, permittedProjectIds),
          scopedDocuments("schedules", input.tenantId, permittedProjectIds),
          scopedDocuments("insuranceRequests", input.tenantId, permittedProjectIds),
          scopedDocuments("vendors", input.tenantId, permittedProjectIds),
          scopedDocuments("questionnaireResponses", input.tenantId, permittedProjectIds),
        ]);
      const citationCandidates = projects.map((project) => ({
        label: String(project.name ?? project.id),
        href: `/studio/projects/${String(project.id)}`,
      }));
      const result = await generate(input.question, {
        asOf: now,
        projects,
        contracts,
        invoices,
        crewAssignments: assignments,
        readiness,
        tasks,
        schedules,
        insurance,
        vendors,
        planningPackages: questionnaires
          .filter((item) => item.planningPackage)
          .map((item) => ({ id: item.id, projectId: item.projectId, planningPackage: item.planningPackage })),
        citationCandidates,
      });
      const allowedLinks = new Set(citationCandidates.map((item) => item.href));
      const safeResult = {
        ...result,
        citations: result.citations.filter((item) => allowedLinks.has(item.href)),
      };
      const interactionId = `ai_${randomUUID()}`;
      const batch = db.batch();
      batch.create(db.doc(`aiInteractions/${interactionId}`), {
        id: interactionId,
        tenantId: input.tenantId,
        projectId: input.projectId ?? null,
        userId: identity.uid,
        type: "copilot_question",
        question: input.question,
        result: safeResult,
        model: process.env.VERTEX_AI_COPILOT_MODEL,
        createdAt: now,
      });
      batch.create(db.doc(`auditEvents/${interactionId}`), {
        id: interactionId,
        tenantId: input.tenantId,
        projectId: input.projectId ?? null,
        actorId: identity.uid,
        actorType: "user",
        action: "ai.copilot_answered",
        entityType: "ai_interaction",
        entityId: interactionId,
        timestamp: now,
        before: null,
        after: {
          model: process.env.VERTEX_AI_COPILOT_MODEL,
          factCount: safeResult.facts.length,
          suggestionCount: safeResult.suggestions.length,
        },
        ipAddress: request.ip ?? null,
        userAgent: request.get("user-agent") ?? null,
        correlationId: request.get("x-correlation-id") ?? interactionId,
        automationRunId: null,
        providerEventId: null,
      });
      const preparedEvent = productEvent({
        tenantId: input.tenantId,
        projectId: input.projectId ?? null,
        actorId: identity.uid,
        name: "event_day.brief_prepared",
        occurredAt: now,
        correlationId: interactionId,
        sourceEntityType: "aiInteraction",
        sourceEntityId: interactionId,
        properties: {
          factCount: safeResult.facts.length,
          suggestionCount: safeResult.suggestions.length,
          proactive: input.question.includes("event-day brief"),
        },
      });
      batch.create(db.doc(`productEvents/${preparedEvent.id}`), preparedEvent);
      await batch.commit();
      response.status(200).json({ ...safeResult, interactionId, asOf: now });
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "AI_COPILOT_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message });
    }
  },
);
