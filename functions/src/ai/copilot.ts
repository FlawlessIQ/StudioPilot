import { randomUUID } from "node:crypto";
import {
  FieldValue,
  getFirestore,
  type DocumentSnapshot,
  type Query,
} from "firebase-admin/firestore";
import { requireActiveSubscription } from "../saas/entitlement-guard.js";
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
  // Prior turns of THIS conversation, so a follow-up ("what about the Smith
  // wedding?" → "draft them an update") is understood in context. Capped and
  // length-bounded to keep the call cheap; the browser supplies it, so it is
  // conversation memory only — every fact and citation is still re-assembled
  // server-side each turn, and the ask path executes nothing, so a tampered
  // history can at worst give the asker a worse answer to themselves.
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().trim().min(1).max(4000),
      }),
    )
    // The browser sends the whole thread, which grows unbounded. Keep only the
    // most recent 12 turns rather than REJECTING an over-long array — a hard
    // .max(12) here permanently broke every conversation past its 12th turn
    // (the request failed Zod validation before reaching the model, surfacing
    // as "Cue could not answer" on every later ask). The outer bound just caps
    // per-request work; the slice keeps the call cheap either way.
    .max(500)
    .transform((turns) => turns.slice(-12))
    .optional(),
  /** Existing conversation to append to; omitted starts a new thread. */
  threadId: z.string().min(1).max(80).optional(),
  /** Stream the answer as Server-Sent Events instead of one JSON response. */
  stream: z.boolean().optional(),
});

const listThreadsSchema = z.object({
  kind: z.literal("list_threads"),
  tenantId: z.string().min(1),
});

const loadThreadSchema = z.object({
  kind: z.literal("load_thread"),
  tenantId: z.string().min(1),
  threadId: z.string().min(1).max(80),
});

const copilotVoiceSchema = z.object({
  kind: z.enum(["get_copilot_voice", "set_copilot_voice"]),
  tenantId: z.string().min(1),
  voice: z.string().max(600).optional(),
});

const intakeRequestSchema = z.object({
  kind: z.literal("project_intake"),
  tenantId: z.string().min(1),
  message: z.string().trim().min(10).max(8000),
});

const proposalDraftRequestSchema = z.object({
  kind: z.literal("proposal_drafting"),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
});

const proposalDraftSchema = z.object({
  introduction: z.string().min(1).max(2000),
  termsSummary: z.string().min(1).max(2000),
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
        // The model's href is advisory; the handler filters citations to real
        // project links (allowedLinks) after parsing, so a stray or guessed
        // href must NOT reject the whole answer — it is simply dropped there.
        href: z.string(),
      }),
    )
    .max(12)
    // Advisory list: a malformed citation must never sink the whole answer.
    .catch([]),
  // Optional client emails the copilot proposes when the answer implies an
  // outward step (an overdue balance, an expired offer, a missing form). Each
  // becomes a human-approval card; nothing is ever sent without the owner's tap,
  // and the recipient is resolved server-side, never authored by the model.
  proposals: z
    .array(
      z.object({
        projectId: z.string().min(1),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(4000),
        purpose: z.string().min(1).max(160),
      }),
    )
    .max(3)
    .optional()
    .default([])
    // Advisory: a malformed proposal is dropped, never fatal to the answer.
    .catch([]),
  // Optional non-email actions the copilot proposes — internal, reversible
  // studio commands (a task to chase something, a proposal draft, an insurance
  // flag). Each becomes a human-approval card that runs the real command only on
  // the owner's tap. The model chooses WHICH command and supplies human-readable
  // copy; every entity id and precondition is resolved and checked server-side.
  actionProposals: z
    .array(
      z.object({
        commandType: z.enum([
          "create_task",
          "set_insurance_required",
          "create_proposal_draft",
          "assign_questionnaire",
        ]),
        projectId: z.string().min(1),
        title: z.string().max(200).optional().default(""),
        detail: z.string().max(2000).optional().default(""),
        dueDate: z.string().max(40).optional().default(""),
        rationale: z.string().min(1).max(300),
      }),
    )
    .max(3)
    .optional()
    .default([])
    // Advisory: a malformed action proposal is dropped, never fatal.
    .catch([]),
  // A multi-turn conversational flow the copilot can launch instead of (or with)
  // an answer: gather real options → the operator selects → fills a small form
  // (incl. any money) → sends. The model only chooses WHICH flow and the project;
  // the flow itself is deterministic and human-driven.
  flow: z
    .object({
      type: z.enum(["crew_offer", "select_package"]),
      // The model reliably emits `flow: { type: 'crew_offer' }` with no
      // projectId or reason even though it resolved the project (it names it in
      // the answer and fetched it via tool calls). Keep those recoverable — an
      // absent/blank value becomes null and the handler backfills the id from
      // the caller's scope or the single referenced project. A strict schema
      // here rejected the whole answer instead ("Cue could not answer",
      // VERTEX_AI_PARSE_FAILED on flow.projectId); dropping the flow entirely
      // (the previous fix) merely hid the launch. `type` stays required — the
      // outer .catch drops a flow with no valid type.
      projectId: z.string().min(1).nullable().optional().catch(null),
      reason: z.string().min(1).max(300).nullable().optional().catch(null),
    })
    .nullable()
    .optional()
    .catch(null),
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

// Resolve the project a launched flow targets. The model usually omits
// flow.projectId (see the flow schema), so backfill it from the strongest
// available signal, in order: the id the model gave (if it is one the caller
// can see), the project the whole conversation is scoped to, the project the
// model looked at when it referenced exactly one during tool use, or — as a
// last resort — the single visible project whose full name the model wrote
// into its answer or the operator quoted in the question. That last case
// covers select_package, which the model tends to launch WITHOUT a tool call
// (it needs no project detail to raise the picker), leaving `referenced`
// empty. If none of those disambiguates, return null and the flow does not
// launch — better a dropped flow than one aimed at the wrong project.
function resolveFlowProjectId(
  rawId: string | null | undefined,
  allowed: Set<string>,
  scopedId: string | null,
  referenced: Set<string>,
  projectNames: Map<string, string>,
  text: string,
): string | null {
  if (rawId && allowed.has(rawId)) return rawId;
  if (scopedId && allowed.has(scopedId)) return scopedId;
  const referencedAllowed = [...referenced].filter((id) => allowed.has(id));
  if (referencedAllowed.length === 1) return referencedAllowed[0] ?? null;
  const haystack = text.toLowerCase();
  const named = [...allowed].filter((id) => {
    const name = projectNames.get(id)?.trim().toLowerCase();
    return !!name && name.length >= 3 && haystack.includes(name);
  });
  if (named.length === 1) return named[0] ?? null;
  return null;
}

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

