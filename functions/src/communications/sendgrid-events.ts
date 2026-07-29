import { createHash, verify } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";

const eventSchema = z.array(
  z.object({
    event: z.enum([
      "processed",
      "delivered",
      "deferred",
      "bounce",
      "dropped",
      "open",
      "click",
      "spamreport",
      "unsubscribe",
      "group_unsubscribe",
      "group_resubscribe",
    ]),
    timestamp: z.number(),
    sg_event_id: z.string().min(1),
    sg_message_id: z.string().min(1),
    studioHubJobId: z.string().optional(),
    projectId: z.string().optional(),
    reason: z.string().optional(),
    url: z.string().optional(),
  }),
);
function validSignature(
  timestamp: string,
  rawBody: Buffer,
  signature: string,
  publicKey: string,
) {
  try {
    return verify(
      "sha256",
      Buffer.concat([Buffer.from(timestamp), rawBody]),
      publicKey.replaceAll("\\n", "\n"),
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

export const sendgridEventWebhook = onRequest(
  {
    cors: false,
    invoker: "private",
    secrets: ["SENDGRID_WEBHOOK_VERIFICATION_KEY"],
  },
  async (request, response) => {
    const signature = request.header(
      "x-twilio-email-event-webhook-signature",
    );
    const timestamp = request.header(
      "x-twilio-email-event-webhook-timestamp",
    );
    const publicKey = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
    if (
      request.method !== "POST" ||
      !signature ||
      !timestamp ||
      !publicKey ||
      !validSignature(timestamp, request.rawBody, signature, publicKey)
    ) {
      response.status(401).json({ error: "INVALID_SIGNATURE" });
      return;
    }
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "INVALID_PAYLOAD" });
      return;
    }
    const db = getFirestore();
    for (const event of parsed.data) {
      const eventId = `sendgrid_event_${createHash("sha256")
        .update(event.sg_event_id)
        .digest("hex")}`;
      const eventReference = db.doc(`webhookEvents/${eventId}`);
      if ((await eventReference.get()).exists) continue;
      const job = event.studioHubJobId
        ? await db.doc(`emailJobs/${event.studioHubJobId}`).get()
        : (
            await db
              .collection("emailJobs")
              .where("result.messageId", "==", event.sg_message_id)
              .limit(1)
              .get()
          ).docs[0];
      if (!job) continue;
      const tenantId = job.get("tenantId");
      if (typeof tenantId !== "string") continue;
      const occurredAt = new Date(event.timestamp * 1000).toISOString();
      const batch = db.batch();
      batch.create(eventReference, {
        tenantId,
        projectId: event.projectId ?? job.get("projectId") ?? null,
        provider: "sendgrid",
        providerEventId: event.sg_event_id,
        type: event.event,
        payload: {
          messageId: event.sg_message_id,
          reason: event.reason ?? null,
          url: event.url ?? null,
        },
        status: "processed",
        createdAt: new Date().toISOString(),
      });
      batch.update(job.ref, {
        deliveryStatus: event.event,
        lastDeliveryEventAt: occurredAt,
        ...(event.event === "delivered" ? { deliveredAt: occurredAt } : {}),
        ...(event.event === "open" ? { openedAt: occurredAt } : {}),
        ...(event.event === "click" ? { clickedAt: occurredAt } : {}),
        ...(["bounce", "dropped", "spamreport"].includes(event.event)
          ? { deliveryError: event.reason ?? event.event }
          : {}),
        updatedAt: new Date().toISOString(),
      });
      batch.set(
        db.doc(`messages/${job.id}`),
        {
          deliveryStatus: event.event,
          lastDeliveryEventAt: occurredAt,
          ...(event.event === "delivered" ? { deliveredAt: occurredAt } : {}),
          ...(event.event === "open" ? { openedAt: occurredAt } : {}),
          ...(event.event === "click" ? { clickedAt: occurredAt } : {}),
          ...(["bounce", "dropped", "spamreport"].includes(event.event)
            ? { deliveryError: event.reason ?? event.event }
            : {}),
          updatedAt: new Date().toISOString(),
          updatedBy: "sendgrid-event-webhook",
        },
        { merge: true },
      );
      if (
        job.get("type") === "proposal_sent" &&
        typeof job.get("proposalId") === "string" &&
        [
          "processed",
          "delivered",
          "deferred",
          "bounce",
          "dropped",
          "open",
          "click",
        ].includes(event.event)
      ) {
        batch.update(
          db.doc(`proposals/${String(job.get("proposalId"))}`),
          {
            emailDeliveryStatus: event.event,
            updatedAt: new Date().toISOString(),
            updatedBy: "sendgrid-event-webhook",
          },
        );
      }
      await batch.commit();
    }
    response.status(204).send();
  },
);
