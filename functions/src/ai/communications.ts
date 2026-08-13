import { randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
import { consumeAiQuota } from "../saas/usage.js";
import { productEvent } from "../operations/product-events.js";

type Json = Record<string, unknown>;

const requestSchema = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  contactId: z.string().min(1),
  instruction: z.string().trim().min(3).max(2_000),
  category: z.enum(["general", "financial", "contract", "insurance"]),
  currentSubject: z.string().trim().max(180).nullable().optional(),
  currentBody: z.string().trim().max(8_000).nullable().optional(),
});

const resultSchema = z.object({
  subject: z.string().trim().min(2).max(180),
  body: z.string().trim().min(2).max(8_000),
  factsUsed: z.array(z.string()).max(10),
  needsConfirmation: z.array(z.string()).max(8),
});

const allowedRoles = new Set([
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
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

async function generateCommunication(input: {
  instruction: string;
  category: string;
  currentSubject?: string | null;
  currentBody?: string | null;
  context: Json;
}) {
  const project = process.env.VERTEX_AI_PROJECT_ID;
  const location = process.env.VERTEX_AI_LOCATION ?? "us-east4";
  const model =
    process.env.VERTEX_AI_COMMUNICATIONS_MODEL ??
    process.env.VERTEX_AI_COPILOT_MODEL;
  if (!project || !model) throw new Error("VERTEX_AI_COMMUNICATIONS_NOT_CONFIGURED");
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
                "You are StudioCue's client email assistant for a professional photography studio. Draft or revise the email requested by the user using only supplied tenant-scoped facts. Preserve accurate dates, amounts, people, links, and statuses. Never claim a contract is signed, payment received, insurance approved, staff confirmed, or delivery completed unless the supplied facts explicitly say so. Put any uncertain claim in needsConfirmation instead of the email. The body is plain text with short paragraphs, warm and direct, without a sign-off placeholder unless requested. Do not send anything.",
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify(input) }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              subject: { type: "STRING" },
              body: { type: "STRING" },
              factsUsed: { type: "ARRAY", items: { type: "STRING" } },
              needsConfirmation: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["subject", "body", "factsUsed", "needsConfirmation"],
          },
        },
      }),
    },
  );
  if (!response.ok)
    throw new Error(`VERTEX_AI_COMMUNICATIONS_FAILED:${response.status}`);
  const body = asRecord(await response.json());
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const content = asRecord(asRecord(candidates[0]).content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const output = asRecord(parts[0]).text;
  if (typeof output !== "string") throw new Error("VERTEX_AI_EMPTY_OUTPUT");
  return resultSchema.parse(JSON.parse(output));
}

