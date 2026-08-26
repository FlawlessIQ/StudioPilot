import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
import { consumeAiQuota } from "../saas/usage.js";
import { productEvent } from "../operations/product-events.js";
import {
  lifecycleTriggerSet,
  renderLifecycleDraft,
  type LifecycleFacts,
} from "../communications/lifecycle-core.js";

type Json = Record<string, unknown>;
const record = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * Message drafting — the single entry point for every AI-prepared client
 * message. Output always lands in the AI review queue (aiActions,
 * review_required). Nothing is sent from here; approval and dispatch stay
 * human and deterministic.
 *
 * Lifecycle triggers (schedule confirmation, final invoice notice, day-before
 * checklist) are rendered deterministically from verified facts — no model
 * call, no quota. Personalized triggers (inquiry reply, proposal cover,
 * delivery note, review request) call the model with grounded context.
 */

const triggerSchema = z.enum([
  "inquiry_reply",
  "consultation_dates",
  "proposal_cover",
  "schedule_confirmation",
  "final_invoice_notice",
  "day_before_checklist",
  "delivery_note",
  "album_selection_reminder",
  "review_request",
  // Replying to something a client actually wrote. Every other trigger is the
  // studio starting a message; this one answers one.
  "inbound_reply",
]);

const inputSchema = z.object({
  tenantId: z.string().min(1),
  trigger: triggerSchema,
  leadId: z.string().min(1).nullable().default(null),
  projectId: z.string().min(1).nullable().default(null),
  /**
   * Required for inbound_reply: the thread being answered. Without it the model
   * has no idea what the client said, which is exactly the gap this closes.
   */
  conversationId: z.string().min(1).nullable().default(null),
  instructions: z.string().max(2000).default(""),
});

const modelOutputSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  highlights: z.array(z.string().max(300)).max(10),
  missingInformation: z.array(z.string().max(300)).max(10),
});

const CAPABILITY: Record<z.infer<typeof triggerSchema>, string> = {
  inquiry_reply: "inquiry_reply_draft",
  consultation_dates: "inquiry_reply_draft",
  proposal_cover: "proposal_draft",
  schedule_confirmation: "delivery_message_draft",
  final_invoice_notice: "delivery_message_draft",
  day_before_checklist: "delivery_message_draft",
  delivery_note: "delivery_message_draft",
  album_selection_reminder: "delivery_message_draft",
  review_request: "review_request_draft",
  // Reuses the inquiry capability rather than adding one: answering a client is
  // the same entitlement as answering an enquiry, and the capability enum in
  // features/ai-actions/schema.ts is closed.
  inbound_reply: "inquiry_reply_draft",
};

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

/**
 * "Wednesday, October 6, 2027" — a date a couple would recognise. An ISO
 * string in a client email reads as a database export, and this text goes
 * out over the studio's name.
 */