export async function scopedDocuments(
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

/**
 * The "job as a live object" the assistant renders inline. Every value here is
 * derived from records (project + its readiness assessment), never written by
 * the model — readiness counts and blockers are authoritative facts the model
 * must not invent. See docs/ai-command-chat-plan.
 */
const LIFECYCLE_STAGES = ["Inquiry", "Booking", "Planning", "Event", "Delivery"] as const;

function stageIndexForState(state: string): number {
  switch (state) {
    case "NEW":
    case "INQUIRY":
    case "CONSULTATION":
      return 0;
    case "PROPOSAL":
    case "CONTRACT_PENDING":
    case "RETAINER_PENDING":
    case "POSTPONED":
      return 1;
    case "BOOKED":
    case "PLANNING":
    case "READY":
      return 2;
    case "EVENT_COMPLETE":
      return 3;
    case "POST_PRODUCTION":
    case "DELIVERED":
    case "REVIEW_REQUESTED":
    case "CLOSED":
    case "ARCHIVED":
      return 4;
    default:
      return 1;
  }
}

type AttentionItem = {
  name: string;
  severity: "critical" | "warning" | "info";
  reason: string;
  dueDate: string | null;
};

function attentionFromAssessment(assessment: Record<string, unknown>): AttentionItem[] {
  const seen = new Map<string, AttentionItem>();
  const items = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const add = (raw: Record<string, unknown>, severity: AttentionItem["severity"]) => {
    const id = String(raw.checkpointId ?? raw.name ?? "");
    if (!id || seen.has(id)) return;
    seen.set(id, {
      name: String(raw.name ?? "Checkpoint"),
      severity,
      reason: String(raw.reason ?? ""),
      dueDate: typeof raw.dueDate === "string" ? raw.dueDate : null,
    });
  };
  // Blocking first so a blocking+overdue item resolves to critical, not warning.
  for (const item of items(assessment.blockingItems)) add(item, "critical");
  for (const item of items(assessment.overdueItems)) add(item, "warning");
  for (const item of items(assessment.atRiskItems)) add(item, "warning");
  return [...seen.values()].slice(0, 6);
}

function buildJobObject(
  project: Record<string, unknown>,
  assessment: Record<string, unknown> | null,
) {
  const venue = [project.venueName, project.city]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(", ");
  const attention = assessment ? attentionFromAssessment(assessment) : [];
  let readiness: { satisfied: number; total: number; ready: boolean } | null = null;
  if (assessment) {
    const satisfied = Number(assessment.satisfiedRequired ?? 0);
    // The assessment's own totalRequired can lag its blocking list; never show a
    // meter with fewer checkpoints than the ones we're flagging as outstanding.
    const total = Math.max(
      Number(assessment.totalRequired ?? 0),
      satisfied + attention.length,
    );
    readiness = { satisfied, total, ready: Boolean(assessment.ready) };
  }
  return {
    projectId: String(project.id ?? ""),
    name: String(project.name ?? "Untitled project"),
    eventDate: typeof project.eventDate === "string" ? project.eventDate : null,
    venue: venue || null,
    state: String(project.state ?? ""),
    stageIndex: stageIndexForState(String(project.state ?? "")),
    stages: [...LIFECYCLE_STAGES],
    readiness,
    recommendedNextAction:
      assessment && typeof assessment.recommendedNextAction === "string"
        ? assessment.recommendedNextAction
        : null,
    attention,
  };
}

// The client-facing result schema, shared by the streaming and non-streaming
// final-answer calls. Money stays integer cents on the wire; the prompt tells
// the model to render dollars in the prose it writes.
const RESPONSE_SCHEMA_JSON = {
  type: "OBJECT",
  properties: {
    answer: { type: "STRING" },
    facts: { type: "ARRAY", items: { type: "STRING" } },
    suggestions: { type: "ARRAY", items: { type: "STRING" } },
    citations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { label: { type: "STRING" }, href: { type: "STRING" } },
        required: ["label", "href"],
      },
    },
    proposals: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          projectId: { type: "STRING" },
          subject: { type: "STRING" },
          body: { type: "STRING" },
          purpose: { type: "STRING" },
        },
        required: ["projectId", "subject", "body", "purpose"],
      },
    },
    actionProposals: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          commandType: {
            type: "STRING",
            enum: [
              "create_task",
              "set_insurance_required",
              "create_proposal_draft",
              "assign_questionnaire",
            ],
          },
          projectId: { type: "STRING" },
          title: { type: "STRING" },
          detail: { type: "STRING" },
          dueDate: { type: "STRING" },
          rationale: { type: "STRING" },
        },
        required: ["commandType", "projectId", "rationale"],
      },
    },
    flow: {
      type: "OBJECT",
      properties: {
        type: { type: "STRING", enum: ["crew_offer", "select_package"] },
        projectId: { type: "STRING" },
        reason: { type: "STRING" },
      },
    },
  },
  required: ["answer", "facts", "suggestions", "citations"],
} as const;

const VERTEX_LOCATION = process.env.VERTEX_AI_LOCATION ?? "us-east4";

function vertexUrl(method: "generateContent" | "streamGenerateContent"): string {
  const project = process.env.VERTEX_AI_PROJECT_ID;
  const model = process.env.VERTEX_AI_COPILOT_MODEL;
  if (!project || !model) throw new Error("VERTEX_AI_COPILOT_NOT_CONFIGURED");
  const suffix =
    method === "streamGenerateContent"
      ? "streamGenerateContent?alt=sse"
      : "generateContent";
  return `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(VERTEX_LOCATION)}/publishers/google/models/${encodeURIComponent(model)}:${suffix}`;
}

/** One non-streaming generateContent call with a prebuilt request body. */
async function generateStructuredBody(requestBody: unknown) {
  const token = await cloudAccessToken();
  const response = await fetch(vertexUrl("generateContent"), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`VERTEX_AI_COPILOT_FAILED:${response.status}:${detail.slice(0, 500)}`);
  }
  const body = asRecord(await response.json());
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const content = asRecord(asRecord(candidates[0]).content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const output = asRecord(parts[0]).text;
  if (typeof output !== "string")
    throw new Error(
      `VERTEX_AI_EMPTY_OUTPUT:finish=${String(asRecord(candidates[0]).finishReason ?? "none")}`,
    );
  return responseSchema.parse(JSON.parse(output));
}

// gemini-2.5-pro thinks with a dynamic budget by default, which held the whole
// response open for 5–8s before emitting a single token — measured against
// Vertex directly (see the streaming work of 2026-09-08). The copilot's facts
// are already computed deterministically and handed to the model in the context
// pack, so it phrases grounded facts rather than deriving them; a small fixed
// budget keeps that reasoning intact while cutting time-to-first-token to ~2.6s
// and letting the answer stream. 256 was both faster AND at least as accurate as
// 512/1024 on a multi-project reasoning probe — more thinking bought nothing here.
const COPILOT_THINKING_BUDGET = 256;

