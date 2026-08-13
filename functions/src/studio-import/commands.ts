import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { resolve4, resolve6 } from "node:dns/promises";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { productEvent } from "../operations/product-events.js";
import { consumeAiQuota } from "../saas/usage.js";
import { studioHubCors } from "../security/cors.js";
import {
  studioImportMaxFiles,
  studioImportObjectPath,
  validateStudioImportMetadata,
} from "./domain.js";
import { studioAssetTypes } from "./extraction.js";
import {
  activateStudioImport,
  mergeStudioImportDrafts,
  readStudioImportReview,
  reviewStudioImportDraft,
  rollbackStudioAsset,
  simulateStudioImportSession,
  splitStudioImportDraft,
} from "./review.js";

const fileInputSchema = z.object({
  clientId: z.string().min(1).max(240),
  name: z.string().trim().min(1).max(240),
  sizeBytes: z.number().int().positive(),
  contentType: z.string().max(160),
  lastModifiedAt: z.string().datetime().nullable(),
});

const sourceInputSchema = z
  .object({
    sourceType: z.enum(["email_text", "website"]),
    name: z.string().trim().min(1).max(240),
    content: z.string().trim().min(20).max(120_000).optional(),
    url: z.string().url().max(2_048).optional(),
  })
  .superRefine((value, context) => {
    if (value.sourceType === "email_text" && !value.content) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "Email content is required.",
      });
    }
    if (value.sourceType === "website" && !value.url) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "A public page URL is required.",
      });
    }
  });

