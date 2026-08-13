import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { normalizeZoomWebhook } from "./webhook-normalizers.js";

const safeId = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function zoomWebhookSignature(input: {
  timestamp: string;
  rawBody: string;
  secret: string;
}): string {
  return `v0=${createHmac("sha256", input.secret)
    .update(`v0:${input.timestamp}:${input.rawBody}`)
    .digest("hex")}`;
}

function signatureMatches(
  expected: string,
  supplied: string | undefined,
): boolean {
  if (!supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const zoomWebhook = onRequest(
  {
    cors: false,
    invoker: "private",
    secrets: ["ZOOM_WEBHOOK_SECRET_TOKEN"],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
    const timestamp = request.header("x-zm-request-timestamp") ?? "";
    const rawBody = request.rawBody.toString("utf8");
    const timestampSeconds = Number(timestamp);
    if (
      !secret ||
      !Number.isFinite(timestampSeconds) ||
      Math.abs(Date.now() / 1000 - timestampSeconds) > 300 ||
      !signatureMatches(
        zoomWebhookSignature({ timestamp, rawBody, secret }),
        request.header("x-zm-signature"),
      )
    ) {
      response.status(401).json({ error: "INVALID_SIGNATURE" });
      return;
    }

    const payload =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    if (payload.event === "endpoint.url_validation") {
      const eventPayload =
        typeof payload.payload === "object" && payload.payload !== null
          ? (payload.payload as Record<string, unknown>)
          : {};
      const plainToken = String(eventPayload.plainToken ?? "");
      if (!plainToken) {
        response.status(400).json({ error: "INVALID_VALIDATION_PAYLOAD" });
        return;
      }
      response.status(200).json({
        plainToken,
        encryptedToken: createHmac("sha256", secret)
          .update(plainToken)
          .digest("hex"),
      });
      return;
    }

    const event = normalizeZoomWebhook(payload);
    if (!event) {
      response.status(400).json({ error: "UNSUPPORTED_EVENT" });
      return;
    }
    const db = getFirestore();
    const eventReference = db.doc(
      `webhookEvents/zoom_${event.providerEventId}`,
    );
    if ((await eventReference.get()).exists) {
      response.status(200).json({ received: true, duplicate: true });
      return;
    }
    const connections = await db
      .collection("integrationConnections")
      .where("provider", "==", "zoom")
      .where("providerAccountId", "==", event.accountId)
      .limit(1)
      .get();
    const connection = connections.docs[0];
    if (!connection) {
      response.status(404).json({ error: "CONNECTION_NOT_FOUND" });
      return;
    }
    const tenantId = String(connection.get("tenantId"));
    const consultations = await db
      .collection("consultations")
      .where("tenantId", "==", tenantId)
      .where("meetingId", "==", event.meetingId)
      .limit(1)
      .get();
    const consultation = consultations.docs[0] ?? null;
    const now = new Date().toISOString();

    await db.runTransaction(async (transaction) => {
      if ((await transaction.get(eventReference)).exists) return;
      transaction.create(eventReference, {
        id: eventReference.id,
        tenantId,
        projectId: consultation?.get("projectId") ?? null,
        provider: "zoom",
        providerEventId: event.providerEventId,
        payload: event,
        status: consultation ? "processed" : "needs_review",
        createdAt: now,
        receivedAt: now,
      });
      if (!consultation) {
        const actionReference = db.doc(
          `aiActions/zoom_capture_${safeId(`${tenantId}:${event.meetingId}`).slice(0, 32)}`,
        );
        transaction.set(
          actionReference,
          {
            id: actionReference.id,
            tenantId,
            projectId: null,
            title: "Match an unlinked Zoom consultation",
            capability: "consultation_capture_match",
            status: "review_required",
            structuredOutput: {
              meetingId: event.meetingId,
              topic: event.topic,
              endedAt: event.endedAt ?? event.occurredAt,
              nextStep:
                "Confirm whether this meeting belongs to a StudioCue project.",
            },
            sourceReferences: [
              {
                entityType: "webhook_event",
                entityId: eventReference.id,
                versionId: null,
                label: "Signed Zoom event",
                locator: event.event,
              },
            ],
            confidence: { overall: 0.55, label: "medium" },
            validation: {
              status: "warning",
              issues: [
                {
                  code: "PROJECT_MATCH_REQUIRED",
                  severity: "warning",
                  message:
                    "StudioCue did not find a consultation with this Zoom meeting ID.",
                  field: "meetingId",
                },
              ],
            },
            downstreamCommand: null,
            authorityBoundary: "human_match_or_dismiss",
            createdAt: now,
            updatedAt: now,
            createdBy: "zoom-webhook",
            updatedBy: "zoom-webhook",
            archivedAt: null,
          },
          { merge: true },
        );
        return;
      }

      const consultationUpdate: Record<string, unknown> = {
        lastZoomEventId: event.providerEventId,
        lastZoomEventAt: event.occurredAt,
        actualStartedAt: event.startedAt,
        actualEndedAt: event.endedAt ?? event.occurredAt,
        captureState:
          event.event === "meeting.summary_completed"
            ? "summary_queued"
            : "waiting_for_summary",
        updatedAt: now,
        updatedBy: "zoom-webhook",
      };
      transaction.update(consultation.ref, consultationUpdate);
      if (event.event === "meeting.summary_completed") {
        const jobReference = db.doc(
          `providerJobs/zoom_summary_${safeId(`${tenantId}:${event.meetingId}`).slice(0, 32)}`,
        );
        transaction.set(
          jobReference,
          {
            id: jobReference.id,
            tenantId,
            projectId: consultation.get("projectId"),
            consultationId: consultation.id,
            meetingId: event.meetingId,
            meetingUuid: event.meetingUuid,
            type: "capture_zoom_meeting_summary",
            provider: "zoom",
            idempotencyKey: event.providerEventId,
            status: "queued",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
      }
    });
    response.status(200).json({
      received: true,
      linked: Boolean(consultation),
      summaryQueued:
        Boolean(consultation) && event.event === "meeting.summary_completed",
    });
  },
);
