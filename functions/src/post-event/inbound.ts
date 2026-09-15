import { createHash, timingSafeEqual } from "node:crypto";
import Busboy from "busboy";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest, type Request } from "firebase-functions/v2/https";
import { productEvent } from "../operations/product-events.js";
import { galleryEvidenceUpdates } from "./gallery-evidence.js";

type InboundFields = Record<string, string>;

function equal(leftValue: string | undefined, rightValue: string | undefined) {
  if (!leftValue || !rightValue) return false;
  const left = Buffer.from(leftValue);
  const right = Buffer.from(rightValue);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseFields(request: Request) {
  return new Promise<InboundFields>((resolve, reject) => {
    const fields: InboundFields = {};
    const parser = Busboy({
      headers: request.headers,
      limits: { fields: 40, fieldSize: 512 * 1024, files: 0 },
    });
    parser.on("field", (name, value) => { fields[name] = value; });
    parser.on("error", reject);
    parser.on("finish", () => resolve(fields));
    parser.end(request.rawBody);
  });
}

function recipient(fields: InboundFields) {
  const envelope = fields.envelope ?? "";
  try {
    const parsed = JSON.parse(envelope) as { to?: unknown };
    if (Array.isArray(parsed.to)) return parsed.to.map(String).join(",");
  } catch {
    // SendGrid also provides a plain `to` field; use it below.
  }
  return fields.to ?? envelope;
}

function tokenFrom(value: string) {
  return value.match(/gallery\+([A-Za-z0-9_-]{20,300})@/i)?.[1] ?? "";
}

function first(source: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const value = source.match(pattern)?.[1]?.trim();
    if (value) return value;
  }
  return "";
}

/**
 * Mail clients wrap links. Gmail rewrites them as google.com/url?q=… and
 * Outlook as …safelinks.protection.outlook.com/?url=…, so a forwarded gallery
 * notice carries the wrapper rather than the gallery. Unwrap before reading.
 */
function unwrapLink(value: string): string {
  try {
    const url = new URL(value.replaceAll("&amp;", "&"));
    const host = url.hostname.toLowerCase();
    const inner =
      (host.endsWith("google.com") && url.pathname === "/url" && (url.searchParams.get("q") || url.searchParams.get("url"))) ||
      (host.endsWith("safelinks.protection.outlook.com") && url.searchParams.get("url")) ||
      "";
    return inner ? unwrapLink(inner) : value;
  } catch {
    return value;
  }
}

const GALLERY_HOSTS = /pixieset|pic-?time|shootproof/i;

function galleryLinkFrom(source: string): string {
  const candidates = [...source.matchAll(/(https:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi)]
    .map((match) => match[1]!.replace(/[),.;!?\]]+$/, ""))
    .map((raw) => (raw.startsWith("https://") ? raw : `https://${raw}`))
    .map(unwrapLink);
  const hostOf = (value: string) => {
    try {
      return new URL(value).hostname;
    } catch {
      return "";
    }
  };
  return (
    candidates.find((value) => GALLERY_HOSTS.test(hostOf(value))) ??
    candidates.find((value) => !/unsubscribe|\.(png|jpe?g|gif)(\?|$)/i.test(value)) ??
    ""
  );
}

/**
 * The access code, from a label that means one. "View gallery: https://…" is
 * not a code — a bare "gallery:" label read "https" as the password.
 */