const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("createSession"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(240),
    input: z.object({
      files: z.array(fileInputSchema).min(1).max(studioImportMaxFiles),
    }),
  }),
  z.object({
    type: z.literal("createSourceSession"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(240),
    input: sourceInputSchema,
  }),
  z.object({
    type: z.literal("getSession"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(240),
    input: z.object({ sessionId: z.string().min(1).max(240) }),
  }),
  z.object({
    type: z.literal("getReview"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(240),
    input: z.object({ sessionId: z.string().min(1).max(240) }),
  }),
  z.object({
    type: z.literal("simulateSession"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(240),
    input: z.object({ sessionId: z.string().min(1).max(240) }),
  }),
  z.object({
    type: z.literal("reviewDraft"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(240),
    input: z.object({
      sessionId: z.string().min(1).max(240),
      versionId: z.string().min(1).max(240),
      action: z.enum(["approve", "reject", "ignore", "update"]),
      name: z.string().trim().min(1).max(240).optional(),
      assetType: z.enum(studioAssetTypes).optional(),
      structuredContent: z.record(z.string(), z.unknown()).optional(),
      confirmClassification: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal("splitDraft"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(240),
    input: z.object({
      sessionId: z.string().min(1).max(240),
      versionId: z.string().min(1).max(240),
      parts: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(240),
            assetType: z.enum(studioAssetTypes),
            structuredContent: z.record(z.string(), z.unknown()),
          }),
        )
        .min(2)
        .max(8),
    }),
  }),
  z.object({
    type: z.literal("mergeDrafts"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(240),
    input: z.object({
      sessionId: z.string().min(1).max(240),
      targetVersionId: z.string().min(1).max(240),
      sourceVersionId: z.string().min(1).max(240),
    }),
  }),
  z.object({
    type: z.literal("activateSession"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(240),
    input: z.object({ sessionId: z.string().min(1).max(240) }),
  }),
  z.object({
    type: z.literal("rollbackAsset"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(240),
    input: z.object({
      assetId: z.string().min(1).max(240),
      targetVersionId: z.string().min(1).max(240),
    }),
  }),
  z.object({
    type: z.literal("cancelSession"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(240),
    input: z.object({ sessionId: z.string().min(1).max(240) }),
  }),
  z.object({
    type: z.literal("retryItem"),
    tenantId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(240),
    input: z.object({
      sessionId: z.string().min(1).max(240),
      itemId: z.string().min(1).max(240),
    }),
  }),
]);

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const stable = (scope: string, tenantId: string, key: string) =>
  `${scope}_${hash(`${tenantId}:${key}`).slice(0, 32)}`;
const uploadId = () => randomBytes(12).toString("hex");

export function isPrivateStudioImportAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (isIP(normalized) === 4) {
    const octets = normalized.split(".").map(Number);
    const a = octets[0] ?? -1;
    const b = octets[1] ?? -1;
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (isIP(normalized) === 6) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }
  return true;
}

async function assertPublicPageUrl(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error("IMPORT_WEBSITE_URL_NOT_PUBLIC");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal" ||
    isIP(hostname) > 0
  ) {
    throw new Error("IMPORT_WEBSITE_URL_NOT_PUBLIC");
  }
  const addresses = [
    ...(await resolve4(hostname).catch(() => [])),
    ...(await resolve6(hostname).catch(() => [])),
  ];
  if (!addresses.length || addresses.some(isPrivateStudioImportAddress)) {
    throw new Error("IMPORT_WEBSITE_URL_NOT_PUBLIC");
  }
  return url;
}

export function studioImportPageText(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const withoutNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(?:br|hr)\b[^>]*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|section|article|tr|label)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return `${title}\n${withoutNoise}`
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/[\t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 120_000);
}

export function hasUnreadableEmbeddedStudioImportForm(html: string): boolean {
  const withoutExecutableMarkup = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  return Array.from(withoutExecutableMarkup.matchAll(/<iframe\b[^>]*>/gi)).some(
    ([iframe]) =>
      /(?:title|aria-label|src)=["'][^"']*(?:\bform\b|formbuilder|form-builder|123formbuilder|jotform|typeform|wufoo|formstack|cognitoforms|docs\.google\.com\/forms)[^"']*["']/i.test(
        iframe,
      ),
  );
}

async function fetchPublicPageText(rawUrl: string): Promise<{
  finalUrl: string;
  text: string;
}> {
  let url = await assertPublicPageUrl(rawUrl);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,text/plain;q=0.9",
        "user-agent": "StudioCue-Importer/1.0",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("IMPORT_WEBSITE_FETCH_FAILED");
      url = await assertPublicPageUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      throw new Error(`IMPORT_WEBSITE_FETCH_FAILED:${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/(?:text\/html|text\/plain|application\/xhtml\+xml)/i.test(contentType)) {
      throw new Error("IMPORT_WEBSITE_CONTENT_UNSUPPORTED");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > 750_000) throw new Error("IMPORT_WEBSITE_TOO_LARGE");
    const html = (await response.text()).slice(0, 750_000);
    const text = studioImportPageText(html);
    if (hasUnreadableEmbeddedStudioImportForm(html)) {
      throw new Error("IMPORT_EMBEDDED_FORM_UNREADABLE");
    }
    if (text.length < 20) throw new Error("IMPORT_WEBSITE_NO_READABLE_CONTENT");
    return { finalUrl: url.toString(), text };
  }
  throw new Error("IMPORT_WEBSITE_TOO_MANY_REDIRECTS");
}

async function requireStudioOwnerOrAdmin(
  db: Firestore,
  tenantId: string,
  userId: string,
): Promise<"studio_owner" | "studio_admin"> {
  const membership = await db
    .doc(`memberships/${tenantId}_${userId}`)
    .get();
  if (
    !membership.exists ||
    membership.get("tenantId") !== tenantId ||
    membership.get("status") !== "active" ||
    !["studio_owner", "studio_admin"].includes(
      String(membership.get("role")),
    )
  ) {
    throw new Error("FORBIDDEN");
  }
  return membership.get("role") as "studio_owner" | "studio_admin";
}

function itemResult(data: FirebaseFirestore.DocumentData) {
  return {
    id: String(data.id),
    clientId: String(data.clientId),
    name: String(data.name),
    sizeBytes: Number(data.sizeBytes),
    contentType: String(data.contentType),
    status: String(data.status),
    expectedObjectName:
      data.status === "awaiting_upload"
        ? String(data.expectedObjectName)
        : null,
    uploadId:
      data.status === "awaiting_upload" ? String(data.uploadId) : null,
    retryCount: Number(data.retryCount ?? 0),
    safety: data.safety ?? null,
    classification: data.classification ?? null,
    draftVersionIds: Array.isArray(data.draftVersionIds)
      ? data.draftVersionIds
      : [],
    duplicate: data.duplicate ?? null,
    failure: data.failure ?? null,
  };
}

async function readSession(
  db: Firestore,
  tenantId: string,
  sessionId: string,
) {
  const session = await db.doc(`studioImportSessions/${sessionId}`).get();
  if (!session.exists || session.get("tenantId") !== tenantId) {
    throw new Error("IMPORT_SESSION_NOT_FOUND");
  }
  const itemIds = session.get("itemIds");
  if (!Array.isArray(itemIds)) throw new Error("IMPORT_SESSION_INVALID");
  const items = await Promise.all(
    itemIds.map((itemId) =>
      db.doc(`studioImportItems/${String(itemId)}`).get(),
    ),
  );
  if (
    items.some(
      (item) =>
        !item.exists ||
        item.get("tenantId") !== tenantId ||
        item.get("sessionId") !== sessionId,
    )
  ) {
    throw new Error("IMPORT_SESSION_INVALID");
  }
  return {
    session: {
      id: session.id,
      status: String(session.get("status")),
      itemCount: Number(session.get("itemCount")),
      totalBytes: Number(session.get("totalBytes")),
      createdAt: String(session.get("createdAt")),
      updatedAt: String(session.get("updatedAt")),
      cancelledAt: session.get("cancelledAt") ?? null,
    },
    items: items.map((item) =>
      itemResult({ id: item.id, ...item.data() }),
    ),
  };
}

export const studioImportCommand = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
    timeoutSeconds: 120,
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
      const parsed = commandSchema.parse(request.body);
      const db = getFirestore();
      await requireStudioOwnerOrAdmin(db, parsed.tenantId, identity.uid);

      if (parsed.type === "getSession") {
        response.status(200).json(
          await readSession(db, parsed.tenantId, parsed.input.sessionId),
        );
        return;
      }
      if (parsed.type === "getReview") {
        response.status(200).json(
          await readStudioImportReview(
            parsed.tenantId,
            parsed.input.sessionId,
          ),
        );
        return;
      }
      if (parsed.type === "simulateSession") {
        response.status(200).json(
          await simulateStudioImportSession(
            parsed.tenantId,
            parsed.input.sessionId,
          ),
        );
        return;
      }

      const executionId = stable(
        `studio_import_${parsed.type}`,
        parsed.tenantId,
        parsed.idempotencyKey,
      );
      const execution = db.doc(`commandExecutions/${executionId}`);
      const prior = await execution.get();
      if (prior.exists) {
        response.status(200).json(prior.get("result"));
        return;
      }
      const now = new Date().toISOString();

      if (parsed.type === "reviewDraft") {
        response.status(200).json(
          await reviewStudioImportDraft({
            tenantId: parsed.tenantId,
            sessionId: parsed.input.sessionId,
            versionId: parsed.input.versionId,
            actorId: identity.uid,
            action: parsed.input.action,
            name: parsed.input.name,
            assetType: parsed.input.assetType,
            structuredContent: parsed.input.structuredContent,
            confirmClassification: parsed.input.confirmClassification,
            executionId,
          }),
        );
        return;
      }
      if (parsed.type === "splitDraft") {
        response.status(200).json(
          await splitStudioImportDraft({
            tenantId: parsed.tenantId,
            sessionId: parsed.input.sessionId,
            versionId: parsed.input.versionId,
            actorId: identity.uid,
            parts: parsed.input.parts,
            executionId,
          }),
        );
        return;
      }
      if (parsed.type === "mergeDrafts") {
        response.status(200).json(
          await mergeStudioImportDrafts({
            tenantId: parsed.tenantId,
            sessionId: parsed.input.sessionId,
            targetVersionId: parsed.input.targetVersionId,
            sourceVersionId: parsed.input.sourceVersionId,
            actorId: identity.uid,
            executionId,
          }),
        );
        return;
      }
      if (parsed.type === "activateSession") {
        response.status(200).json(
          await activateStudioImport({
            tenantId: parsed.tenantId,
            sessionId: parsed.input.sessionId,
            actorId: identity.uid,
            executionId,
          }),
        );
        return;
      }
      if (parsed.type === "rollbackAsset") {
        response.status(200).json(
          await rollbackStudioAsset({
            tenantId: parsed.tenantId,
            assetId: parsed.input.assetId,
            targetVersionId: parsed.input.targetVersionId,
            actorId: identity.uid,
            executionId,
          }),
        );
        return;
      }

      if (parsed.type === "createSourceSession") {
        const source =
          parsed.input.sourceType === "website"
            ? await fetchPublicPageText(String(parsed.input.url))
            : {
                finalUrl: null,
                text: String(parsed.input.content).trim().slice(0, 120_000),
              };
        const sessionId = stable(
          "studio_import_session",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        const itemId = stable(
          "studio_import_item",
          parsed.tenantId,
          `${sessionId}:source`,
        );
        const checksum = hash(source.text);
        const item = {
          id: itemId,
          clientId: "source",
          tenantId: parsed.tenantId,
          sessionId,
          sourceType: parsed.input.sourceType,
          sourceUrl: source.finalUrl,
          sourceText: source.text,
          name: parsed.input.name,
          extension: "txt",
          contentType: "text/plain",
          sizeBytes: Buffer.byteLength(source.text, "utf8"),
          lastModifiedAt: null,
          sha256: checksum,
          storageProvider: null,
          storageObjectKey: null,
          bucket: null,
          generation: null,
          status: "ready_for_analysis",
          retryCount: 0,
          safety: {
            signatureVerifiedAt: now,
            malwareScanStatus: "passed",
            malwareScannedAt: now,
            rejectionCode: null,
          },
          classification: null,
          draftVersionIds: [],
          duplicate: null,
          failure: null,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        };
        const session = {
          id: sessionId,
          tenantId: parsed.tenantId,
          sourceMode: parsed.input.sourceType,
          status: "processing",
          idempotencyKey: parsed.idempotencyKey,
          itemIds: [itemId],
          itemCount: 1,
          totalBytes: item.sizeBytes,
          approvedItemIds: [],
          ignoredItemIds: [],
          activatedAssetVersionIds: [],
          safetySummary: { pending: 0, clean: 1, rejected: 0, failed: 0 },
          reviewReadyAt: null,
          approvedAt: null,
          activatedAt: null,
          cancelledAt: null,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        };
        const result = {
          session: {
            id: session.id,
            status: session.status,
            itemCount: session.itemCount,
            totalBytes: session.totalBytes,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            cancelledAt: null,
          },
          items: [itemResult(item)],
        };
        const job = db.doc(`aiJobs/studio_import_${itemId}`);
        const committed = await db.runTransaction(async (transaction) => {
          const current = await transaction.get(execution);
          if (current.exists) return current.get("result") as typeof result;
          await consumeAiQuota(transaction, db, parsed.tenantId, now);
          transaction.create(db.doc(`studioImportSessions/${sessionId}`), session);
          transaction.create(db.doc(`studioImportItems/${itemId}`), item);
          transaction.create(job, {
            id: job.id,
            tenantId: parsed.tenantId,
            sessionId,
            itemId,
            type: "studio_import_extraction",
            status: "queued",
            attempts: 0,
            humanReviewRequired: true,
            createdAt: now,
            updatedAt: now,
          });
          transaction.create(db.doc(`auditEvents/${executionId}`), {
            id: executionId,
            tenantId: parsed.tenantId,
            actorId: identity.uid,
            actorType: "user",
            action: "studio_import.source_session_created",
            entityType: "studioImportSession",
            entityId: sessionId,
            timestamp: now,
            before: null,
            after: {
              status: session.status,
              itemCount: 1,
              totalBytes: session.totalBytes,
              sourceMode: session.sourceMode,
            },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId: executionId,
            automationRunId: null,
            providerEventId: null,
          });
          const event = productEvent({
            tenantId: parsed.tenantId,
            actorId: identity.uid,
            name: "studio_import.session_created",
            occurredAt: now,
            correlationId: executionId,
            sourceEntityType: "studioImportSession",
            sourceEntityId: sessionId,
            properties: {
              itemCount: 1,
              totalBytes: session.totalBytes,
              sourceMode: session.sourceMode,
            },
          });
          transaction.create(db.doc(`productEvents/${event.id}`), event);
          transaction.create(execution, {
            id: executionId,
            tenantId: parsed.tenantId,
            type: parsed.type,
            status: "succeeded",
            result,
            createdAt: now,
            updatedAt: now,
          });
          return result;
        });
        response.status(200).json(committed);
        return;
      }

      if (parsed.type === "createSession") {
        const clientIds = new Set<string>();
        const prepared = parsed.input.files.map((file) => {
          if (clientIds.has(file.clientId)) {
            throw new Error("DUPLICATE_IMPORT_SOURCE");
          }
          clientIds.add(file.clientId);
          const validated = validateStudioImportMetadata(file);
          return { ...file, ...validated };
        });
        const sessionId = stable(
          "studio_import_session",
          parsed.tenantId,
          parsed.idempotencyKey,
        );
        const items = prepared.map((file) => {
          const itemId = stable(
            "studio_import_item",
            parsed.tenantId,
            `${sessionId}:${file.clientId}`,
          );
          const nextUploadId = uploadId();
          return {
            id: itemId,
            clientId: file.clientId,
            tenantId: parsed.tenantId,
            sessionId,
            sourceType: "file",
            name: file.name,
            extension: file.extension,
            contentType: file.contentType,
            sizeBytes: file.sizeBytes,
            lastModifiedAt: file.lastModifiedAt,
            sha256: null,
            status: "awaiting_upload",
            uploadId: nextUploadId,
            expectedObjectName: studioImportObjectPath({
              tenantId: parsed.tenantId,
              sessionId,
              itemId,
              uploadId: nextUploadId,
              extension: file.extension,
            }),
            generation: null,
            retryCount: 0,
            safety: {
              signatureVerifiedAt: null,
              malwareScanStatus: "pending",
              malwareScannedAt: null,
              rejectionCode: null,
            },
            classification: null,
            failure: null,
            createdAt: now,
            updatedAt: now,
            createdBy: identity.uid,
            updatedBy: identity.uid,
            archivedAt: null,
          };
        });
        const session = {
          id: sessionId,
          tenantId: parsed.tenantId,
          sourceMode: "files",
          status: "awaiting_upload",
          idempotencyKey: parsed.idempotencyKey,
          itemIds: items.map((item) => item.id),
          itemCount: items.length,
          totalBytes: items.reduce(
            (sum, item) => sum + item.sizeBytes,
            0,
          ),
          approvedItemIds: [],
          ignoredItemIds: [],
          activatedAssetVersionIds: [],
          safetySummary: {
            pending: items.length,
            clean: 0,
            rejected: 0,
            failed: 0,
          },
          reviewReadyAt: null,
          approvedAt: null,
          activatedAt: null,
          cancelledAt: null,
          createdAt: now,
          updatedAt: now,
          createdBy: identity.uid,
          updatedBy: identity.uid,
          archivedAt: null,
        };
        const result = {
          session: {
            id: session.id,
            status: session.status,
            itemCount: session.itemCount,
            totalBytes: session.totalBytes,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            cancelledAt: null,
          },
          items: items.map(itemResult),
        };
        const committed = await db.runTransaction(async (transaction) => {
          const current = await transaction.get(execution);
          if (current.exists) {
            return current.get("result") as typeof result;
          }
          transaction.create(
            db.doc(`studioImportSessions/${sessionId}`),
            session,
          );
          for (const item of items) {
            transaction.create(
              db.doc(`studioImportItems/${item.id}`),
              item,
            );
          }
          transaction.create(db.doc(`auditEvents/${executionId}`), {
            id: executionId,
            tenantId: parsed.tenantId,
            actorId: identity.uid,
            actorType: "user",
            action: "studio_import.session_created",
            entityType: "studioImportSession",
            entityId: sessionId,
            timestamp: now,
            before: null,
            after: {
              status: session.status,
              itemCount: session.itemCount,
              totalBytes: session.totalBytes,
            },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId: executionId,
            automationRunId: null,
            providerEventId: null,
          });
          const event = productEvent({
            tenantId: parsed.tenantId,
            actorId: identity.uid,
            name: "studio_import.session_created",
            occurredAt: now,
            correlationId: executionId,
            sourceEntityType: "studioImportSession",
            sourceEntityId: sessionId,
            properties: {
              itemCount: session.itemCount,
              totalBytes: session.totalBytes,
              sourceMode: session.sourceMode,
            },
          });
          transaction.create(db.doc(`productEvents/${event.id}`), event);
          transaction.create(execution, {
            id: executionId,
            tenantId: parsed.tenantId,
            type: parsed.type,
            status: "succeeded",
            result,
            createdAt: now,
            updatedAt: now,
          });
          return result;
        });
        response.status(200).json(committed);
        return;
      }

      if (parsed.type === "cancelSession") {
        const result = await db.runTransaction(async (transaction) => {
          const sessionReference = db.doc(
            `studioImportSessions/${parsed.input.sessionId}`,
          );
          const [session, currentExecution] = await Promise.all([
            transaction.get(sessionReference),
            transaction.get(execution),
          ]);
          if (currentExecution.exists) {
            return currentExecution.get("result") as {
              sessionId: string;
              status: string;
            };
          }
          if (
            !session.exists ||
            session.get("tenantId") !== parsed.tenantId
          ) {
            throw new Error("IMPORT_SESSION_NOT_FOUND");
          }
          if (session.get("status") === "activated") {
            throw new Error("ACTIVATED_IMPORT_CANNOT_BE_CANCELLED");
          }
          const itemIds = session.get("itemIds");
          if (!Array.isArray(itemIds)) {
            throw new Error("IMPORT_SESSION_INVALID");
          }
          transaction.update(sessionReference, {
            status: "cancelled",
            cancelledAt: now,
            updatedAt: now,
            updatedBy: identity.uid,
          });
          for (const itemId of itemIds) {
            transaction.update(
              db.doc(`studioImportItems/${String(itemId)}`),
              {
                status: "cancelled",
                updatedAt: now,
                updatedBy: identity.uid,
              },
            );
          }
          const value = {
            sessionId: parsed.input.sessionId,
            status: "cancelled",
          };
          transaction.create(execution, {
            id: executionId,
            tenantId: parsed.tenantId,
            type: parsed.type,
            status: "succeeded",
            result: value,
            createdAt: now,
            updatedAt: now,
          });
          transaction.create(db.doc(`auditEvents/${executionId}`), {
            id: executionId,
            tenantId: parsed.tenantId,
            actorId: identity.uid,
            actorType: "user",
            action: "studio_import.session_cancelled",
            entityType: "studioImportSession",
            entityId: parsed.input.sessionId,
            timestamp: now,
            before: { status: String(session.get("status")) },
            after: { status: "cancelled" },
            ipAddress: null,
            userAgent: request.header("user-agent") ?? null,
            correlationId: executionId,
            automationRunId: null,
            providerEventId: null,
          });
          return value;
        });
        response.status(200).json(result);
        return;
      }

      const result = await db.runTransaction(async (transaction) => {
        const sessionReference = db.doc(
          `studioImportSessions/${parsed.input.sessionId}`,
        );
        const itemReference = db.doc(
          `studioImportItems/${parsed.input.itemId}`,
        );
        const [session, item, currentExecution] = await Promise.all([
          transaction.get(sessionReference),
          transaction.get(itemReference),
          transaction.get(execution),
        ]);
        if (currentExecution.exists) {
          return currentExecution.get("result") as {
            itemId: string;
            status: string;
            uploadId: string;
            expectedObjectName: string;
            retryCount: number;
          };
        }
        if (
          !session.exists ||
          session.get("tenantId") !== parsed.tenantId ||
          !item.exists ||
          item.get("tenantId") !== parsed.tenantId ||
          item.get("sessionId") !== parsed.input.sessionId
        ) {
          throw new Error("IMPORT_ITEM_NOT_FOUND");
        }
        if (session.get("status") === "cancelled") {
          throw new Error("IMPORT_SESSION_CANCELLED");
        }
        const retryCount = Number(item.get("retryCount") ?? 0);
        const failure = item.get("failure") as
          | { retryable?: unknown }
          | null;
        if (
          !["failed", "rejected"].includes(String(item.get("status"))) ||
          failure?.retryable !== true ||
          retryCount >= 3
        ) {
          throw new Error("IMPORT_ITEM_NOT_RETRYABLE");
        }
        const nextUploadId = uploadId();
        const nextObjectName = studioImportObjectPath({
          tenantId: parsed.tenantId,
          sessionId: parsed.input.sessionId,
          itemId: parsed.input.itemId,
          uploadId: nextUploadId,
          extension: String(item.get("extension")),
        });
        transaction.update(itemReference, {
          status: "awaiting_upload",
          uploadId: nextUploadId,
          expectedObjectName: nextObjectName,
          generation: null,
          retryCount: retryCount + 1,
          safety: {
            signatureVerifiedAt: null,
            malwareScanStatus: "pending",
            malwareScannedAt: null,
            rejectionCode: null,
          },
          failure: null,
          updatedAt: now,
          updatedBy: identity.uid,
        });
        transaction.update(sessionReference, {
          status: "awaiting_upload",
          updatedAt: now,
          updatedBy: identity.uid,
        });
        const value = {
          itemId: parsed.input.itemId,
          status: "awaiting_upload",
          uploadId: nextUploadId,
          expectedObjectName: nextObjectName,
          retryCount: retryCount + 1,
        };
        transaction.create(execution, {
          id: executionId,
          tenantId: parsed.tenantId,
          type: parsed.type,
          status: "succeeded",
          result: value,
          createdAt: now,
          updatedAt: now,
        });
        transaction.create(db.doc(`auditEvents/${executionId}`), {
          id: executionId,
          tenantId: parsed.tenantId,
          actorId: identity.uid,
          actorType: "user",
          action: "studio_import.item_retried",
          entityType: "studioImportItem",
          entityId: parsed.input.itemId,
          timestamp: now,
          before: {
            status: String(item.get("status")),
            retryCount,
          },
          after: {
            status: "awaiting_upload",
            retryCount: retryCount + 1,
          },
          ipAddress: null,
          userAgent: request.header("user-agent") ?? null,
          correlationId: executionId,
          automationRunId: null,
          providerEventId: null,
        });
        return value;
      });
      response.status(200).json(result);
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "STUDIO_IMPORT_FAILED";
      const code = message.split(":")[0] ?? "STUDIO_IMPORT_FAILED";
      response
        .status(
          code === "FORBIDDEN"
            ? 403
            : code.includes("NOT_FOUND")
              ? 404
              : 400,
        )
        .json({ error: code });
    }
  },
);