const dateWords = (value: string | null): string | null => {
  if (!value) return null;
  const day = value.slice(0, 10);
  const parsed = Date.parse(`${day}T12:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(parsed));
};

const money = (cents: unknown): string | null => {
  const value = Number(cents);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
};

/**
 * A grounded draft written without the model.
 *
 * Personalized triggers used to go straight to Vertex, so the studio's most
 * visible AI button ("Review reply" on an inquiry) failed outright wherever
 * Vertex was unavailable — mock mode, local emulator, or a transient outage
 * in production. A photographer does not care why; they see a dead button on
 * the one screen that decides whether they win the job.
 *
 * These templates use only facts already in `context`, exactly like the
 * lifecycle renderer, and flag what they could not fill.
 */
function fallbackDraft(input: {
  trigger: string;
  context: Json;
}): z.infer<typeof modelOutputSchema> {
  const lead = record(input.context.lead);
  const project = record(input.context.project);
  const studioName = text(record(input.context.studio).name) || "our studio";
  const who =
    text(lead.name).split(" ")[0] ||
    text(record(input.context.client).firstName) ||
    // A reply to a conversation knows who it is replying to.
    text(record(input.context.conversation).recipientName).split(" ")[0] ||
    "there";
  const eventDate = text(lead.eventDate) || text(project.eventDate) || null;
  const venue =
    text(lead.venue) ||
    text(lead.city) ||
    text(project.venueName) ||
    text(project.city) ||
    null;
  const missingInformation: string[] = [];
  const highlights: string[] = [];

  // A model outage must not leave a client's question unanswered on screen. This
  // deliberately does not attempt an answer — it acknowledges and hands the
  // studio something to edit, because guessing at what a client asked is worse
  // than an obviously unfinished draft.
  if (input.trigger === "inbound_reply") {
    const conversation = record(input.context.conversation);
    const history = Array.isArray(conversation.history)
      ? (conversation.history as unknown[]).map(record)
      : [];
    const latest = [...history]
      .reverse()
      .find((entry) => text(entry.from) === "client");
    return {
      subject: text(conversation.subject) || "Re: your photography",
      body: [
        `Hi ${who},`,
        "Thanks for getting back to me — I'll come back to you on this shortly.",
      ].join("\n\n"),
      highlights: latest
        ? [`Replying to: ${text(latest.body).slice(0, 160)}`]
        : [],
      missingInformation: [
        "Drafted without the model — write the actual answer before sending.",
      ],
    };
  }

  if (input.trigger === "inquiry_reply" || input.trigger === "consultation_dates") {
    const packages = Array.isArray(input.context.packages)
      ? (input.context.packages as unknown[]).map(record)
      : [];
    // The packages arrive in no particular order, so the cheapest and dearest
    // have to be found rather than assumed from the ends of the list —
    // quoting a floor that is not the real floor loses the job outright.
    const prices = packages
      .map((item) => Number(item.basePriceCents))
      .filter((value) => Number.isFinite(value) && value > 0);
    const range = prices.length
      ? prices.length === 1
        ? `Our collection is ${money(prices[0])}.`
        : `Our collections run from ${money(Math.min(...prices))} to ${money(Math.max(...prices))}.`
      : null;
    if (!range)
      missingInformation.push(
        "No active packages are published, so this reply quotes no prices.",
      );
    if (!eventDate)
      missingInformation.push("No event date was given in the inquiry.");
    missingInformation.push(
      "Confirm you are actually free that date before sending.",
    );
    const when = dateWords(eventDate);
    if (when) highlights.push(`Their date: ${when}`);
    if (venue) highlights.push(`Venue: ${venue}`);
    const body = [
      `Hi ${who},`,
      "",
      `Thank you for getting in touch — ${when ? `${when}${venue ? ` at ${venue}` : ""} sounds wonderful` : "I would love to hear more about your day"}.`,
      "",
      range ??
        "I'd love to talk through what coverage would suit the day you have in mind.",
      "",
      "Would a short call this week suit? I'll walk you through how I work and answer anything you're wondering about.",
      "",
      "Warmly,",
      studioName,
    ].join("\n");
    return {
      subject: `Thanks for reaching out${when ? ` about ${when}` : ""}`,
      body,
      highlights,
      missingInformation,
    };
  }

  const name = text(project.name) || "your event";
  missingInformation.push("Review and personalize before sending.");
  return {
    subject: `An update on ${name}`,
    body: [
      `Hi ${who},`,
      "",
      `A quick update on ${name}${dateWords(eventDate) ? ` on ${dateWords(eventDate)}` : ""}.`,
      "",
      "Warmly,",
      studioName,
    ].join("\n"),
    highlights,
    missingInformation,
  };
}

async function generateDraft(input: {
  trigger: string;
  instructions: string;
  context: Json;
}): Promise<z.infer<typeof modelOutputSchema>> {
  if (process.env.PROVIDER_MOCK_MODE === "true")
    return fallbackDraft({ trigger: input.trigger, context: input.context });
  const project = process.env.VERTEX_AI_PROJECT_ID;
  const location = process.env.VERTEX_AI_LOCATION ?? "us-east4";
  const model =
    process.env.VERTEX_AI_MESSAGE_MODEL ?? process.env.VERTEX_AI_SCHEDULE_MODEL;
  if (!project || !model)
    return fallbackDraft({ trigger: input.trigger, context: input.context });
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
                "Draft one client email for a photography studio from only the supplied facts. When a conversation is supplied, answer the client's most recent message directly and do not restate the whole thread. Write warmly and concisely in the studio's voice. Never invent availability, prices, dates, venues, links, or promises not present in the facts — put anything unknown in missingInformation instead. Never mention AI. The draft requires human review before sending. Output plain text (no markdown headers), short paragraphs.",
            },
          ],
        },
        contents,
        generationConfig: {
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              subject: { type: "STRING" },
              body: { type: "STRING" },
              highlights: { type: "ARRAY", items: { type: "STRING" } },
              missingInformation: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["subject", "body", "highlights", "missingInformation"],
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
          trigger: input.trigger,
          studioInstructions: input.instructions,
          facts: input.context,
        }),
      },
    ],
  };
  const parse = (raw: string) => {
    try {
      const parsed = modelOutputSchema.safeParse(JSON.parse(raw));
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

export const aiMessageDraftCommand = onRequest(
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
      if (!input.leadId && !input.projectId)
        throw new Error("LEAD_OR_PROJECT_REQUIRED");
      const db = getFirestore();
      const now = new Date().toISOString();
      const startedAt = Date.now();

      const membership = await db
        .doc(`memberships/${input.tenantId}_${identity.uid}`)
        .get();
      const role = text(membership.get("role"));
      if (
        !membership.exists ||
        membership.get("status") !== "active" ||
        !["studio_owner", "studio_admin", "studio_coordinator"].includes(role)
      )
        throw new Error("FORBIDDEN");

      // Idempotency: one action per (tenant, trigger, subject record) per day.
      const subjectId = input.projectId ?? input.leadId ?? "";
      const actionId = `ai_msg_${createHash("sha256")
        .update(
          `${input.tenantId}:${input.trigger}:${subjectId}:${now.slice(0, 10)}`,
        )
        .digest("hex")
        .slice(0, 30)}`;
      const actionReference = db.doc(`aiActions/${actionId}`);
      const existing = await actionReference.get();
      if (existing.exists && existing.get("status") === "review_required") {
        response.status(200).json({ actionId, status: "review_required" });
        return;
      }

      const sourceReferences: Json[] = [];
      let recipientEmail: string | null = null;
      let recipientName: string | null = null;
      let projectId: string | null = null;
      const context: Json = {};

      if (input.leadId) {
        const lead = await db.doc(`leads/${input.leadId}`).get();
        if (!lead.exists || lead.get("tenantId") !== input.tenantId)
          throw new Error("LEAD_NOT_FOUND");
        recipientEmail = text(lead.get("email")) || null;
        recipientName =
          [text(lead.get("firstName")), text(lead.get("lastName"))]
            .filter(Boolean)
            .join(" ") || null;
        context.lead = {
          name: recipientName,
          eventType: lead.get("eventType"),
          eventDate: lead.get("eventDate"),
          venue: lead.get("venue"),
          city: lead.get("city"),
          estimatedGuestCount: lead.get("estimatedGuestCount"),
          budgetRange: lead.get("budgetRange"),
          notes: lead.get("notes") ?? lead.get("message") ?? null,
        };
        sourceReferences.push({
          entityType: "lead",
          entityId: lead.id,
          versionId: null,
          label: `Inquiry from ${recipientName ?? "prospective client"}`,
          locator: null,
        });
      }

      if (input.projectId) {
        const project = await db.doc(`projects/${input.projectId}`).get();
        if (!project.exists || project.get("tenantId") !== input.tenantId)
          throw new Error("PROJECT_NOT_FOUND");
        if (
          role === "studio_coordinator" &&
          !(
            Array.isArray(membership.get("projectIds")) &&
            (membership.get("projectIds") as unknown[])
              .map(String)
              .includes(project.id)
          )
        )
          throw new Error("FORBIDDEN");
        projectId = project.id;
        context.project = {
          name: project.get("name"),
          eventType: project.get("eventType"),
          eventDate: project.get("eventDate"),
          venueName: project.get("venueName"),
          city: project.get("city"),
          state: project.get("state"),
        };
        sourceReferences.push({
          entityType: "project",
          entityId: project.id,
          versionId: null,
          label: text(project.get("name")) || "Project",
          locator: null,
        });
        const contactIds = Array.isArray(project.get("clientContactIds"))
          ? (project.get("clientContactIds") as unknown[]).map(String)
          : [];
        if (contactIds[0]) {
          const contact = await db.doc(`contacts/${contactIds[0]}`).get();
          if (contact.exists && contact.get("tenantId") === input.tenantId) {
            recipientEmail = text(contact.get("email")) || null;
            recipientName = text(contact.get("displayName")) || null;
            sourceReferences.push({
              entityType: "contact",
              entityId: contact.id,
              versionId: null,
              label: recipientName ?? "Client contact",
              locator: null,
            });
          }
        }
        const snapshotId = text(project.get("packageSnapshotId"));
        if (snapshotId) {
          const snapshot = await db
            .doc(`packageSnapshots/${snapshotId}`)
            .get();
          if (snapshot.exists && snapshot.get("tenantId") === input.tenantId) {
            context.package = {
              packageName: snapshot.get("packageName"),
              totalCents: snapshot.get("totalCents"),
              retainerCents: snapshot.get("retainerCents"),
              includedCoverageMinutes: snapshot.get("includedCoverageMinutes"),
            };
            sourceReferences.push({
              entityType: "packageSnapshot",
              entityId: snapshot.id,
              versionId: text(snapshot.get("packageVersion")) || null,
              label: text(snapshot.get("packageName")) || "Selected package",
              locator: null,
            });
          }
        }
      }

      const tenant = await db.doc(`tenants/${input.tenantId}`).get();
      const studioName =
        text(tenant.get("brandName")) ||
        text(tenant.get("businessName")) ||
        "Our studio";
      context.studio = { name: studioName };
      sourceReferences.push({
        entityType: "tenant",
        entityId: input.tenantId,
        versionId: null,
        label: studioName,
        locator: null,
      });

      if (
        input.trigger === "inquiry_reply" ||
        input.trigger === "consultation_dates"
      ) {
        const packages = await db
          .collection("packages")
          .where("tenantId", "==", input.tenantId)
          .where("active", "==", true)
          .get();
        context.packages = packages.docs
          .filter((item) => item.get("publicVisible") !== false)
          .slice(0, 8)
          .map((item) => ({
            name: item.get("name"),
            basePriceCents: item.get("basePriceCents"),
            includedCoverageMinutes: item.get("includedCoverageMinutes"),
            includedPhotographers: item.get("includedPhotographers"),
          }));
      }

      const isLifecycle = lifecycleTriggerSet.has(input.trigger);
      let draft: {
        subject: string;
        body: string;
        highlights: string[];
        missingInformation: string[];
      };
      let modelUsed = "deterministic_template";

      if (isLifecycle) {
        const packageFacts = record(context.package);
        const totalCents =
          typeof packageFacts.totalCents === "number"
            ? packageFacts.totalCents
            : null;
        const retainerCents =
          typeof packageFacts.retainerCents === "number"
            ? packageFacts.retainerCents
            : null;
        const facts: LifecycleFacts = {
          studioName,
          clientFirstName: recipientName?.split(" ")[0] ?? null,
          projectName: text(record(context.project).name) || "your event",
          eventDate: text(record(context.project).eventDate) || null,
          venueName: text(record(context.project).venueName) || null,
          packageTotalCents: totalCents,
          retainerPaidCents: retainerCents,
          balanceDueCents:
            totalCents !== null && retainerCents !== null
              ? Math.max(0, totalCents - retainerCents)
              : null,
          scheduleUrl: null,
          recipientEmail,
          recipientName,
        };
        draft = renderLifecycleDraft(
          input.trigger as
            | "schedule_confirmation"
            | "final_invoice_notice"
            | "day_before_checklist",
          facts,
        );
      } else {
        await db.runTransaction((transaction) =>
          consumeAiQuota(transaction, db, input.tenantId, now),
        );
        try {
      // The thread being answered. Without this the model is asked to reply to a
      // message it has never seen — the reason inbound_reply could not exist
      // before conversations did.
      if (input.conversationId) {
        const conversation = await db
          .doc(`conversations/${input.conversationId}`)
          .get();
        if (
          !conversation.exists ||
          conversation.get("tenantId") !== input.tenantId
        ) {
          throw new Error("CONVERSATION_NOT_FOUND");
        }
        projectId = projectId ?? (conversation.get("projectId") as string | null);
        recipientEmail =
          recipientEmail ??
          ((conversation.get("participant") as Record<string, unknown> | undefined)
            ?.email as string | null) ??
          null;
        recipientName =
          recipientName ??
          ((conversation.get("participant") as Record<string, unknown> | undefined)
            ?.name as string | null) ??
          null;
        // Oldest-last so the newest message is closest to the instruction, and
        // capped: a long thread would otherwise crowd out the project facts that
        // keep the draft honest.
        const history = await db
          .collection("messages")
          .where("conversationId", "==", input.conversationId)
          .orderBy("createdAt", "desc")
          .limit(12)
          .get();
        const ordered = history.docs.reverse();
        context.conversation = {
          // `recipientName` is resolved just above but was never put in the
          // context, so the fallback draft greeted a known client "Hi there"
          // while their name sat on the card above it.
          recipientName,
          subject: conversation.get("subject") ?? null,
          channels: conversation.get("channels") ?? [],
          messageCount: conversation.get("messageCount") ?? ordered.length,
          history: ordered.map((document) => ({
            from:
              document.get("direction") === "inbound" ? "client" : "studio",
            at: document.get("createdAt") ?? null,
            subject: document.get("subject") ?? null,
            body: String(
              document.get("body") ?? document.get("bodyPreview") ?? "",
            ).slice(0, 2000),
          })),
        };
      }

          draft = await generateDraft({
            trigger: input.trigger,
            instructions: input.instructions,
            context,
          });
          modelUsed =
            process.env.VERTEX_AI_MESSAGE_MODEL ??
            process.env.VERTEX_AI_SCHEDULE_MODEL ??
            "vertex";
        } catch {
          // A model outage must not become a dead button on the screen that
          // decides whether the studio wins the job. Fall back to the
          // grounded template and label it honestly.
          draft = fallbackDraft({ trigger: input.trigger, context });
          // The inbound fallback already labels itself, so prepending here put
          // two overlapping cautions on one card — "read it closely" above
          // "write the actual answer before sending". Add the label only when
          // the fallback has not already said it.
          const alreadyLabelled = draft.missingInformation.some((message) =>
            /without the model/i.test(message),
          );
          draft.missingInformation = alreadyLabelled
            ? draft.missingInformation
            : [
                "Drafted from your records without the model — read it closely.",
                ...draft.missingInformation,
              ];
        }
      }

      const issues = draft.missingInformation.map((message) => ({
        code: "MISSING_INFORMATION",
        severity: "warning" as const,
        message,
        field: null,
      }));
      if (!recipientEmail)
        issues.push({
          code: "NO_RECIPIENT_EMAIL",
          severity: "warning" as const,
          message:
            "No client email is on file; add one before this draft can be sent.",
          field: null,
        });

      const structuredOutput = {
        trigger: input.trigger,
        subject: draft.subject,
        body: draft.body,
        recipientEmail,
        recipientName,
        highlights: draft.highlights,
      };

      const action = {
        id: actionId,
        tenantId: input.tenantId,
        projectId,
        actorId: identity.uid,
        title: `Review ${input.trigger.replaceAll("_", " ")}`,
        capability: CAPABILITY[input.trigger],
        authorityBoundary: "draft_requires_review",
        status: "review_required",
        modelProvider: isLifecycle ? "studiocue" : "vertex_ai",
        modelVersion: modelUsed,
        instructionVersion: "message_draft_v1",
        outputSchemaVersion: "message_draft_output_v1",
        sourceReferences,
        structuredOutput,
        confidence: {
          overall: draft.missingInformation.length ? 0.6 : 0.85,
          label: draft.missingInformation.length ? "medium" : "high",
          uncertainFields: draft.missingInformation.slice(0, 8),
        },
        validation: {
          status: issues.length ? "pending" : "passed",
          issues,
        },
        decision: null,
        downstreamCommand: null,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostMicros: 0,
          latencyMs: Date.now() - startedAt,
          estimatedMinutesSaved: 12,
        },
        failure: null,
        snoozedUntil: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: identity.uid,
        updatedBy: identity.uid,
      };

      const batch = db.batch();
      batch.set(actionReference, action);
      const auditId = `audit_${actionId}`;
      batch.set(db.doc(`auditEvents/${auditId}`), {
        id: auditId,
        tenantId: input.tenantId,
        projectId,
        actorId: identity.uid,
        actorType: "user",
        action: "ai.message_drafted",
        entityType: "aiAction",
        entityId: actionId,
        timestamp: now,
        before: null,
        after: { trigger: input.trigger, capability: CAPABILITY[input.trigger] },
        ipAddress: request.ip ?? null,
        userAgent: request.get("user-agent") ?? null,
        correlationId: actionId,
        automationRunId: null,
        providerEventId: null,
      });
      const event = productEvent({
        tenantId: input.tenantId,
        projectId,
        actorId: identity.uid,
        name: "ai_action.completed",
        occurredAt: now,
        correlationId: actionId,
        sourceEntityType: "aiAction",
        sourceEntityId: actionId,
        properties: {
          capability: CAPABILITY[input.trigger],
          trigger: input.trigger,
          deterministic: isLifecycle,
          humanReviewRequired: true,
        },
      });
      batch.set(db.doc(`productEvents/${event.id}`), event);
      await batch.commit();
      response.status(200).json({ actionId, status: "review_required" });
    } catch (caught: unknown) {
      const raw = caught instanceof Error ? caught.message : "";
      const message =
        caught instanceof z.ZodError
          ? "INVALID_REQUEST"
          : /^[A-Z0-9_:.]{1,64}$/.test(raw)
            ? raw
            : "AI_MESSAGE_DRAFT_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message.split(":")[0] });
    }
  },
);
