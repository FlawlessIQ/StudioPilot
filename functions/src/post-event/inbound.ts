import { createHash, timingSafeEqual } from "node:crypto";
import Busboy from "busboy";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest, type Request } from "firebase-functions/v2/https";
import { productEvent } from "../operations/product-events.js";
import { calendarDate } from "../operations/calendar-date.js";
import { galleryEvidenceUpdates } from "./gallery-evidence.js";
import { kindDefaults, defaultKindFor, type DeliverableKind } from "./deliverables.js";
import { linkHost } from "./link-host.js";

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

/** A link at a host we know delivers work: a gallery, a film, a file transfer. */
function isDeliveryHost(value: string): boolean {
  return linkHost(value).host !== "other";
}

/**
 * Tracking redirects that say nothing about where they go: SendGrid, Mailchimp,
 * Mandrill, Mailgun, HubSpot. Providers send notices through these, and the
 * parser used to take the redirect — or a logo — as "the gallery" (V3).
 */
const OPAQUE_TRACKERS =
  /(^|\.)(list-manage\.com|mandrillapp\.com|mailgun\.org|hubspotlinks\.com|sendgrid\.net|ct\.sendgrid\.net|mailchi\.mp)$|^(url\d+|click|links?|email|e|track|trk)\./i;

export function isOpaqueTracker(value: string): boolean {
  try {
    const url = new URL(value);
    return OPAQUE_TRACKERS.test(url.hostname) || /\/ls\/click|\/track\/click|\/wf\/click/i.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Where a tracking link lands, by following its redirects — a few hops, a few
 * seconds, and never the body. Stops at the first host that delivers work.
 */
export async function followTrackedLink(value: string, fetcher: typeof fetch = fetch): Promise<string> {
  let current = value;
  for (let hop = 0; hop < 4; hop += 1) {
    if (isDeliveryHost(current) || !isOpaqueTracker(current)) return current;
    let response: Response;
    try {
      response = await fetcher(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      return current;
    }
    const next = response.headers.get("location");
    if (!next) return current;
    try {
      current = unwrapLink(new URL(next, current).toString());
    } catch {
      return current;
    }
  }
  return current;
}

/**
 * What arrived: a sneak peek, a teaser, a highlight film, a full film, the
 * gallery. The words in the notice decide first, then what the link points at.
 * Only a photo gallery counts as evidence the photos were culled and edited —
 * a sneak peek or a film teaser used to open the delivery gate early (V6).
 */
export function classifyAnnouncement(source: string, mediaType: string): DeliverableKind {
  const words = source.toLowerCase();
  if (/sneak\s*peek/.test(words)) return "sneak_peek";
  if (/\bteaser\b|\btrailer\b/.test(words)) return "teaser";
  if (mediaType === "video" || /\bfilm\b|\bvideo\b/.test(words)) {
    if (/full[\s-]*(length\s*)?film|feature\s*film|documentary/.test(words)) return "full_film";
    if (/highlight/.test(words) || mediaType === "video") return "highlight_film";
  }
  return defaultKindFor(mediaType);
}

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
    candidates.find((value) => isDeliveryHost(value)) ??
    // A tracked link is still a better guess than a logo, and it is followed
    // before the draft is written.
    candidates.find((value) => isOpaqueTracker(value) && !/unsubscribe|preferences|optout/i.test(value)) ??
    candidates.find((value) => hostOf(value) && !/unsubscribe|\.(png|jpe?g|gif|svg)(\?|$)/i.test(value)) ??
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
  const host = linkHost(normalizedUrl);
  const provider = host.host === "other" ? (hostname ? "manual" : "manual") : host.host;
  const accessCode = first(source, ACCESS_CODE_PATTERNS);
  /**
   * How long they have to download, however the provider said it. Digits-only
   * patterns missed "Downloads expire: 20 December 2026" and "available until
   * December 20, 2026", which is how these notices are actually written;
   * `calendarDate` reads written months.
   */
  const expiration = first(source, [
    /(?:expires?|expiration(?: date)?|available until|download(?:s|ing)? (?:until|through|by))\s*(?::|on)?\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4}|[0-9]{1,2}\s+[A-Za-z]+,?\s+[0-9]{4}|[A-Za-z]+\s+[0-9]{1,2},?\s+[0-9]{4})/i,
  ]);
  const expirationDate = calendarDate(expiration) ?? "";
  const mediaType = host.mediaType === "other" ? "photo" : host.mediaType;
  const kind = classifyAnnouncement(source, mediaType);
  return { provider, galleryUrl: normalizedUrl, accessCode, expirationDate, mediaType, kind };
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
      const first = parseInboundGalleryAnnouncement(source);
      if (!first.galleryUrl) throw new Error("GALLERY_URL_NOT_FOUND");
      // A tracking redirect is followed to where it lands, then read again.
      const landed = isOpaqueTracker(first.galleryUrl) ? await followTrackedLink(first.galleryUrl) : first.galleryUrl;
      const landedHost = linkHost(landed);
      const parsed =
        landed === first.galleryUrl
          ? first
          : {
              ...first,
              galleryUrl: landed,
              provider: landedHost.host === "other" ? "manual" : landedHost.host,
              mediaType: landedHost.mediaType === "other" ? first.mediaType : landedHost.mediaType,
              kind: classifyAnnouncement(source, landedHost.mediaType === "other" ? first.mediaType : landedHost.mediaType),
            };
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
      if (production.exists && production.get("tenantId") === tenantId && parsed.kind === "gallery") {
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
        mediaType: parsed.mediaType,
        kind: parsed.kind,
        label: kindDefaults(parsed.kind).label,
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
        title: `${kindDefaults(parsed.kind).label} is ready for approval`,
        body: "StudioCue read the link and access details from the provider's notice.",
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