const ACCESS_CODE_PATTERNS = [
  /\b(?:password|passcode|pin|access\s*code|download\s*(?:code|pin|password)|gallery\s*(?:code|pin|password))\s*[:#-]\s*(?![A-Za-z0-9-]*:\/\/)([A-Z0-9-]{3,24})\b/i,
  // "PIN 4411", without a colon — capitals only, so "pin the date" is not a code.
  /\bPIN\s+([A-Z0-9-]{3,24})\b/,
];

export function parseInboundGalleryAnnouncement(source: string) {
  const normalizedUrl = galleryLinkFrom(source);
  let hostname = "";
  try { hostname = new URL(normalizedUrl).hostname.toLowerCase(); } catch { /* invalid */ }
  const provider = hostname.includes("pixieset")
    ? "pixieset"
    : hostname.includes("pic-time") || hostname.includes("pictime")
      ? "pic_time"
      : hostname.includes("shootproof") ? "shootproof" : "manual";
  const accessCode = first(source, ACCESS_CODE_PATTERNS);
  const expiration = first(source, [
    /(?:expires?|expiration(?: date)?)\s*(?::|on)?\s*(\d{4}-\d{2}-\d{2})/i,
    /(?:expires?|expiration(?: date)?)\s*(?::|on)?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ]);
  const expirationDate = expiration.includes("/")
    ? (() => {
        const [month, day, year] = expiration.split("/");
        return `${year}-${month?.padStart(2, "0")}-${day?.padStart(2, "0")}`;
      })()
    : expiration;
  return { provider, galleryUrl: normalizedUrl, accessCode, expirationDate };
}

export const sendgridInboundGallery = onRequest(
  {
    cors: false,
    invoker: "private",
    secrets: ["SENDGRID_INBOUND_TOKEN"],
    timeoutSeconds: 60,
  },
  async (request, response) => {
    const sharedToken = String(
      request.query.token ?? request.header("x-studiohub-inbound-token") ?? "",
    );
    if (
      request.method !== "POST" ||
      !equal(sharedToken, process.env.SENDGRID_INBOUND_TOKEN)
    ) {
      response.status(401).json({ error: "INVALID_INBOUND_TOKEN" });
      return;
    }
    try {
      const fields = await parseFields(request);
      const token = tokenFrom(recipient(fields));
      if (!token) throw new Error("GALLERY_TOKEN_MISSING");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const db = getFirestore();
      const inboxes = await db.collection("galleryInboxes")
        .where("tokenHash", "==", tokenHash)
        .where("status", "==", "active")
        .limit(1)
        .get();
      const inbox = inboxes.docs[0];
      if (!inbox) {
        response.status(404).json({ error: "GALLERY_INBOX_NOT_FOUND" });
        return;
      }
      const source = [fields.subject, fields.text, fields.html].filter(Boolean).join("\n");
      const parsed = parseInboundGalleryAnnouncement(source);
      if (!parsed.galleryUrl) throw new Error("GALLERY_URL_NOT_FOUND");
      const messageId = fields.headers?.match(/^Message-ID:\s*(.+)$/im)?.[1]?.trim()
        ?? createHash("sha256").update(request.rawBody).digest("hex");
      const eventId = `gallery_${createHash("sha256").update(messageId).digest("hex")}`;
      const eventReference = db.doc(`webhookEvents/${eventId}`);
      if ((await eventReference.get()).exists) {
        response.status(204).send();
        return;
      }
      const tenantId = String(inbox.get("tenantId"));
      const projectId = String(inbox.get("projectId"));
      const draftId = `gallery_draft_${eventId}`;
      const now = new Date().toISOString();
      const productionReference = db.doc(`postProductionRecords/${projectId}`);
      const production = await productionReference.get();
      const batch = db.batch();
      // The email is proof the gallery was culled, edited and published; record
      // that against the job rather than asking the studio to tick it.
      if (production.exists && production.get("tenantId") === tenantId) {
        const evidence = galleryEvidenceUpdates({
          steps: production.get("steps") as Record<string, { complete?: boolean }> | undefined,
          evidenceId: draftId,
          receivedAt: now,
        });
        if (evidence.marked.length) {
          batch.update(productionReference, {
            ...evidence.updates,
            currentStep: evidence.currentStep,
            updatedAt: now,
            updatedBy: "sendgrid-gallery-inbound",
          });
        }
      }
      batch.create(eventReference, {
        tenantId,
        projectId,
        provider: "sendgrid_gallery_inbound",
        providerEventId: messageId,
        status: "processed",
        createdAt: now,
      });
      batch.set(db.doc(`deliveryDrafts/${draftId}`), {
        id: draftId,
        tenantId,
        projectId,
        provider: parsed.provider,
        galleryUrl: parsed.galleryUrl,
        accessCode: parsed.accessCode || null,
        expirationDate: parsed.expirationDate || null,
        status: "review_required",
        source: "gallery_inbound_email",
        sourceSubject: fields.subject ?? null,
        sourceMessageId: messageId,
        receivedAt: now,
        deliveryRecordId: null,
        releasedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: "sendgrid-gallery-inbound",
        updatedBy: "sendgrid-gallery-inbound",
        archivedAt: null,
      }, { merge: false });
      const preparedEvent = productEvent({
        tenantId,
        projectId,
        actorId: "sendgrid-gallery-inbound",
        actorType: "provider",
        name: "delivery.draft_prepared",
        occurredAt: now,
        correlationId: eventId,
        sourceEntityType: "deliveryDraft",
        sourceEntityId: draftId,
        properties: {
          provider: parsed.provider,
          accessCodePresent: Boolean(parsed.accessCode),
          expirationPresent: Boolean(parsed.expirationDate),
        },
      });
      batch.create(db.doc(`productEvents/${preparedEvent.id}`), preparedEvent);
      batch.update(inbox.ref, { lastReceivedAt: now, updatedAt: now });
      batch.set(db.doc(`notifications/gallery_draft_${projectId}`), {
        id: `gallery_draft_${projectId}`,
        tenantId,
        projectId,
        userId: null,
        audience: "studio",
        type: "gallery_ready_for_approval",
        title: "Gallery delivery is ready for approval",
        body: "StudioCue extracted the gallery link and access details from the provider notice.",
        href: `/studio/delivery?project=${encodeURIComponent(projectId)}`,
        readAt: null,
        createdAt: now,
      }, { merge: true });
      await batch.commit();
      response.status(204).send();
    } catch (caught: unknown) {
      response.status(400).json({
        error: caught instanceof Error ? caught.message : "INVALID_GALLERY_MESSAGE",
      });
    }
  },
);
