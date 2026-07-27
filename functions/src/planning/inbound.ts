import { createHash, timingSafeEqual } from "node:crypto";
import Busboy from "busboy";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onRequest, type Request } from "firebase-functions/v2/https";
import { z } from "zod";

const inbound = z.object({
  messageId: z.string().min(1).max(500),
  replyToken: z.string().min(20).max(300),
  filename: z.string().min(1).max(255),
  contentType: z.literal("application/pdf"),
  attachment: z.instanceof(Buffer).refine(value => value.length > 0 && value.length <= 15 * 1024 * 1024),
});

type ParsedInbound = z.infer<typeof inbound>;

function equal(a: string | undefined, b: string | undefined) {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function replyToken(value: string) {
  const match = value.match(/coi\+([A-Za-z0-9_-]{20,300})@/i);
  return match?.[1] ?? "";
}

function parseMultipart(request: Request) {
  return new Promise<ParsedInbound>((resolve, reject) => {
    const fields: Record<string, string> = {};
    let filename = "";
    let contentType = "";
    let attachment = Buffer.alloc(0);
    let tooLarge = false;
    const parser = Busboy({
      headers: request.headers,
      limits: { files: 1, fileSize: 15 * 1024 * 1024, fields: 30, fieldSize: 256 * 1024 },
    });
    parser.on("field", (name, value) => { fields[name] = value; });
    parser.on("file", (_name, stream, info) => {
      filename = info.filename;
      contentType = info.mimeType;
      const chunks: Buffer[] = [];
      stream.on("limit", () => { tooLarge = true; });
      stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
      stream.on("end", () => { attachment = Buffer.concat(chunks); });
    });
    parser.on("error", reject);
    parser.on("finish", () => {
      try {
        if (tooLarge) throw new Error("ATTACHMENT_TOO_LARGE");
        const headers = fields.headers ?? "";
        const messageId = headers.match(/^Message-ID:\s*(.+)$/im)?.[1]?.trim()
          ?? createHash("sha256").update(request.rawBody).digest("hex");
        const recipient = fields.to ?? fields.envelope ?? "";
        resolve(inbound.parse({
          messageId,
          replyToken: replyToken(recipient),
          filename,
          contentType,
          attachment,
        }));
      } catch (caught) {
        reject(caught);
      }
    });
    parser.end(request.rawBody);
  });
}

export const sendgridInboundCoi = onRequest({
  cors: false,
  invoker: "public",
  secrets: ["SENDGRID_INBOUND_TOKEN"],
  memory: "512MiB",
  timeoutSeconds: 60,
}, async (request, response) => {
  const sharedToken = String(request.query.token ?? request.header("x-studiohub-inbound-token") ?? "");
  if (request.method !== "POST" || !equal(sharedToken, process.env.SENDGRID_INBOUND_TOKEN)) {
    response.status(401).json({ error: "INVALID_INBOUND_TOKEN" });
    return;
  }
  try {
    const parsed = await parseMultipart(request);
    if (parsed.attachment.subarray(0, 4).toString() !== "%PDF") throw new Error("INVALID_PDF_SIGNATURE");
    const db = getFirestore();
    const tokenHash = createHash("sha256").update(parsed.replyToken).digest("hex");
    const requests = await db.collection("insuranceRequests").where("replyTokenHash", "==", tokenHash).limit(1).get();
    const coi = requests.docs[0];
    if (!coi) {
      response.status(404).json({ error: "REQUEST_NOT_FOUND" });
      return;
    }
    const eventId = `sendgrid_${createHash("sha256").update(parsed.messageId).digest("hex")}`;
    const event = db.doc(`webhookEvents/${eventId}`);
    if ((await event.get()).exists) {
      response.status(204).send();
      return;
    }
    const tenantId = String(coi.get("tenantId"));
    const projectId = String(coi.get("projectId"));
    const objectName = `tenants/${tenantId}/projects/${projectId}/coi/inbound/${coi.id}_${eventId}.pdf`;
    const file = getStorage().bucket().file(objectName);
    await file.save(parsed.attachment, {
      contentType: "application/pdf",
      resumable: false,
      metadata: { metadata: { scanStatus: "pending", tenantId, projectId, coiRequestId: coi.id } },
    });
    const now = new Date().toISOString();
    const batch = db.batch();
    batch.create(event, { tenantId, projectId, provider: "sendgrid", providerEventId: parsed.messageId, status: "processed", createdAt: now });
    batch.update(coi.ref, {
      status: "received",
      inboundMessageId: parsed.messageId,
      receivedAt: now,
      temporaryObject: `gs://${file.bucket.name}/${objectName}`,
      sourceFilename: parsed.filename,
      scanStatus: "pending",
      updatedAt: now,
      updatedBy: "sendgrid-inbound",
    });
    await batch.commit();
    response.status(204).send();
  } catch (caught: unknown) {
    const message = caught instanceof Error ? caught.message : "INVALID_INBOUND_MESSAGE";
    response.status(400).json({ error: message });
  }
});
