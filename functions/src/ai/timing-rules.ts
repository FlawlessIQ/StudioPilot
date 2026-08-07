import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
import { consumeAiQuota } from "../saas/usage.js";

type Json = Record<string, unknown>;
const record = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};

/**
 * Learn timing rules from a past run-of-show.
 *
 * The studio pastes one of their existing schedules; the model proposes
 * reusable timing rules in the exact shape of the studio-owned knowledge
 * store. Proposals are ADVISORY ONLY — this endpoint persists nothing. The
 * owner reviews each proposal in the editor and saves the ones they want via
 * the deterministic saveTimingRule command, which is the approval boundary.
 */

const inputSchema = z.object({
  tenantId: z.string().min(1),
  eventTypeId: z.string().min(1).max(60),
  scheduleText: z.string().min(40).max(20000),
});

const ruleSchema = z.object({
  name: z.string().min(1).max(120),
  anchor: z.string().min(1).max(80),
  offsetMinutes: z.number().int().min(-1440).max(1440),
  durationMinutes: z.number().int().min(1).max(1440),
  bufferBeforeMinutes: z.number().int().min(0).max(600),
  bufferAfterMinutes: z.number().int().min(0).max(600),
  rationale: z.string().max(400),
});

const outputSchema = z.object({
  rules: z.array(ruleSchema).min(1).max(20),
  assumptions: z.array(z.string().max(300)).max(15),
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

async function propose(input: z.infer<typeof inputSchema>) {
  const project = process.env.VERTEX_AI_PROJECT_ID;
  const location = process.env.VERTEX_AI_LOCATION ?? "us-east4";
  const model =
    process.env.VERTEX_AI_MESSAGE_MODEL ?? process.env.VERTEX_AI_SCHEDULE_MODEL;
  if (!project || !model) throw new Error("VERTEX_AI_MESSAGE_NOT_CONFIGURED");
  const token = await accessToken();
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
  const callModel = async (contents: Array<Json>) => {
    const response = await fetch(endpoint, {
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
                "Extract reusable photography timing rules from this past run-of-show. Each rule anchors to a named moment (ceremony_start, reception_start, coverage_start, coverage_end) with an offset in minutes, a duration, and travel/prep buffers. Infer the studio's repeatable habits (e.g. coverage starts 120 minutes before ceremony_start; travel time is doubled as buffer). Only derive rules the text actually supports; list uncertainty in assumptions. Rules are proposals for human approval, never applied automatically.",
            },
          ],
        },
        contents,
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              rules: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    name: { type: "STRING" },
                    anchor: { type: "STRING" },
                    offsetMinutes: { type: "INTEGER" },
                    durationMinutes: { type: "INTEGER" },
                    bufferBeforeMinutes: { type: "INTEGER" },
                    bufferAfterMinutes: { type: "INTEGER" },
                    rationale: { type: "STRING" },
                  },
                  required: [
                    "name",
                    "anchor",
                    "offsetMinutes",
                    "durationMinutes",
                    "bufferBeforeMinutes",
                    "bufferAfterMinutes",
                    "rationale",
                  ],
                },
              },
              assumptions: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["rules", "assumptions"],
          },
        },
      }),
    });
    if (!response.ok)
      throw new Error(`VERTEX_AI_MESSAGE_FAILED:${response.status}`);
    const body = record(await response.json());
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const parts = Array.isArray(record(record(candidates[0]).content).parts)
      ? (record(record(candidates[0]).content).parts as unknown[])
      : [];
    const output = record(parts[0]).text;
    if (typeof output !== "string") throw new Error("VERTEX_AI_EMPTY_OUTPUT");
    return output;
  };
  const firstTurn: Json = {
    role: "user",
    parts: [
      {
        text: JSON.stringify({
          eventTypeId: input.eventTypeId,
          pastSchedule: input.scheduleText,
        }),
      },
    ],
  };
  const parse = (raw: string) => {
    try {
      const parsed = outputSchema.safeParse(JSON.parse(raw));
      return parsed.success
        ? { ok: true as const, data: parsed.data }
        : {
            ok: false as const,
            issues: parsed.error.issues
              .slice(0, 8)
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join("\n"),
          };
    } catch {
      return { ok: false as const, issues: "The response was not valid JSON." };
    }
  };
  const firstRaw = await callModel([firstTurn]);
  const first = parse(firstRaw);
  if (first.ok) return first.data;
  const repairRaw = await callModel([
    firstTurn,
    { role: "model", parts: [{ text: firstRaw }] },
    {
      role: "user",
      parts: [
        {
          text: `Your previous response failed validation:\n${first.issues}\nReturn the corrected JSON object only.`,
        },
      ],
    },
  ]);
  const repaired = parse(repairRaw);
  if (repaired.ok) return repaired.data;
  throw new Error("AI_OUTPUT_INVALID");
}

export const aiTimingRulesCommand = onRequest(
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
      const membership = await db
        .doc(`memberships/${input.tenantId}_${identity.uid}`)
        .get();
      if (
        !membership.exists ||
        membership.get("status") !== "active" ||
        !["studio_owner", "studio_admin"].includes(
          String(membership.get("role")),
        )
      )
        throw new Error("FORBIDDEN");
      const now = new Date().toISOString();
      await db.runTransaction((transaction) =>
        consumeAiQuota(transaction, db, input.tenantId, now),
      );
      const result = await propose(input);
      response.status(200).json({
        ...result,
        advisory: true,
        humanApprovalRequired: true,
      });
    } catch (caught: unknown) {
      const raw = caught instanceof Error ? caught.message : "";
      const message =
        caught instanceof z.ZodError
          ? "INVALID_REQUEST"
          : /^[A-Z0-9_:.]{1,64}$/.test(raw)
            ? raw
            : "AI_TIMING_RULES_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message.split(":")[0] });
    }
  },
);