const COPILOT_SYSTEM_INSTRUCTION =
  "You are StudioCue Event Copilot, in an ongoing conversation with a studio operator. Earlier turns are provided for context, but answer the latest question only from the tenant-scoped facts supplied with it. Never invent prices, payments, signatures, dates, statuses, people, or readiness. Clearly separate facts from suggestions. Populate `suggestions` with 2-3 short follow-up QUESTIONS the operator is likely to ask next — phrased as a question or a brief imperative Cue can answer or prepare a draft for, each under about six words (e.g. 'Draft the balance reminder', 'Who can shoot this?', 'What is still blocking it?'). They must be things you accomplish by answering or by preparing something for the operator to approve — never a promise to send, book, or change anything. Leave `suggestions` EMPTY whenever you set a `flow`, since the flow already carries the next step. Do not claim to execute actions. Readiness, insurance approval, contract completion, payment status, and permissions are deterministic system facts and cannot be changed by you. Keep the answer concise and operational. Monetary amounts in the facts are integer cents — render them as US dollars (e.g. 56970 becomes $569.70) and never describe a value as a number of 'cents'. Citations must use only href values present in the supplied citationCandidates." +
  " You may also propose up to three client emails in `proposals` when the answer implies a concrete outward step to a client — a reminder for an overdue balance, a nudge for an expired crew offer or an unsigned contract, a request to finish an overdue questionnaire. Each proposal is a DRAFT the operator reviews and sends with one tap; you never send anything. Write a specific, warm, professional subject and body grounded strictly in the supplied facts — do not invent amounts, dates, or names, and do not address the recipient by a guessed name or write an email address (the system fills the real recipient). `projectId` must be one from the supplied project overview. Propose an email only when it is genuinely the next step; leave `proposals` empty for purely informational questions, and never propose the same email twice." +
  " You may also propose up to three internal, reversible actions in `actionProposals` when the answer implies one: `create_task` (a to-do on a project — supply a short `title` and optional `detail` and `dueDate` as YYYY-MM-DD, e.g. a task to chase an overdue retainer or follow up on an expired offer), `set_insurance_required` (flag that the venue requires insurance), `create_proposal_draft` (prepare an unsent proposal draft — only when the project already has a selected package; put any cover note in `detail`), or `assign_questionnaire` (send the studio's planning questionnaire to the client — propose this when the questionnaire is overdue or not yet sent; approving emails the client). Give a one-line `rationale` for each. Each is a card the operator approves; nothing runs until they tap approve, and you never set money, ids, or recipients — the system resolves those. `projectId` must be one from the overview. Leave `actionProposals` empty unless an action is clearly the next step." +
  " When the operator ASKS to STAFF CREW — add crew, book a photographer/second shooter, or fill a crew role — set `flow` to { type: 'crew_offer', projectId, reason }. This launches an interactive flow that shows who is available, lets the operator pick who and set the pay, and sends the offers. When you launch crew_offer, do NOT state specific counts or statuses of prior crew offers (how many were sent, expired, invited, viewed, or accepted) in your `answer` or `facts` — you cannot see the live offer state and the flow shows it accurately; limit yourself to noting that the role is unfilled. When the operator needs to CHOOSE A PACKAGE for a project that has not selected one yet — they ask to pick/select a package, or building a proposal is blocked because no package is chosen — set `flow` to { type: 'select_package', projectId, reason }; it shows the studio's packages, the operator picks one, and it is applied. Set `flow` only for staffing or package selection; keep the `answer` short (one line) since the flow carries the interaction. Use at most one flow per turn, and `projectId` must be one from the overview. Be proactive, but never at the expense of the question actually asked. Launch a flow only when the operator's request is itself about acting — staffing or filling a crew role, choosing a package, or an open-ended triage ask such as 'what needs my attention today' or 'prep everything' — AND there is a real, specific gap on a real project. When the operator asked an INFORMATIONAL question — a status, a fact or count, 'is X ready', 'what is blocking X', 'which clients…', 'show me…' — ANSWER it directly and do NOT set `flow`, even if you notice an unfilled crew role or a missing package; instead name that gap in your answer and offer to act with a `suggestions` entry (e.g. 'Staff the second photographer'). Never launch a flow speculatively.";

/**
 * The final-answer request. The agent's gathered retrieval already lives in
 * `contents` (the function-call / function-response turns), and this call has
 * NO tools, so the model must answer now rather than fetch more. responseSchema
 * keeps the {answer, facts, suggestions, citations} contract; `answer` is first
 * in the schema so it streams first.
 */
function finalAnswerBody(
  contents: unknown[],
  citationCandidates: ReadonlyArray<{ label: string; href: string }>,
  voice?: string | null,
) {
  const voiceNote =
    voice && voice.trim()
      ? ` When you write client email drafts, match this studio's voice: ${voice.trim()}. Keep it grounded in the facts; the voice guides tone and sign-off, not content.`
      : "";
  return {
    systemInstruction: {
      parts: [
        {
          text:
            COPILOT_SYSTEM_INSTRUCTION +
            voiceNote +
            " Cite only from these citation targets (use their exact href, or omit citations if none apply): " +
            JSON.stringify(citationCandidates) +
            ".",
        },
      ],
    },
    contents,
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA_JSON,
      thinkingConfig: { thinkingBudget: COPILOT_THINKING_BUDGET },
    },
  };
}

/** The answer value typed so far, from an in-flight responseSchema JSON buffer. */
function partialAnswer(raw: string): string {
  const match = raw.match(/"answer"\s*:\s*"((?:\\.|[^"\\])*)/);
  if (!match) return "";
  try {
    // Close the string so JSON.parse can unescape it; drop a dangling backslash.
    return JSON.parse(`"${(match[1] ?? "").replace(/\\$/, "")}"`);
  } catch {
    return "";
  }
}

/**
 * Streams the final structured answer from a prebuilt request body: forwards the
 * `answer` text as it is produced (onToken) so the UI reveals it live, then
 * returns the fully parsed result. `answer` is first in the schema, so it streams
 * first; the rest of the JSON follows and is parsed at the end.
 */