export const aiCommunicationsCommand = onRequest(
  { cors: studioHubCors, invoker: "private", timeoutSeconds: 60 },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      const input = requestSchema.parse(request.body);
      const db = getFirestore();
      const [membership, project, contact] = await Promise.all([
        db.doc(`memberships/${input.tenantId}_${identity.uid}`).get(),
        db.doc(`projects/${input.projectId}`).get(),
        db.doc(`contacts/${input.contactId}`).get(),
      ]);
      const role = String(membership.get("role") ?? "");
      if (
        !membership.exists ||
        membership.get("status") !== "active" ||
        !allowedRoles.has(role)
      )
        throw new Error("FORBIDDEN");
      if (
        !project.exists ||
        project.get("tenantId") !== input.tenantId ||
        !contact.exists ||
        contact.get("tenantId") !== input.tenantId ||
        !Array.isArray(project.get("clientContactIds")) ||
        !(project.get("clientContactIds") as unknown[]).includes(contact.id)
      )
        throw new Error("PROJECT_CONTACT_REQUIRED");
      if (
        role === "studio_coordinator" &&
        Array.isArray(membership.get("projectIds")) &&
        !(membership.get("projectIds") as unknown[]).includes(project.id)
      )
        throw new Error("FORBIDDEN");
      const now = new Date().toISOString();
      await db.runTransaction((transaction) =>
        consumeAiQuota(transaction, db, input.tenantId, now),
      );
      const [contracts, invoices, questionnaires, schedules] = await Promise.all(
        ["contracts", "invoiceReferences", "questionnaireResponses", "schedules"].map(
          (collectionName) =>
            db
              .collection(collectionName)
              .where("tenantId", "==", input.tenantId)
              .where("projectId", "==", input.projectId)
              .limit(12)
              .get(),
        ),
      );
      const selectedProjectFacts = [
        "name",
        "eventType",
        "eventDate",
        "timezone",
        "venueName",
        "city",
        "state",
        "nextAction",
      ];
      const result = await generateCommunication({
        instruction: input.instruction,
        category: input.category,
        currentSubject: input.currentSubject,
        currentBody: input.currentBody,
        context: {
          asOf: now,
          project: Object.fromEntries(
            selectedProjectFacts
              .filter((key) => project.get(key) !== undefined)
              .map((key) => [key, project.get(key)]),
          ),
          contact: {
            displayName: contact.get("displayName") ?? null,
            firstName: contact.get("firstName") ?? null,
          },
          contracts: (contracts?.docs ?? []).map((item) => ({
            status: item.get("status"),
            provider: item.get("provider"),
            sentAt: item.get("sentAt"),
            completedAt: item.get("completedAt"),
          })),
          invoices: (invoices?.docs ?? []).map((item) => ({
            kind: item.get("kind"),
            status: item.get("status"),
            amountCents: item.get("amountCents"),
            balanceCents: item.get("balanceCents"),
            dueDate: item.get("dueDate"),
          })),
          questionnaires: (questionnaires?.docs ?? []).map((item) => ({
            status: item.get("status"),
            completionPercent: item.get("completionPercent"),
            dueDate: item.get("dueDate"),
          })),
          schedules: (schedules?.docs ?? []).map((item) => ({
            status: item.get("status"),
            version: item.get("version"),
            publishedAt: item.get("publishedAt"),
          })),
        },
      });
      const interactionId = `ai_communication_${randomUUID()}`;
      const batch = db.batch();
      batch.create(db.doc(`aiInteractions/${interactionId}`), {
        id: interactionId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        userId: identity.uid,
        type: "communication_draft",
        instruction: input.instruction,
        category: input.category,
        result,
        model:
          process.env.VERTEX_AI_COMMUNICATIONS_MODEL ??
          process.env.VERTEX_AI_COPILOT_MODEL,
        createdAt: now,
      });
      batch.create(db.doc(`auditEvents/${interactionId}`), {
        id: interactionId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: identity.uid,
        actorType: "user",
        action: "ai.communication_prepared",
        entityType: "ai_interaction",
        entityId: interactionId,
        timestamp: now,
        before: null,
        after: {
          category: input.category,
          factsUsed: result.factsUsed.length,
          needsConfirmation: result.needsConfirmation.length,
        },
        ipAddress: request.ip ?? null,
        userAgent: request.get("user-agent") ?? null,
        correlationId: request.get("x-correlation-id") ?? interactionId,
        automationRunId: null,
        providerEventId: null,
      });
      const preparedEvent = productEvent({
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: identity.uid,
        name: "communication.prepared",
        occurredAt: now,
        correlationId: interactionId,
        sourceEntityType: "aiInteraction",
        sourceEntityId: interactionId,
        properties: {
          workflowStep: true,
          executionMode: "ai_prepared",
          humanRole: "approval",
          category: input.category,
          factsUsed: result.factsUsed.length,
          needsConfirmation: result.needsConfirmation.length,
          revisedExistingDraft: Boolean(input.currentSubject || input.currentBody),
        },
      });
      batch.create(db.doc(`productEvents/${preparedEvent.id}`), preparedEvent);
      await batch.commit();
      response.status(200).json({ ...result, interactionId, asOf: now });
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "AI_COMMUNICATIONS_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message });
    }
  },
);
