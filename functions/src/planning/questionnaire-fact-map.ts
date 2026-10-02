import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { vertexEndpoint } from "../ai/vertex-endpoint.js";
import { consumeAiQuota, refundAiQuota } from "../saas/usage.js";
import { FACT_DESCRIPTIONS, FACT_KEYS, normalisedQuestion, unmatchedFields, type FactKey } from "./job-facts.js";

/**
 * Which job fact each of a form's oddly worded questions asks for — read once
 * per form version by a model, for the questions the rules in job-facts.ts
 * can't place ("Where's the party?", "The big day").
 *
 * Advisory, and narrow: the model only names a fact from a fixed list, or
 * none. Values always come from the job's records (prefillFromFacts), the
 * couple sees each prefilled answer marked as such and can change it, and a
 * mapping that doesn't fit the field's type is dropped here. Charged against
 * the studio's AI allowance before the call, refunded if it fails, audited
 * after. Cached at `questionnaireFactMaps/{templateId}` for that version, so
 * sending the same form to forty couples asks once.
 *
 * Mock mode, no allowance, or a failed call: no map, and the rules alone fill
 * what they can — never an error for the person sending the form.
 */

export const FACT_MAP_VERSION = 1;

const mappingSchema = z.object({
  mappings: z.array(z.object({ fieldId: z.string().max(200), fact: z.string().max(60).nullable() })).max(200),
});

/** Which facts a field of each type can take. Anything else is dropped. */
const TYPE_ALLOWS: Record<string, (fact: FactKey) => boolean> = {
  date: (fact) => fact === "event_date",
  time: (fact) => fact === "ceremony_time",
  email: (fact) => fact.endsWith("_email"),
  phone: (fact) => fact.endsWith("_phone"),
};

/** Pure: the model's answer, kept only where it names a real fact that fits a field it was asked about. */
export function acceptedMappings(
  fields: ReadonlyArray<{ id: string; label: string; type: string }>,
  raw: unknown,
): Record<string, FactKey> {
  const parsed = mappingSchema.safeParse(raw);
  if (!parsed.success) return {};
  const byId = new Map(fields.map((field) => [field.id, field]));
  const accepted: Record<string, FactKey> = {};
  for (const { fieldId, fact } of parsed.data.mappings) {
    const field = byId.get(fieldId);
    if (!field || !fact || !(FACT_KEYS as readonly string[]).includes(fact)) continue;
    const key = fact as FactKey;
    const allows = TYPE_ALLOWS[field.type];
    if (allows && !allows(key)) continue;
    // "Bride's name" doesn't say which of the couple's contacts it means.
    if (/\b(bride|groom)/.test(normalisedQuestion(field.label)) && /partner|client|couple/.test(key)) continue;
    accepted[fieldId] = key;
  }
  return accepted;
}

async function metadataToken(): Promise<string> {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!response.ok) throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");
  const token = String(((await response.json()) as { access_token?: unknown }).access_token ?? "");
  if (!token) throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");
  return token;
}

async function askModel(fields: ReadonlyArray<{ id: string; label: string; type: string; options: string[] }>): Promise<unknown> {
  const project = process.env.VERTEX_AI_PROJECT_ID;
  const model = process.env.VERTEX_AI_EXTRACTION_MODEL;
  if (!project || !model) throw new Error("VERTEX_AI_NOT_CONFIGURED");
  const facts = FACT_KEYS.map((key) => `${key}: ${FACT_DESCRIPTIONS[key]}`).join("\n");
  const questions = fields
    .map((field) => `${field.id} | ${field.type || "text"} | ${field.label}${field.options.length ? ` | options: ${field.options.join(" / ")}` : ""}`)
    .join("\n");
  const response = await fetch(vertexEndpoint(project, model), {
    method: "POST",
    headers: { authorization: `Bearer ${await metadataToken()}`, "content-type": "application/json" },
    // "Send the form" waits on this once per form version: never for long.
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text:
              "A photography studio's client questionnaire. For each question, say which one of the listed job facts it asks the client for, " +
              "or null when it asks for anything else, asks about the fact rather than for it (\"Any restrictions at the venue?\"), " +
              "or could mean more than one fact. A question naming a bride or groom is null for names, emails and phones: the facts don't say who is who. " +
              "Use only the fact keys given. Return JSON only.\n\nFacts:\n" +
              facts,
          },
        ],
      },
      contents: [{ role: "user", parts: [{ text: `Questions (id | type | wording):\n${questions}`.slice(0, 12000) }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            mappings: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: { fieldId: { type: "STRING" }, fact: { type: "STRING", nullable: true } },
                required: ["fieldId"],
              },
            },
          },
          required: ["mappings"],
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`VERTEX_AI_FAILED:${response.status}`);
  const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const output = body.candidates?.[0]?.content?.parts?.[0]?.text;
  return output ? JSON.parse(output) : null;
}

