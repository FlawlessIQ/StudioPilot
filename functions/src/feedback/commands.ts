import { createHash, randomUUID } from "node:crypto";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";
import { applyFeedbackStatus } from "./status.js";
import {
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_ROLES,
  FEEDBACK_SCREENSHOT_MAX_BYTES,
  FEEDBACK_STATUSES,
  feedbackSubject,
  type FeedbackKind,
  type FeedbackStatus,
} from "./model.js";

/**
 * Feedback from a studio to the StudioCue team, and the team's answer.
 *
 * `submitFeedback` stores what the studio said (with a screenshot of the
 * screen they were on, when they keep it), sends it to the team inbox with
 * Reply-To set to the person, so a reply from the inbox goes straight back to
 * them, and sends them a thank-you signed by the team.
 *
 * `setFeedbackStatus` is the team's triage (platform admins only). Moving a
 * piece of feedback to Planned or Shipped writes back to the person who sent
 * it — the part that shows a studio it was heard.
 *
 * Every email here is platform mail under tenant "platform": it wears
 * StudioCue's letterhead, not the studio's, and a failed send never lands on a
 * studio's Today as one of their own.
 *
 * Deliberately not gated on the subscription: a studio whose trial lapsed is
 * exactly the studio whose feedback is worth hearing.
 */

const contextSchema = z.object({
  route: z.string().max(500),
  viewport: z.string().max(40).nullable(),
  userAgent: z.string().max(400).nullable(),
  lastError: z.string().max(600).nullable(),
});

const requestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("submitFeedback"),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      tenantId: z.string().min(1).max(200),
      kind: z.enum(FEEDBACK_KINDS),
      message: z.string().trim().min(1).max(FEEDBACK_MESSAGE_MAX),
      followUpOk: z.boolean(),
      context: contextSchema,
      // A data URL: the browser captures and downsizes the screen to a JPEG.
      screenshot: z.string().max(Math.ceil(FEEDBACK_SCREENSHOT_MAX_BYTES * 1.4)).nullable(),
    }),
  }),
  z.object({
    type: z.literal("setFeedbackStatus"),
    idempotencyKey: z.string().min(8).max(160),
    input: z.object({
      feedbackId: z.string().min(1).max(200),
      status: z.enum(FEEDBACK_STATUSES),
      // What the team says to the studio with the change. Shown in their
      // feedback list and in the email.
      note: z.string().trim().max(1000).nullable(),
    }),
  }),
]);

/** Ten an hour is more than anyone writes by hand, and fewer than a loop sends. */
const SUBMISSIONS_PER_HOUR = 10;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function teamInbox(): string | null {
  const inbox = process.env.FEEDBACK_INBOX?.trim();
  return inbox && inbox.includes("@") ? inbox : null;
}

/** Where a studio's reply to a team email goes. Never the inbox's own address. */
function teamReplyAddress(): string {
  return process.env.FEEDBACK_REPLY_TO?.trim() || "support@studio-cue.com";
}

function appUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com"}${path}`;
}

function decodeScreenshot(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match?.[2]) throw new Error("SCREENSHOT_INVALID");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > FEEDBACK_SCREENSHOT_MAX_BYTES) throw new Error("SCREENSHOT_TOO_LARGE");
  // Checked by content, not the label the browser put on it.
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes.subarray(0, 4).toString("hex") === "89504e47";
  const webp = bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!jpeg && !png && !webp) throw new Error("SCREENSHOT_INVALID");
  return bytes;
}

async function withinRateLimit(db: Firestore, userId: string): Promise<boolean> {
  const reference = db.doc(`feedbackRateLimits/${userId}`);
  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const now = Date.now();
    const windowStart = Date.parse(String(current.get("windowStartedAt") ?? ""));
    const fresh = !Number.isFinite(windowStart) || now - windowStart > 3_600_000;
    const count = fresh ? 0 : Number(current.get("count") ?? 0);
    if (count >= SUBMISSIONS_PER_HOUR) return false;
    transaction.set(reference, {
      userId,
      windowStartedAt: fresh ? new Date(now).toISOString() : current.get("windowStartedAt"),
      count: count + 1,
      updatedAt: new Date(now).toISOString(),
    });
    return true;
  });
}