async function streamStructuredBody(
  requestBody: unknown,
  onToken: (delta: string) => void,
) {
  const token = await cloudAccessToken();
  const response = await fetch(vertexUrl("streamGenerateContent"), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok || !response.body) {
    const detail = !response.ok ? await response.text().catch(() => "") : "no response body";
    throw new Error(`VERTEX_AI_COPILOT_FAILED:${response.status}:${detail.slice(0, 500)}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";
  let emitted = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Vertex SSE frames are `data: {json}\n\n`; process complete lines only.
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = asRecord(JSON.parse(payload));
        const candidates = Array.isArray(chunk.candidates) ? chunk.candidates : [];
        const parts = Array.isArray(asRecord(asRecord(candidates[0]).content).parts)
          ? (asRecord(asRecord(candidates[0]).content).parts as unknown[])
          : [];
        const text = asRecord(parts[0]).text;
        if (typeof text === "string") raw += text;
      } catch {
        /* a partial JSON frame across reads — keep accumulating */
      }
      const answerSoFar = partialAnswer(raw);
      if (answerSoFar.length > emitted.length) {
        onToken(answerSoFar.slice(emitted.length));
        emitted = answerSoFar;
      }
    }
  }
  // A parse failure here usually means the model returned no/truncated JSON
  // (safety block, MAX_TOKENS, or an empty stream). Surface the reason and a
  // head of the raw buffer so the catch logs something actionable.
  try {
    return responseSchema.parse(JSON.parse(raw));
  } catch (parseError: unknown) {
    const reason =
      parseError instanceof Error ? parseError.message : "parse failed";
    throw new Error(
      `VERTEX_AI_PARSE_FAILED:${reason}:rawLen=${raw.length}:head=${raw.slice(0, 200)}`,
    );
  }
}

// The agentic retrieval loop. Instead of dumping every collection into context,
// the model is handed a cheap project overview and two READ-ONLY tools, and it
// pulls only what a given question needs. Both tools are clamped server-side to
// the caller's permitted projects — the model cannot widen its own scope by
// naming a project id it was not granted, and no tool writes, sends, or executes
// anything (that stays with the human-approved command path).
const COPILOT_MAX_TOOL_ITERATIONS = 4;

const COPILOT_RETRIEVAL_INSTRUCTION =
  "You are StudioCue Event Copilot for a studio operator. You are given the operator's question and a compact overview of every project they can see (id, name, type, event date, state, readiness score). Use the read-only tools to fetch exactly the detail the question needs, then stop calling tools — a later step writes the final answer. For a question about one project, call get_project_detail with its id from the overview. For a portfolio question (who owes money, what is unsigned, which crew have not accepted), call find_across_projects. Do not call a tool if the overview already answers the question. Never invent data; rely only on tool results and the overview.";

const COPILOT_TOOL_DECLARATIONS = [
  {
    name: "get_project_detail",
    description:
      "Full operational detail for ONE project: contract status, invoices (balanceCents, dueDate, status), crew assignments and their acceptance status, open tasks, schedule, insurance, questionnaire, and the readiness assessment. Pass a projectId taken from the supplied project overview.",
    parameters: {
      type: "OBJECT",
      properties: {
        projectId: {
          type: "STRING",
          description: "Project id from the overview handed to you with the question.",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "find_across_projects",
    description:
      "Scan every project the operator can see and return only the records matching one dimension. Use for portfolio-wide questions. Returns slim records tagged with projectName and projectId.",
    parameters: {
      type: "OBJECT",
      properties: {
        dimension: {
          type: "STRING",
          description: "Which cross-project condition to scan for.",
          enum: [
            "unpaid_invoices",
            "unsigned_contracts",
            "pending_crew",
            "open_tasks",
            "incomplete_questionnaires",
          ],
        },
      },
      required: ["dimension"],
    },
  },
] as const;

/** A short, human-readable status for the tool the agent just chose to call. */
function toolStatusLabel(
  name: string,
  args: Record<string, unknown>,
  projectNames: Map<string, string>,
): string {
  if (name === "get_project_detail") {
    const id = typeof args.projectId === "string" ? args.projectId : "";
    return `Reading ${projectNames.get(id) ?? "the project"}…`;
  }
  if (name === "find_across_projects") {
    const labels: Record<string, string> = {
      unpaid_invoices: "Checking balances across projects…",
      unsigned_contracts: "Checking contract signatures…",
      pending_crew: "Checking crew acceptance…",
      open_tasks: "Checking open tasks…",
      incomplete_questionnaires: "Checking questionnaires…",
    };
    return labels[String(args.dimension)] ?? "Scanning your projects…";
  }
  return "Looking that up…";
}

/** Runs one read-only tool, always clamped to the caller's permitted scope. */
async function executeReadTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: string,
  permitted: string[] | null,
  projectNames: Map<string, string>,
): Promise<Json> {
  if (name === "get_project_detail") {
    const projectId = typeof args.projectId === "string" ? args.projectId : "";
    if (!projectId) return { error: "projectId is required" };
    // An id outside the caller's grant reads nothing — scope is enforced here,
    // never trusted from the model.
    if (permitted && !permitted.includes(projectId))
      return { error: "project not accessible" };
    const scope = [projectId];
    const [contracts, invoices, crew, tasks, schedules, insurance, questionnaires, readiness] =
      await Promise.all([
        scopedDocuments("contracts", tenantId, scope),
        scopedDocuments("invoiceReferences", tenantId, scope),
        scopedDocuments("crewAssignments", tenantId, scope),
        scopedDocuments("tasks", tenantId, scope),
        scopedDocuments("schedules", tenantId, scope),
        scopedDocuments("insuranceRequests", tenantId, scope),
        scopedDocuments("questionnaireResponses", tenantId, scope),
        scopedDocuments("readinessAssessments", tenantId, scope),
      ]);
    return {
      projectId,
      name: projectNames.get(projectId) ?? projectId,
      contracts,
      invoices,
      crew,
      tasks,
      schedules,
      insurance,
      questionnaires: questionnaires.map((item) => ({
        id: item.id,
        projectId: item.projectId,
        planningPackage: item.planningPackage,
        approvalState: item.approvalState,
      })),
      readiness: readiness[0] ?? null,
    };
  }
  if (name === "find_across_projects") {
    const dimension = typeof args.dimension === "string" ? args.dimension : "";
    const tag = (row: Json & { id: string }) => ({
      ...row,
      projectName: projectNames.get(String(row.projectId ?? "")) ?? null,
    });
    const lower = (value: unknown) => String(value ?? "").toLowerCase();
    if (dimension === "unpaid_invoices") {
      const rows = await scopedDocuments("invoiceReferences", tenantId, permitted);
      return {
        dimension,
        matches: rows.filter((row) => Number(row.balanceCents ?? 0) > 0).map(tag),
      };
    }
    if (dimension === "unsigned_contracts") {
      const rows = await scopedDocuments("contracts", tenantId, permitted);
      const signed = new Set(["signed", "completed", "complete", "executed"]);
      return {
        dimension,
        matches: rows.filter((row) => !signed.has(lower(row.status))).map(tag),
      };
    }
    if (dimension === "pending_crew") {
      const rows = await scopedDocuments("crewAssignments", tenantId, permitted);
      return {
        dimension,
        matches: rows.filter((row) => lower(row.status) !== "accepted").map(tag),
      };
    }
    if (dimension === "open_tasks") {
      const rows = await scopedDocuments("tasks", tenantId, permitted);
      const done = new Set(["done", "completed", "complete", "closed"]);
      return {
        dimension,
        matches: rows.filter((row) => !done.has(lower(row.status))).map(tag),
      };
    }
    if (dimension === "incomplete_questionnaires") {
      const rows = await scopedDocuments("questionnaireResponses", tenantId, permitted);
      return {
        dimension,
        matches: rows
          .filter((row) => lower(row.status ?? row.approvalState) !== "complete")
          .map((row) => ({
            id: row.id,
            projectId: row.projectId,
            status: row.status ?? row.approvalState ?? null,
            projectName: projectNames.get(String(row.projectId ?? "")) ?? null,
          })),
      };
    }
    return { error: `unknown dimension: ${dimension}` };
  }
  return { error: `unknown tool: ${name}` };
}

type ModelPart = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
};

/**
 * Reason → retrieve loop. Returns the accumulated `contents` (including every
 * function-call and function-response turn) for the final answer call, plus the
 * set of project ids the agent actually looked at (for citation scoping). The
 * loop ends when the model stops requesting tools, or at the iteration cap — a
 * bound on cost and latency; the final answer call has no tools, so it always
 * resolves to an answer regardless.
 */
async function runToolLoop(
  question: string,
  history: ReadonlyArray<{ role: "user" | "assistant"; text: string }>,
  projectOverview: unknown,
  tenantId: string,
  permitted: string[] | null,
  projectNames: Map<string, string>,
  onTool: (name: string, args: Record<string, unknown>) => void,
): Promise<{ contents: unknown[]; referenced: Set<string> }> {
  const referenced = new Set<string>();
  const contents: unknown[] = [
    ...history.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.text }],
    })),
    {
      role: "user",
      parts: [
        {
          text: JSON.stringify({
            question,
            projectOverview,
            asOf: new Date().toISOString(),
          }),
        },
      ],
    },
  ];
  for (let iteration = 0; iteration < COPILOT_MAX_TOOL_ITERATIONS; iteration++) {
    const token = await cloudAccessToken();
    const response = await fetch(vertexUrl("generateContent"), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: COPILOT_RETRIEVAL_INSTRUCTION }] },
        contents,
        tools: [{ functionDeclarations: COPILOT_TOOL_DECLARATIONS }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig: {
          temperature: 0,
          thinkingConfig: { thinkingBudget: COPILOT_THINKING_BUDGET },
        },
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`VERTEX_AI_COPILOT_FAILED:${response.status}:${detail.slice(0, 500)}`);
    }
    const body = asRecord(await response.json());
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const parts = (
      Array.isArray(asRecord(asRecord(candidates[0]).content).parts)
        ? (asRecord(asRecord(candidates[0]).content).parts as unknown[])
        : []
    ) as ModelPart[];
    const calls = parts.filter((part) => part.functionCall);
    if (!calls.length) return { contents, referenced };
    contents.push({ role: "model", parts });
    // The model may emit several functionCall parts in one turn. Their responses
    // must come back in a SINGLE content with one functionResponse part each, in
    // order — separate per-call contents are rejected by Vertex with a 400.
    const responseParts: unknown[] = [];
    for (const part of calls) {
      const call = part.functionCall;
      if (!call) continue;
      const callArgs = call.args ?? {};
      if (call.name === "get_project_detail" && typeof callArgs.projectId === "string")
        referenced.add(callArgs.projectId);
      onTool(call.name, callArgs);
      const result = await executeReadTool(
        call.name,
        callArgs,
        tenantId,
        permitted,
        projectNames,
      );
      const matches = Array.isArray((result as Json).matches)
        ? ((result as Json).matches as Json[])
        : [];
      for (const match of matches)
        if (typeof match.projectId === "string") referenced.add(match.projectId);
      responseParts.push({ functionResponse: { name: call.name, response: result } });
    }
    contents.push({ role: "user", parts: responseParts });
  }
  return { contents, referenced };
}

type CopilotProposal = {
  projectId: string;
  subject: string;
  body: string;
  purpose: string;
};

/**
 * Turns the copilot's proposed client emails into human-approval cards. Each is
 * created exactly like an `aiMessageDraftCommand` draft — capability
 * `inquiry_reply_draft`, `draft_requires_review`, `review_required` — so the
 * existing AiQueueCard renders it and approving dispatches the email through the
 * same `approvedCommunicationDispatch` path. The MODEL writes only the subject,
 * body, and purpose; the recipient is resolved HERE from the project's client
 * contact and is never model-authored, so the copilot can't email an address it
 * invented. A proposal for a project outside the caller's scope is dropped.
 */
async function buildProposalActions(
  tenantId: string,
  actorId: string,
  now: string,
  proposals: ReadonlyArray<CopilotProposal>,
  allowedProjectIds: Set<string>,
): Promise<Array<{ id: string; action: Record<string, unknown> }>> {
  const db = getFirestore();
  const model = process.env.VERTEX_AI_COPILOT_MODEL ?? "vertex_ai";
  const built: Array<{ id: string; action: Record<string, unknown> }> = [];
  for (const proposal of proposals) {
    if (!allowedProjectIds.has(proposal.projectId)) continue;
    const projectDoc = await db.doc(`projects/${proposal.projectId}`).get();
    if (!projectDoc.exists || projectDoc.get("tenantId") !== tenantId) continue;
    const projectName = String(projectDoc.get("name") ?? "Project");
    const sourceReferences: Array<Record<string, unknown>> = [
      {
        entityType: "project",
        entityId: proposal.projectId,
        versionId: null,
        label: projectName,
        locator: null,
      },
    ];
    let recipientEmail: string | null = null;
    let recipientName: string | null = null;
    let contactId: string | null = null;
    const contactIds = Array.isArray(projectDoc.get("clientContactIds"))
      ? (projectDoc.get("clientContactIds") as unknown[]).map(String)
      : [];
    if (contactIds[0]) {
      const contact = await db.doc(`contacts/${contactIds[0]}`).get();
      if (contact.exists && contact.get("tenantId") === tenantId) {
        recipientEmail =
          (typeof contact.get("email") === "string" ? contact.get("email") : null) || null;
        recipientName =
          (typeof contact.get("displayName") === "string"
            ? contact.get("displayName")
            : null) || null;
        contactId = contact.id;
        sourceReferences.push({
          entityType: "contact",
          entityId: contact.id,
          versionId: null,
          label: recipientName ?? "Client contact",
          locator: null,
        });
      }
    }
    const issues = recipientEmail
      ? []
      : [
          {
            code: "NO_RECIPIENT_EMAIL",
            severity: "warning" as const,
            message: "No client email is on file; add one before this draft can be sent.",
            field: null,
          },
        ];
    const id = `ai_${randomUUID()}`;
    built.push({
      id,
      action: {
        id,
        tenantId,
        projectId: proposal.projectId,
        actorId,
        title: proposal.purpose.slice(0, 200),
        capability: "inquiry_reply_draft",
        authorityBoundary: "draft_requires_review",
        status: "review_required",
        modelProvider: "vertex_ai",
        modelVersion: model,
        instructionVersion: "copilot_proposal_v1",
        outputSchemaVersion: "copilot_proposal_output_v1",
        sourceReferences,
        structuredOutput: {
          subject: proposal.subject,
          body: proposal.body,
          recipientEmail,
          recipientName,
          projectName,
          contactId,
          purpose: proposal.purpose,
        },
        confidence: { overall: 0.7, label: "medium", uncertainFields: [] },
        validation: { status: issues.length ? "pending" : "passed", issues },
        decision: null,
        downstreamCommand: null,
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
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }
  return built;
}

type CopilotCommandProposal = {
  commandType:
    | "create_task"
    | "set_insurance_required"
    | "create_proposal_draft"
    | "assign_questionnaire";
  projectId: string;
  title: string;
  detail: string;
  dueDate: string;
  rationale: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turns the copilot's non-email action proposals into human-approval cards that
 * run a real, reversible studio command on approval. The card carries the fully
 * RESOLVED command payload in `structuredOutput.command` (domain + op + input);
 * the client runs that exact command through the normal command endpoint — which
 * enforces its own authorization — after the owner approves, then stamps the
 * action via recordAiExecution. The model chooses the command and writes the
 * copy; ids and the project are resolved and scope-checked here, never authored
 * by the model. Actions are internal and reversible: a task doc, a project flag.
 */
async function buildCommandProposalActions(
  tenantId: string,
  actorId: string,
  now: string,
  proposals: ReadonlyArray<CopilotCommandProposal>,
  projectNames: Map<string, string>,
  allowedProjectIds: Set<string>,
): Promise<Array<{ id: string; action: Record<string, unknown> }>> {
  const db = getFirestore();
  const model = process.env.VERTEX_AI_COPILOT_MODEL ?? "vertex_ai";
  const built: Array<{ id: string; action: Record<string, unknown> }> = [];
  for (const proposal of proposals) {
    if (!allowedProjectIds.has(proposal.projectId)) continue;
    const projectName = projectNames.get(proposal.projectId) ?? "the project";
    let command: { domain: string; op: string; input: Record<string, unknown> };
    let label: string;
    let detail: string;
    // Outward actions email a real person on approval; the card asks the owner
    // to confirm the send and names the recipient.
    let outward = false;
    let sendsTo: string | null = null;
    if (proposal.commandType === "create_proposal_draft") {
      // A proposal draft needs the project's selected package snapshot for the
      // required termsSummary. No package selected (or terms too short) → skip,
      // rather than emit a card that would fail on approval.
      const projectDoc = await db.doc(`projects/${proposal.projectId}`).get();
      if (!projectDoc.exists || projectDoc.get("tenantId") !== tenantId) continue;
      const snapshotId = projectDoc.get("packageSnapshotId");
      if (typeof snapshotId !== "string" || !snapshotId) continue;
      const snapshot = await db.doc(`packageSnapshots/${snapshotId}`).get();
      if (!snapshot.exists || snapshot.get("tenantId") !== tenantId) continue;
      const terms = snapshot.get("terms");
      if (typeof terms !== "string" || terms.trim().length < 10) continue;
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      command = {
        domain: "proposal",
        op: "create_draft",
        input: {
          projectId: proposal.projectId,
          expiresAt,
          notes: proposal.detail.trim() || null,
          termsSummary: terms,
          retainerDueDate: null,
          balanceDueDate: null,
        },
      };
      label = `Draft a proposal for ${projectName}`;
      detail = "Prepare an unsent proposal draft from the selected package.";
    } else if (proposal.commandType === "create_task") {
      const title = (proposal.title || proposal.rationale).slice(0, 200).trim();
      if (title.length < 2) continue;
      const dueDate = ISO_DATE.test(proposal.dueDate) ? proposal.dueDate : null;
      // Full createTask payload — every field is required by the workflow
      // command's schema; description must be a string (not null).
      command = {
        domain: "workflow",
        op: "createTask",
        input: {
          projectId: proposal.projectId,
          workflowRunId: null,
          checkpointId: null,
          title,
          description: proposal.detail.trim().slice(0, 3000),
          assignedUserId: null,
          assignedRole: null,
          dueDate,
          priority: "normal",
          blocking: false,
        },
      };
      label = `Create a task on ${projectName}`;
      detail = title;
    } else if (proposal.commandType === "assign_questionnaire") {
      // Send the studio's planning questionnaire to the couple. The template id
      // is resolved server-side: only when the tenant has exactly one active
      // template is it unambiguous — otherwise skip rather than send the wrong
      // one. The command resolves the actual recipient from the project.
      const templates = await db
        .collection("questionnaireTemplates")
        .where("tenantId", "==", tenantId)
        .limit(20)
        .get();
      const active = templates.docs.filter(
        (doc) => String(doc.get("status") ?? "").toLowerCase() === "active",
      );
      if (active.length !== 1) continue;
      const template = active[0];
      if (!template) continue;
      command = {
        domain: "planning",
        op: "assignQuestionnaire",
        input: { projectId: proposal.projectId, templateId: template.id },
      };
      label = `Send the questionnaire for ${projectName}`;
      detail = "Email the studio's planning questionnaire to the client.";
      outward = true;
      sendsTo = "the client";
    } else if (proposal.commandType === "set_insurance_required") {
      command = {
        domain: "planning",
        op: "setInsuranceRequirement",
        // insuranceRequired is an enum, not a boolean.
        input: { projectId: proposal.projectId, insuranceRequired: "required" },
      };
      label = `Flag insurance required on ${projectName}`;
      detail = "Mark that the venue requires proof of insurance.";
    } else {
      continue;
    }
    const id = `ai_${randomUUID()}`;
    built.push({
      id,
      action: {
        id,
        tenantId,
        projectId: proposal.projectId,
        actorId,
        title: (proposal.rationale || label).slice(0, 200),
        capability: "studio_action",
        authorityBoundary: "human_approval_required",
        status: "review_required",
        modelProvider: "vertex_ai",
        modelVersion: model,
        instructionVersion: "copilot_action_v1",
        outputSchemaVersion: "copilot_action_output_v1",
        sourceReferences: [
          {
            entityType: "project",
            entityId: proposal.projectId,
            versionId: null,
            label: projectName,
            locator: null,
          },
        ],
        structuredOutput: {
          kind: "studio_command",
          commandType: proposal.commandType,
          label,
          detail,
          rationale: proposal.rationale,
          outward,
          sendsTo,
          command,
        },
        confidence: { overall: 0.7, label: "medium", uncertainFields: [] },
        validation: { status: "passed", issues: [] },
        decision: null,
        // commandType is set now so recordAiExecution can stamp the real result
        // on approval; commandId is a placeholder (the schema requires non-empty)
        // that the client overwrites with the created entity id once the command
        // actually runs, with executedAt still null until then.
        downstreamCommand: {
          commandType: proposal.commandType,
          commandId: "pending",
          executedAt: null,
        },
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostMicros: 0,
          latencyMs: 0,
          estimatedMinutesSaved: 5,
        },
        failure: null,
        snoozedUntil: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }
  return built;
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

/**
 * Proposal-copy drafting: introduction and terms summary in the studio's
 * voice, grounded ONLY in the consultation review and the locked package
 * snapshot. Pricing, dates, and legal terms are never authored here — the
 * snapshot and the signed agreement stay authoritative, and the studio
 * edits and approves before anything is sent.
 */
async function generateProposalDraft(facts: {
  studioName: string;
  project: Json;
  consultation: Json;
  packageSnapshot: Json;
}): Promise<{
  draft: z.infer<typeof proposalDraftSchema>;
  mode: "ai" | "deterministic";
}> {
  const fallback = () => {
    const packageName = String(facts.packageSnapshot.packageName ?? "your coverage");
    const priorities = Array.isArray(facts.consultation.priorities)
      ? (facts.consultation.priorities as unknown[]).map(String).slice(0, 3)
      : [];
    const introduction = [
      "Thank you for sharing what matters most for your celebration.",
      priorities.length
        ? `We heard you clearly on ${priorities.join(", ")}, and this proposal is shaped around exactly that.`
        : "This proposal reflects the priorities discussed during your consultation.",
      `${packageName} covers your day the way we talked it through — and nothing here changes without your say-so.`,
    ].join(" ");
    const terms = String(facts.packageSnapshot.terms ?? "").trim();
    const termsSummary = terms
      ? `In plain language: ${terms}`
      : "Coverage and deliverables are governed by the completed studio agreement.";
    return {
      draft: proposalDraftSchema.parse({
        introduction: introduction.slice(0, 2000),
        termsSummary: termsSummary.slice(0, 2000),
      }),
      mode: "deterministic" as const,
    };
  };
  if (process.env.PROVIDER_MOCK_MODE === "true") return fallback();
  const project = process.env.VERTEX_AI_PROJECT_ID;
  const location = process.env.VERTEX_AI_LOCATION ?? "us-east4";
  const model =
    process.env.VERTEX_AI_DRAFTING_MODEL ?? process.env.VERTEX_AI_EXTRACTION_MODEL;
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
                text: "Write proposal copy for a photography studio, grounded ONLY in the supplied facts. introduction: 2-4 warm, professional sentences addressed to the client, reflecting their stated priorities; never invent prices, dates, discounts, deliverables, or promises not in the facts. termsSummary: restate the package's approved terms in plain client-friendly language; never add, soften, or remove a term, and never write legal language of your own. The studio edits and approves this before anything is sent. Return JSON only.",
              },
            ],
          },
          contents: [{ role: "user", parts: [{ text: JSON.stringify(facts) }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                introduction: { type: "STRING" },
                termsSummary: { type: "STRING" },
              },
              required: ["introduction", "termsSummary"],
            },
          },
        }),
      },
    );
    if (!response.ok) throw new Error(`VERTEX_AI_FAILED:${response.status}`);
    const body = asRecord(await response.json());
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const content = asRecord(asRecord(candidates[0]).content);
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const output = asRecord(parts[0]).text;
    if (typeof output !== "string") throw new Error("VERTEX_AI_EMPTY_OUTPUT");
    const parsed = proposalDraftSchema.safeParse(JSON.parse(output));
    if (!parsed.success) return fallback();
    return { draft: parsed.data, mode: "ai" };
  } catch {
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
        // Whole-product billing gate (studio commands require a live subscription).
        await requireActiveSubscription(db, intake.tenantId);
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

      if (asRecord(request.body).kind === "proposal_drafting") {
        const draftRequest = proposalDraftRequestSchema.parse(request.body);
        const db = getFirestore();
        const draftMembership = await db
          .doc(`memberships/${draftRequest.tenantId}_${identity.uid}`)
          .get();
        if (
          !draftMembership.exists ||
          draftMembership.get("status") !== "active" ||
          !internalRoles.has(String(draftMembership.get("role")))
        )
          throw new Error("FORBIDDEN");
        // Whole-product billing gate (studio commands require a live subscription).
        await requireActiveSubscription(db, draftRequest.tenantId);
        const projectDocument = await db
          .doc(`projects/${draftRequest.projectId}`)
          .get();
        if (
          !projectDocument.exists ||
          projectDocument.get("tenantId") !== draftRequest.tenantId
        )
          throw new Error("PROJECT_NOT_FOUND");
        const snapshotId = String(projectDocument.get("packageSnapshotId") ?? "");
        if (!snapshotId) throw new Error("PACKAGE_SNAPSHOT_REQUIRED");
        const [snapshotDocument, consultations, tenantDocument] =
          await Promise.all([
            db.doc(`packageSnapshots/${snapshotId}`).get(),
            db
              .collection("consultations")
              .where("tenantId", "==", draftRequest.tenantId)
              .where("projectId", "==", draftRequest.projectId)
              .limit(5)
              .get(),
            db.doc(`tenants/${draftRequest.tenantId}`).get(),
          ]);
        if (
          !snapshotDocument.exists ||
          snapshotDocument.get("tenantId") !== draftRequest.tenantId
        )
          throw new Error("PACKAGE_SNAPSHOT_REQUIRED");
        const consultation = consultations.docs
          .map((item) => asRecord(item.data()))
          .sort((left, right) =>
            String(right.startsAt ?? "").localeCompare(String(left.startsAt ?? "")),
          )[0];
        const review = asRecord(consultation?.aiReview);
        const now = new Date().toISOString();
        await db.runTransaction((transaction) =>
          consumeAiQuota(transaction, db, draftRequest.tenantId, now),
        );
        const { draft, mode } = await generateProposalDraft({
          studioName: String(tenantDocument.get("name") ?? "the studio"),
          project: {
            name: projectDocument.get("name"),
            eventType: projectDocument.get("eventType"),
            eventDate: projectDocument.get("eventDate"),
            venueName: projectDocument.get("venueName"),
            city: projectDocument.get("city"),
          },
          consultation: {
            summary: review.summary ?? null,
            priorities: review.priorities ?? [],
          },
          packageSnapshot: {
            packageName: snapshotDocument.get("packageName"),
            description: snapshotDocument.get("description"),
            includedCoverageMinutes: snapshotDocument.get("includedCoverageMinutes"),
            includedPhotographers: snapshotDocument.get("includedPhotographers"),
            includedDeliverables: snapshotDocument.get("includedDeliverables"),
            terms: snapshotDocument.get("terms"),
          },
        });
        const interactionId = `ai_${randomUUID()}`;
        await db.doc(`aiInteractions/${interactionId}`).create({
          id: interactionId,
          tenantId: draftRequest.tenantId,
          projectId: draftRequest.projectId,
          userId: identity.uid,
          type: "proposal_copy_draft",
          result: draft,
          mode,
          model:
            mode === "ai"
              ? (process.env.VERTEX_AI_DRAFTING_MODEL ??
                process.env.VERTEX_AI_EXTRACTION_MODEL)
              : "deterministic",
          createdAt: now,
        });
        response.status(200).json({ draft, mode, interactionId });
        return;
      }

      // Conversation continuity (read-only): list the owner's recent threads,
      // or rebuild one thread's turns from the aiInteractions it wrote. Both
      // filter to userId + tenantId in memory so a single-field index suffices
      // and one owner can never read another's conversations.
      if (asRecord(request.body).kind === "list_threads") {
        const parsed = listThreadsSchema.parse(request.body);
        const db = getFirestore();
        const threadMembership = await db
          .doc(`memberships/${parsed.tenantId}_${identity.uid}`)
          .get();
        if (
          !threadMembership.exists ||
          threadMembership.get("status") !== "active" ||
          !internalRoles.has(String(threadMembership.get("role")))
        )
          throw new Error("FORBIDDEN");
        const snapshot = await db
          .collection("copilotThreads")
          .where("userId", "==", identity.uid)
          .limit(60)
          .get();
        const threads = snapshot.docs
          .map((doc) => doc.data())
          .filter((data) => data.tenantId === parsed.tenantId)
          .sort((a, b) =>
            String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")),
          )
          .slice(0, 20)
          .map((data) => ({
            id: String(data.id ?? ""),
            title: String(data.title ?? "Conversation"),
            lastQuestion: String(data.lastQuestion ?? ""),
            projectId: (data.projectId as string | null) ?? null,
            turnCount: Number(data.turnCount ?? 0),
            updatedAt: String(data.updatedAt ?? ""),
          }));
        response.status(200).json({ threads });
        return;
      }

      // The studio's saved copilot voice (tone / sign-off for email drafts).
      // Owner/admin only, since it is a tenant-wide setting.
      if (
        asRecord(request.body).kind === "get_copilot_voice" ||
        asRecord(request.body).kind === "set_copilot_voice"
      ) {
        const parsed = copilotVoiceSchema.parse(request.body);
        const db = getFirestore();
        const voiceMembership = await db
          .doc(`memberships/${parsed.tenantId}_${identity.uid}`)
          .get();
        const voiceRole = String(voiceMembership.get("role"));
        if (
          !voiceMembership.exists ||
          voiceMembership.get("status") !== "active" ||
          !["studio_owner", "studio_admin"].includes(voiceRole)
        )
          throw new Error("FORBIDDEN");
        const tenantRef = db.doc(`tenants/${parsed.tenantId}`);
        if (parsed.kind === "set_copilot_voice") {
          const value = (parsed.voice ?? "").trim().slice(0, 600);
          await tenantRef.set(
            {
              copilotVoice: value || null,
              updatedAt: new Date().toISOString(),
              updatedBy: identity.uid,
            },
            { merge: true },
          );
          response.status(200).json({ voice: value || null });
          return;
        }
        const current = await tenantRef.get();
        response.status(200).json({
          voice:
            typeof current.get("copilotVoice") === "string"
              ? current.get("copilotVoice")
              : null,
        });
        return;
      }

      if (asRecord(request.body).kind === "load_thread") {
        const parsed = loadThreadSchema.parse(request.body);
        const db = getFirestore();
        const threadMembership = await db
          .doc(`memberships/${parsed.tenantId}_${identity.uid}`)
          .get();
        if (
          !threadMembership.exists ||
          threadMembership.get("status") !== "active" ||
          !internalRoles.has(String(threadMembership.get("role")))
        )
          throw new Error("FORBIDDEN");
        const snapshot = await db
          .collection("aiInteractions")
          .where("threadId", "==", parsed.threadId)
          .limit(60)
          .get();
        const interactions = snapshot.docs
          .map((doc) => doc.data())
          .filter(
            (data) =>
              data.userId === identity.uid && data.tenantId === parsed.tenantId,
          )
          .sort((a, b) =>
            String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
          );
        const turns: Array<
          | { role: "user"; text: string }
          | { role: "assistant"; result: unknown }
        > = [];
        for (const data of interactions) {
          if (typeof data.question === "string") {
            turns.push({ role: "user", text: data.question });
          }
          if (data.result && typeof data.result === "object") {
            turns.push({ role: "assistant", result: data.result });
          }
        }
        response.status(200).json({ threadId: parsed.threadId, turns });
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
      // Whole-product billing gate (studio commands require a live subscription).
      await requireActiveSubscription(db, input.tenantId);
      // The studio's saved copilot voice (tone / sign-off), if set — shapes only
      // how email drafts read, never their facts.
      const tenantDoc = await db.doc(`tenants/${input.tenantId}`).get();
      const copilotVoice =
        typeof tenantDoc.get("copilotVoice") === "string"
          ? (tenantDoc.get("copilotVoice") as string)
          : null;
      const isNewThread = !input.threadId;
      const threadId = input.threadId ?? `thread_${randomUUID()}`;
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
      // Only the two collections the deterministic layer needs are loaded up
      // front: `projects` (the overview + citation candidates + primary-project
      // pick) and `readiness` (the job object's authoritative counts). Every
      // heavier per-project record is pulled on demand by the agent, so this
      // scales to a large portfolio without dumping it all into one prompt.
      const [projects, readiness] = await Promise.all([
        scopedDocuments("projects", input.tenantId, permittedProjectIds),
        scopedDocuments("readinessAssessments", input.tenantId, permittedProjectIds),
      ]);
      const citationCandidates = projects.map((project) => ({
        label: String(project.name ?? project.id),
        href: `/studio/projects/${String(project.id)}`,
      }));
      const projectNames = new Map(
        projects.map((project) => [String(project.id), String(project.name ?? project.id)]),
      );
      // Readiness signal comes from the loaded assessments (the authoritative
      // source), never the project's cached readinessScore, which drifts against
      // the checkpoints. Keyed once here and reused for the job object below.
      const readinessByProject = new Map(
        readiness.map((item) => [
          String((item as Record<string, unknown>).projectId ?? ""),
          item as Record<string, unknown>,
        ]),
      );
      // The cheap overview the agent gets up front, so it resolves a project by
      // name without a round-trip and pulls heavy detail only when needed.
      const projectOverview = projects.map((project) => {
        const assessment = readinessByProject.get(String(project.id));
        return {
          id: String(project.id),
          name: project.name ?? null,
          eventType: project.eventType ?? null,
          eventDate: project.eventDate ?? null,
          state: project.state ?? null,
          ready: assessment ? Boolean(assessment.ready) : null,
          openBlockers:
            assessment && Array.isArray(assessment.blockingItems)
              ? assessment.blockingItems.length
              : null,
        };
      });

      // Open the SSE response first so retrieval status ("Reading Smith
      // Wedding…") and the streamed answer both push as they happen. The tool
      // loop runs the read-only tools the model chooses; the final call carries
      // no tools, so it must answer. Non-streaming callers get one JSON body and
      // no interim status. Everything after — filtering, jobObject, persistence
      // — is identical for both.
      const streaming = input.stream === true;
      if (streaming) {
        response.setHeader("content-type", "text/event-stream");
        response.setHeader("cache-control", "no-cache");
        response.setHeader("connection", "keep-alive");
        response.flushHeaders?.();
      }
      const writeSSE = (obj: unknown) => {
        response.write(`data: ${JSON.stringify(obj)}\n\n`);
      };
      const { contents: retrievalContents, referenced: referencedProjectIds } = await runToolLoop(
        input.question,
        input.history ?? [],
        projectOverview,
        input.tenantId,
        permittedProjectIds,
        projectNames,
        (name, toolArgs) => {
          if (streaming) writeSSE({ status: toolStatusLabel(name, toolArgs, projectNames) });
        },
      );
      const finalBody = finalAnswerBody(retrievalContents, citationCandidates, copilotVoice);
      const result = streaming
        ? await streamStructuredBody(finalBody, (delta) => writeSSE({ token: delta }))
        : await generateStructuredBody(finalBody);
      const allowedLinks = new Set(citationCandidates.map((item) => item.href));
      // `proposals` is the model's raw draft input; the client renders the
      // created approval cards by id, so it is not echoed in the client result.
      const safeResult = {
        answer: result.answer,
        facts: result.facts,
        suggestions: result.suggestions,
        citations: result.citations.filter((item) => allowedLinks.has(item.href)),
      };
      const allowedProjectIds = new Set(
        projects.map((project) => String((project as Record<string, unknown>).id)),
      );
      // A launched flow's project, recovered even when the model omitted the id
      // (it almost always does). Computed here so the inline job card can follow
      // the flow rather than an unrelated project.
      const flowProjectId = result.flow
        ? resolveFlowProjectId(
            result.flow.projectId,
            allowedProjectIds,
            input.projectId ?? null,
            referencedProjectIds,
            projectNames,
            `${result.answer ?? ""} ${input.question ?? ""}`,
          )
        : null;
      // The project the answer is really about: the launched flow's project,
      // else the first cited project, else the scoped project, else the one
      // carrying the most attention. Its job object renders inline as a live,
      // record-derived summary. (A crew/package flow answer carries no
      // citations, so without the flow project first the card would fall
      // through to an arbitrary at-risk project — the wrong one.)
      const citedProjectId =
        flowProjectId ??
        safeResult.citations[0]?.href.split("/").pop() ??
        input.projectId ??
        null;
      const primaryProject =
        (citedProjectId
          ? projects.find((project) => String((project as Record<string, unknown>).id) === citedProjectId)
          : undefined) ??
        projects.find((project) => {
          const a = readinessByProject.get(String((project as Record<string, unknown>).id));
          return a && a.ready === false;
        }) ??
        projects[0];
      const jobObject = primaryProject
        ? buildJobObject(
            primaryProject as Record<string, unknown>,
            readinessByProject.get(String((primaryProject as Record<string, unknown>).id)) ?? null,
          )
        : null;
      // The copilot's proposed client emails become human-approval cards. The
      // model wrote the subject/body; the recipient is resolved server-side, and
      // a proposal for a project outside the caller's scope is dropped.
      const proposalActions = await buildProposalActions(
        input.tenantId,
        identity.uid,
        now,
        (result.proposals ?? []) as CopilotProposal[],
        allowedProjectIds,
      );
      // Non-email, reversible command proposals (create a task, flag insurance).
      // Rendered as the same inline approval cards; the client runs the command
      // on approval.
      const commandActions = await buildCommandProposalActions(
        input.tenantId,
        identity.uid,
        now,
        (result.actionProposals ?? []) as CopilotCommandProposal[],
        projectNames,
        allowedProjectIds,
      );
      const proposalActionIds = [
        ...proposalActions.map((entry) => entry.id),
        ...commandActions.map((entry) => entry.id),
      ];
      // A launched conversational flow — its project recovered above and
      // validated to the caller's scope. The model only chose the type (and
      // usually little else); the flow's own steps fetch options, take the
      // operator's input, and run the command. A missing reason gets a
      // sensible default so the card always reads cleanly.
      const flowProjectName =
        (flowProjectId && projectNames.get(flowProjectId)) ?? "the project";
      const flowTitles: Record<string, string> = {
        crew_offer: `Staff ${flowProjectName}`,
        select_package: `Choose a package for ${flowProjectName}`,
      };
      const flowReasons: Record<string, string> = {
        crew_offer: `Find and offer crew for ${flowProjectName}.`,
        select_package: `Choose a package for ${flowProjectName}.`,
      };
      const flowDirective =
        result.flow && flowProjectId
          ? {
              type: result.flow.type,
              projectId: flowProjectId,
              title: flowTitles[result.flow.type] ?? flowProjectName,
              reason: result.flow.reason ?? flowReasons[result.flow.type] ?? flowProjectName,
            }
          : null;
      const interactionId = `ai_${randomUUID()}`;
      const batch = db.batch();
      for (const entry of [...proposalActions, ...commandActions]) {
        batch.set(db.doc(`aiActions/${entry.id}`), entry.action);
      }
      batch.create(db.doc(`aiInteractions/${interactionId}`), {
        id: interactionId,
        tenantId: input.tenantId,
        projectId: input.projectId ?? null,
        userId: identity.uid,
        type: "copilot_question",
        threadId,
        question: input.question,
        // Store the full client-facing result (incl. jobObject + asOf) so a
        // resumed thread re-renders faithfully, not just the bare answer.
        result: { ...safeResult, jobObject, asOf: now, proposalActionIds, flow: flowDirective },
        model: process.env.VERTEX_AI_COPILOT_MODEL,
        createdAt: now,
      });
      // Thread index for the conversation rail. Title is set once, on the first
      // turn (a new thread carries no incoming threadId); later turns only bump
      // recency and the running turn count.
      batch.set(
        db.doc(`copilotThreads/${threadId}`),
        {
          id: threadId,
          tenantId: input.tenantId,
          userId: identity.uid,
          projectId: input.projectId ?? null,
          lastQuestion: input.question.slice(0, 120),
          updatedAt: now,
          turnCount: FieldValue.increment(1),
          ...(isNewThread ? { title: input.question.slice(0, 80), createdAt: now } : {}),
        },
        { merge: true },
      );
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
      const payload = {
        ...safeResult,
        interactionId,
        asOf: now,
        jobObject,
        threadId,
        proposalActionIds,
        flow: flowDirective,
      };
      if (streaming) {
        writeSSE({ done: payload });
        response.end();
      } else {
        response.status(200).json(payload);
      }
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "AI_COPILOT_FAILED";
      // Make the failure visible in Cloud Logging at ERROR severity. Without
      // this the function returns 200 with a streamed error event (or a 400),
      // and the real cause — a Vertex status/body or a responseSchema parse
      // failure — never reaches the logs, so "Cue could not answer" is
      // undiagnosable from the access log alone.
      console.error("[copilot] request failed", {
        message,
        name: caught instanceof Error ? caught.name : typeof caught,
        stack: caught instanceof Error ? caught.stack : undefined,
        streamed: response.headersSent,
        correlationId: request.get("x-correlation-id") ?? null,
      });
      // If a stream was already opened, the status/headers are sent — surface
      // the failure as an SSE error event and close, rather than throwing on a
      // second header write.
      if (response.headersSent) {
        try {
          response.write(`data: ${JSON.stringify({ error: message })}\n\n`);
        } catch {
          /* connection already gone */
        }
        response.end();
        return;
      }
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message });
    }
  },
);