/**
 * The form version's map: cached, or made now when the caller may spend on
 * it (`allowAi` — the studio sending the form, never the public inquiry page).
 */
export async function templateFactMap(
  db: Firestore,
  input: {
    tenantId: string;
    templateId: string | null;
    templateVersion: unknown;
    sections: unknown;
    allowAi: boolean;
    actorId?: string | null;
  },
): Promise<Record<string, FactKey>> {
  if (!input.templateId) return {};
  const reference = db.doc(`questionnaireFactMaps/${input.templateId}`);
  const cached = await reference.get();
  const version = Number(input.templateVersion ?? 0) || 0;
  if (
    cached.exists &&
    cached.get("tenantId") === input.tenantId &&
    cached.get("mapVersion") === FACT_MAP_VERSION &&
    Number(cached.get("templateVersion") ?? 0) === version
  )
    return (cached.get("map") ?? {}) as Record<string, FactKey>;

  const fields = unmatchedFields(input.sections);
  if (!fields.length || !input.allowAi || process.env.PROVIDER_MOCK_MODE === "true") return {};

  const reservedAt = new Date().toISOString();
  try {
    await db.runTransaction((transaction) => consumeAiQuota(transaction, db, input.tenantId, reservedAt));
  } catch {
    // No allowance left (or none at all): the rules alone fill the form.
    return {};
  }
  let map: Record<string, FactKey>;
  try {
    map = acceptedMappings(fields, await askModel(fields));
  } catch (caught) {
    await db.runTransaction((transaction) => refundAiQuota(transaction, db, input.tenantId, reservedAt)).catch(() => undefined);
    console.warn(
      JSON.stringify({
        severity: "WARNING",
        event: "questionnaire.fact_map_failed",
        templateId: input.templateId,
        reason: caught instanceof Error ? caught.message : String(caught),
      }),
    );
    return {};
  }
  const now = new Date().toISOString();
  const batch = db.batch();
  batch.set(reference, {
    id: input.templateId,
    tenantId: input.tenantId,
    templateId: input.templateId,
    templateVersion: version,
    mapVersion: FACT_MAP_VERSION,
    map,
    askedAbout: fields.map((field) => field.id),
    modelVersion: process.env.VERTEX_AI_EXTRACTION_MODEL ?? null,
    createdAt: now,
  });
  const auditId = `audit_fact_map_${input.templateId}_${version}_${FACT_MAP_VERSION}`;
  batch.set(db.doc(`auditEvents/${auditId}`), {
    id: auditId,
    tenantId: input.tenantId,
    projectId: null,
    actorId: input.actorId ?? "questionnaire-prefill",
    actorType: "system",
    action: "ai.questionnaire_fact_map",
    entityType: "questionnaireTemplate",
    entityId: input.templateId,
    timestamp: now,
    before: null,
    after: { templateVersion: version, map, askedAbout: fields.length, modelVersion: process.env.VERTEX_AI_EXTRACTION_MODEL ?? null },
    ipAddress: null,
    userAgent: null,
    correlationId: auditId,
    automationRunId: null,
    providerEventId: null,
  });
  await batch.commit();
  return map;
}