function auditEvent(input: {
  tenantId: string;
  actorId: string;
  actorType: "user" | "platform_admin";
  action: string;
  entityId: string;
  before: unknown;
  after: unknown;
  correlationId: string;
  userAgent: string | null;
}) {
  const id = randomUUID();
  return {
    id,
    data: {
      id,
      tenantId: input.tenantId,
      projectId: null,
      actorId: input.actorId,
      actorType: input.actorType,
      action: input.action,
      entityType: "feedback",
      entityId: input.entityId,
      timestamp: new Date().toISOString(),
      before: input.before,
      after: input.after,
      ipAddress: null,
      userAgent: input.userAgent,
      correlationId: input.correlationId,
      automationRunId: null,
      providerEventId: null,
    },
  };
}

function emailJob(
  id: string,
  fields: Record<string, unknown> & { type: string; recipient: string },
) {
  const now = new Date().toISOString();
  return {
    id,
    tenantId: "platform",
    projectId: null,
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}

export const feedbackCommand = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
    // A screenshot rides in the body.
    memory: "512MiB",
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      const parsed = requestSchema.parse(request.body);
      const db = getFirestore();
      const userAgent = request.get("user-agent") ?? null;

      if (parsed.type === "submitFeedback") {
        const input = parsed.input;
        const membership = await db.doc(`memberships/${input.tenantId}_${identity.uid}`).get();
        if (
          !membership.exists ||
          membership.get("tenantId") !== input.tenantId ||
          membership.get("status") !== "active" ||
          !(FEEDBACK_ROLES as readonly string[]).includes(String(membership.get("role")))
        )
          throw new Error("FORBIDDEN");

        // The same submission sent twice (a retry, a double tap) is one piece
        // of feedback: the id comes from who sent it and the key they sent.
        const feedbackId = `fb_${hash(`${identity.uid}:${parsed.idempotencyKey}`).slice(0, 28)}`;
        const reference = db.doc(`feedback/${feedbackId}`);
        const existing = await reference.get();
        if (existing.exists) {
          response.status(200).json({ feedbackId, duplicate: true });
          return;
        }
        if (!(await withinRateLimit(db, identity.uid))) throw new Error("RATE_LIMITED");

        const screenshot = input.screenshot ? decodeScreenshot(input.screenshot) : null;
        const tenant = await db.doc(`tenants/${input.tenantId}`).get();
        const studioName =
          [tenant.get("brandName"), tenant.get("businessName"), tenant.get("name")].find(
            (value): value is string => typeof value === "string" && value.trim().length > 0,
          ) ?? "A studio";
        const userEmail = typeof identity.email === "string" ? identity.email : null;
        const userName =
          (typeof identity.name === "string" && identity.name) ||
          (typeof membership.get("displayName") === "string" ? String(membership.get("displayName")) : null);

        let screenshotPath: string | null = null;
        if (screenshot) {
          const extension = screenshot[0] === 0xff ? "jpg" : screenshot[1] === 0x50 ? "png" : "webp";
          screenshotPath = `feedback/${input.tenantId}/${feedbackId}.${extension}`;
          await getStorage()
            .bucket()
            .file(screenshotPath)
            .save(screenshot, {
              contentType: `image/${extension === "jpg" ? "jpeg" : extension}`,
              resumable: false,
              metadata: { metadata: { feedbackId, tenantId: input.tenantId } },
            });
        }

        const now = new Date().toISOString();
        const kind: FeedbackKind = input.kind;
        const record = {
          id: feedbackId,
          tenantId: input.tenantId,
          studioName,
          userId: identity.uid,
          userEmail,
          userName,
          role: String(membership.get("role")),
          kind,
          message: input.message,
          followUpOk: input.followUpOk,
          route: input.context.route,
          viewport: input.context.viewport,
          userAgent: input.context.userAgent,
          lastError: input.context.lastError,
          screenshotPath,
          status: "received" as FeedbackStatus,
          // The team's inbox state (features/console/inbox.ts).
          triage: "new",
          statusNote: null,
          statusHistory: [{ status: "received", at: now, by: identity.uid, note: null }],
          createdAt: now,
          updatedAt: now,
        };

        const inbox = teamInbox();
        const batch = db.batch();
        batch.create(reference, record);
        const audit = auditEvent({
          tenantId: input.tenantId,
          actorId: identity.uid,
          actorType: "user",
          action: "feedback.submitted",
          entityId: feedbackId,
          before: null,
          after: { kind, screenshot: Boolean(screenshotPath), followUpOk: input.followUpOk },
          correlationId: parsed.idempotencyKey,
          userAgent,
        });
        batch.create(db.doc(`auditEvents/${audit.id}`), audit.data);
        if (inbox) {
          const jobId = `feedback_received_${feedbackId}`;
          batch.create(
            db.doc(`emailJobs/${jobId}`),
            emailJob(jobId, {
              type: "feedback_received",
              recipient: inbox,
              recipientName: "StudioCue team",
              // Hitting reply in the inbox answers the studio directly.
              replyAddress: input.followUpOk && userEmail ? userEmail : null,
              feedbackId,
              feedbackSubject: feedbackSubject(kind, studioName, input.message),
              feedbackKind: kind,
              feedbackMessage: input.message,
              studioName,
              senderName: userName,
              senderEmail: userEmail,
              senderRole: record.role,
              followUpOk: input.followUpOk,
              route: input.context.route,
              viewport: input.context.viewport,
              userAgent: input.context.userAgent,
              lastError: input.context.lastError,
              feedbackScreenshotPath: screenshotPath,
              actionUrl: appUrl(`/platform-admin/inbox?id=${feedbackId}`),
            }),
          );
        } else {
          // Stored either way — the record is the source of truth — but an
          // unset inbox must be visible, not a silent "sent".
          console.error(
            JSON.stringify({ severity: "ERROR", event: "feedback.inbox_not_configured", feedbackId }),
          );
        }
        if (userEmail) {
          const jobId = `feedback_thanks_${feedbackId}`;
          batch.create(
            db.doc(`emailJobs/${jobId}`),
            emailJob(jobId, {
              type: "feedback_thanks",
              recipient: userEmail,
              recipientName: userName,
              replyAddress: teamReplyAddress(),
              feedbackId,
              feedbackKind: kind,
              feedbackMessage: input.message,
              followUpOk: input.followUpOk,
              actionUrl: appUrl("/studio/help#feedback"),
            }),
          );
        }
        await batch.commit();
        response.status(201).json({ feedbackId, duplicate: false });
        return;
      }

      // setFeedbackStatus — the team's triage.
      if (identity.platformAdmin !== true) throw new Error("FORBIDDEN");
      const input = parsed.input;
      const result = await applyFeedbackStatus(db, {
        feedbackId: input.feedbackId,
        status: input.status,
        note: input.note,
        actorUid: identity.uid,
        correlationId: parsed.idempotencyKey,
        userAgent,
      });
      response.status(200).json({ feedbackId: input.feedbackId, status: input.status, ...result });
    } catch (caught: unknown) {
      const message =
        caught instanceof z.ZodError
          ? "INVALID_REQUEST"
          : caught instanceof Error
            ? caught.message
            : "FEEDBACK_FAILED";
      const code = message.split(":")[0] ?? "FEEDBACK_FAILED";
      const status =
        code === "FORBIDDEN"
          ? 403
          : code === "RATE_LIMITED"
            ? 429
            : code === "FEEDBACK_NOT_FOUND"
              ? 404
              : ["APP_CHECK_REQUIRED", "AUTHENTICATION_REQUIRED"].includes(code)
                ? 401
                : 400;
      if (status === 400 && code !== "INVALID_REQUEST" && !code.startsWith("SCREENSHOT_"))
        console.error(JSON.stringify({ severity: "ERROR", event: "feedback.command_failed", detail: message.slice(0, 300) }));
      response.status(status).json({ error: code });
    }
  },
);
