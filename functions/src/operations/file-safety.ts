import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import { consumeAiQuota } from "../saas/usage.js";
import {
  studioImportMaxFileBytes,
  verifyStudioImportFileSignature,
} from "../studio-import/domain.js";

type ScanResult = {
  status: "clean" | "infected" | "rejected";
  engine: string;
  detail: string | null;
};

async function identityToken(audience: string) {
  const response = await fetch(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`,
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!response.ok) throw new Error("FILE_SCANNER_IDENTITY_UNAVAILABLE");
  return response.text();
}

async function scanObject(input: {
  service: string;
  bucket: string;
  objectName: string;
  contentType: string;
  maxBytes: number;
}): Promise<ScanResult> {
  const audience = input.service.replace(/\/$/, "");
  const token = await identityToken(audience);
  const response = await fetch(`${audience}/v1/scan`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      bucket: input.bucket,
      object_name: input.objectName,
      expected_content_type: input.contentType,
      max_bytes: input.maxBytes,
    }),
  });
  const result = (await response.json()) as {
    status?: string;
    engine?: string;
    detail?: string;
  };
  if (!response.ok && response.status >= 500) {
    throw new Error(result.detail ?? "FILE_SCANNER_UNAVAILABLE");
  }
  return {
    status:
      response.ok && result.status === "clean"
        ? "clean"
        : result.status === "infected"
          ? "infected"
          : "rejected",
    engine: result.engine ?? "file-safety",
    detail: result.detail ?? null,
  };
}

async function refreshImportSession(sessionId: string, now: string) {
  const db = getFirestore();
  const reference = db.doc(`studioImportSessions/${sessionId}`);
  const session = await reference.get();
  if (!session.exists || session.get("status") === "cancelled") return;
  const itemIds = session.get("itemIds");
  if (!Array.isArray(itemIds)) return;
  const items = await Promise.all(
    itemIds.map((itemId) =>
      db.doc(`studioImportItems/${String(itemId)}`).get(),
    ),
  );
  const statuses = items.map((item) => String(item.get("status")));
  const clean = statuses.filter(
    (status) => status === "ready_for_analysis",
  ).length;
  const rejected = statuses.filter((status) => status === "rejected").length;
  const failed = statuses.filter((status) => status === "failed").length;
  const pending = statuses.length - clean - rejected - failed;
  const finishedSafety = pending === 0;
  const status =
    failed + rejected === statuses.length
      ? "failed"
      : finishedSafety && failed + rejected > 0
        ? "partially_failed"
        : "processing";
  await reference.update({
    status,
    safetySummary: { pending, clean, rejected, failed },
    updatedAt: now,
    updatedBy: "file-safety",
  });
}

async function queueStudioImportAnalysis(input: {
  tenantId: string;
  sessionId: string;
  itemId: string;
  sha256: string;
  now: string;
}) {
  const db = getFirestore();
  const itemReference = db.doc(`studioImportItems/${input.itemId}`);
  const jobReference = db.doc(`aiJobs/studio_import_${input.itemId}`);
  const checksumId = createHash("sha256")
    .update(`${input.tenantId}:${input.sha256}`)
    .digest("hex");
  const checksumReference = db.doc(`studioImportChecksums/${checksumId}`);
  await db.runTransaction(async (transaction) => {
    const [item, job, checksum] = await Promise.all([
      transaction.get(itemReference),
      transaction.get(jobReference),
      transaction.get(checksumReference),
    ]);
    if (!item.exists || item.get("tenantId") !== input.tenantId)
      throw new Error("IMPORT_ITEM_NOT_FOUND");
    if (job.exists) return;
    await consumeAiQuota(transaction, db, input.tenantId, input.now);
    const duplicateItemId =
      checksum.exists &&
      checksum.get("itemId") !== input.itemId
        ? String(checksum.get("itemId"))
        : null;
    if (!checksum.exists) {
      transaction.create(checksumReference, {
        id: checksumId,
        tenantId: input.tenantId,
        sha256: input.sha256,
        itemId: input.itemId,
        sessionId: input.sessionId,
        createdAt: input.now,
        updatedAt: input.now,
      });
    }
    transaction.update(itemReference, {
      bucket: item.get("bucket"),
      duplicate: duplicateItemId
        ? {
            status: "possible_duplicate",
            itemId: duplicateItemId,
            detectedAt: input.now,
          }
        : null,
      aiQueueError: null,
      updatedAt: input.now,
      updatedBy: "file-safety",
    });
    transaction.create(jobReference, {
      id: jobReference.id,
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      itemId: input.itemId,
      type: "studio_import_extraction",
      status: "queued",
      attempts: 0,
      humanReviewRequired: true,
      createdAt: input.now,
      updatedAt: input.now,
    });
  });
}

async function handleStudioImport(input: {
  bucket: string;
  objectName: string;
  generation: string;
  contentType: string;
  sizeBytes: number;
  metadata: Record<string, string>;
}): Promise<boolean> {
  const tenantId = input.metadata.tenantId;
  const sessionId = input.metadata.importSessionId;
  const itemId = input.metadata.importItemId;
  const uploadId = input.metadata.uploadId;
  const pathParts = input.objectName.split("/");
  const isStudioImportPath =
    pathParts[0] === "tenants" && pathParts[2] === "studio-imports";
  if (!isStudioImportPath && !sessionId && !itemId) return false;

  const file = getStorage().bucket(input.bucket).file(input.objectName);
  const now = new Date().toISOString();
  if (!tenantId || !sessionId || !itemId || !uploadId) {
    await file.setMetadata({
      metadata: {
        ...input.metadata,
        scanStatus: "rejected",
        scanDetail: "IMPORT_METADATA_MISSING",
      },
    });
    return true;
  }

  const db = getFirestore();
  const itemReference = db.doc(`studioImportItems/${itemId}`);
  const item = await itemReference.get();
  if (
    !item.exists ||
    item.get("tenantId") !== tenantId ||
    item.get("sessionId") !== sessionId ||
    item.get("uploadId") !== uploadId ||
    item.get("expectedObjectName") !== input.objectName
  ) {
    await file.setMetadata({
      metadata: {
        ...input.metadata,
        scanStatus: "rejected",
        scanDetail: "IMPORT_OBJECT_NOT_AUTHORIZED",
      },
    });
    return true;
  }
  if (item.get("status") === "cancelled") {
    await file.setMetadata({
      metadata: { ...input.metadata, scanStatus: "cancelled" },
    });
    return true;
  }

  await itemReference.update({
    status: "quarantined",
    bucket: input.bucket,
    storageProvider: "gcs",
    storageObjectKey: input.objectName,
    generation: input.generation,
    updatedAt: now,
    updatedBy: "file-safety",
  });

  const expectedBytes = Number(item.get("sizeBytes"));
  const expectedContentType = String(item.get("contentType"));
  const extension = String(item.get("extension"));
  if (
    input.sizeBytes <= 0 ||
    input.sizeBytes > studioImportMaxFileBytes ||
    input.sizeBytes !== expectedBytes ||
    input.contentType !== expectedContentType
  ) {
    await file.setMetadata({
      metadata: {
        ...input.metadata,
        scanStatus: "rejected",
        scanDetail: "IMPORT_OBJECT_METADATA_MISMATCH",
      },
    });
    await itemReference.update({
      status: "rejected",
      safety: {
        signatureVerifiedAt: null,
        malwareScanStatus: "failed",
        malwareScannedAt: null,
        rejectionCode: "IMPORT_OBJECT_METADATA_MISMATCH",
      },
      failure: {
        code: "IMPORT_OBJECT_METADATA_MISMATCH",
        message: "The uploaded file did not match the approved source metadata.",
        retryable: false,
      },
      updatedAt: now,
      updatedBy: "file-safety",
    });
    await refreshImportSession(sessionId, now);
    return true;
  }

  const [bytes] = await file.download();
  if (!verifyStudioImportFileSignature(bytes, extension)) {
    await file.setMetadata({
      metadata: {
        ...input.metadata,
        scanStatus: "rejected",
        scanDetail: "FILE_SIGNATURE_MISMATCH",
      },
    });
    await itemReference.update({
      status: "rejected",
      safety: {
        signatureVerifiedAt: null,
        malwareScanStatus: "failed",
        malwareScannedAt: null,
        rejectionCode: "FILE_SIGNATURE_MISMATCH",
      },
      failure: {
        code: "FILE_SIGNATURE_MISMATCH",
        message: "The file contents did not match its approved file type.",
        retryable: false,
      },
      updatedAt: now,
      updatedBy: "file-safety",
    });
    await refreshImportSession(sessionId, now);
    return true;
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await itemReference.update({
    status: "scanning",
    sha256,
    safety: {
      signatureVerifiedAt: now,
      malwareScanStatus: "pending",
      malwareScannedAt: null,
      rejectionCode: null,
    },
    updatedAt: now,
    updatedBy: "file-safety",
  });

  const service = process.env.MALWARE_SCAN_SERVICE_URL;
  if (!service) {
    await file.setMetadata({
      metadata: {
        ...input.metadata,
        scanStatus: "scanner_unavailable",
        sha256,
      },
    });
    await itemReference.update({
      status: "failed",
      safety: {
        signatureVerifiedAt: now,
        malwareScanStatus: "unavailable",
        malwareScannedAt: null,
        rejectionCode: "SCANNER_UNAVAILABLE",
      },
      failure: {
        code: "SCANNER_UNAVAILABLE",
        message: "File safety scanning is temporarily unavailable.",
        retryable: true,
      },
      updatedAt: now,
      updatedBy: "file-safety",
    });
    await refreshImportSession(sessionId, now);
    return true;
  }

  try {
    const result = await scanObject({
      service,
      bucket: input.bucket,
      objectName: input.objectName,
      contentType: input.contentType,
      maxBytes: studioImportMaxFileBytes,
    });
    const clean = result.status === "clean";
    await file.setMetadata({
      metadata: {
        ...input.metadata,
        scanStatus: result.status,
        scanEngine: result.engine,
        sha256,
      },
    });
    await itemReference.update({
      status: clean ? "ready_for_analysis" : "rejected",
      safety: {
        signatureVerifiedAt: now,
        malwareScanStatus: clean ? "passed" : "failed",
        malwareScannedAt: now,
        rejectionCode: clean ? null : result.status.toUpperCase(),
      },
      failure: clean
        ? null
        : {
            code: result.status.toUpperCase(),
            message:
              result.detail ??
              "The file did not pass StudioCue's safety checks.",
            retryable: false,
          },
      updatedAt: now,
      updatedBy: "file-safety",
    });
    if (clean) {
      try {
        await queueStudioImportAnalysis({
          tenantId,
          sessionId,
          itemId,
          sha256,
          now,
        });
      } catch (caught: unknown) {
        await itemReference.update({
          aiQueueError:
            caught instanceof Error ? caught.message : "AI_QUEUE_FAILED",
          updatedAt: now,
          updatedBy: "file-safety",
        });
      }
    }
  } catch (caught: unknown) {
    const message =
      caught instanceof Error ? caught.message : "SCAN_FAILED";
    await file.setMetadata({
      metadata: {
        ...input.metadata,
        scanStatus: "scan_failed",
        sha256,
      },
    });
    await itemReference.update({
      status: "failed",
      safety: {
        signatureVerifiedAt: now,
        malwareScanStatus: "failed",
        malwareScannedAt: now,
        rejectionCode: "SCAN_FAILED",
      },
      failure: {
        code: "SCAN_FAILED",
        message,
        retryable: true,
      },
      updatedAt: now,
      updatedBy: "file-safety",
    });
  }
  await refreshImportSession(sessionId, new Date().toISOString());
  return true;
}

async function handleCoiScan(input: {
  requestId: string;
  status: ScanResult["status"];
  now: string;
}) {
  const db = getFirestore();
  const coi = db.doc(`insuranceRequests/${input.requestId}`);
  if (input.status !== "clean") {
    await coi.update({
      scanStatus: input.status,
      status: "failed",
      updatedAt: input.now,
      updatedBy: "file-safety",
    });
    return;
  }
  try {
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(coi);
      if (!current.exists) throw new Error("INSURANCE_REQUEST_NOT_FOUND");
      const aiJob = db.doc(`aiJobs/coi_${input.requestId}`);
      if ((await transaction.get(aiJob)).exists) return;
      await consumeAiQuota(
        transaction,
        db,
        String(current.get("tenantId")),
        input.now,
      );
      transaction.update(coi, {
        scanStatus: "clean",
        status: "received",
        updatedAt: input.now,
        updatedBy: "file-safety",
      });
      transaction.create(aiJob, {
        tenantId: current.get("tenantId"),
        projectId: current.get("projectId"),
        type: "coi_extraction",
        status: "queued",
        attempts: 0,
        humanApprovalRequired: true,
        createdAt: input.now,
        updatedAt: input.now,
      });
    });
  } catch (caught: unknown) {
    await coi.update({
      scanStatus: "clean",
      aiQueueError:
        caught instanceof Error ? caught.message : "AI_QUEUE_FAILED",
      updatedAt: input.now,
      updatedBy: "file-safety",
    });
  }
}

export const fileSafetyOnFinalize = onObjectFinalized(
  {
    region: "us-east1",
    cpu: 1,
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (event) => {
    const object = event.data;
    const objectName = object.name;
    if (!objectName || !objectName.startsWith("tenants/")) return;
    const generation = String(object.generation);
    const contentType = object.contentType ?? "application/octet-stream";
    const metadata = Object.fromEntries(
      Object.entries(object.metadata ?? {}).map(([key, value]) => [
        key,
        String(value),
      ]),
    );
    if (metadata.trustedGenerator || metadata.scanStatus === "clean") return;

    if (
      await handleStudioImport({
        bucket: object.bucket,
        objectName,
        generation,
        contentType,
        sizeBytes: Number(object.size ?? 0),
        metadata,
      })
    ) {
      return;
    }

    const file = getStorage().bucket(object.bucket).file(objectName);
    const scanId = Buffer.from(
      `${object.bucket}/${objectName}/${generation}`,
    )
      .toString("base64url")
      .slice(0, 900);
    const scanReference = getFirestore().doc(`fileScans/${scanId}`);
    const now = new Date().toISOString();
    const service = process.env.MALWARE_SCAN_SERVICE_URL;
    if (!service) {
      await file.setMetadata({
        metadata: { ...metadata, scanStatus: "scanner_unavailable" },
      });
      await scanReference.set({
        id: scanId,
        bucket: object.bucket,
        objectName,
        generation,
        contentType,
        status: "scanner_unavailable",
        createdAt: now,
        updatedAt: now,
      });
      return;
    }

    try {
      const result = await scanObject({
        service,
        bucket: object.bucket,
        objectName,
        contentType,
        maxBytes: 25 * 1024 * 1024,
      });
      await file.setMetadata({
        metadata: {
          ...metadata,
          scanStatus: result.status,
          scanEngine: result.engine,
        },
      });
      await scanReference.set({
        id: scanId,
        bucket: object.bucket,
        objectName,
        generation,
        contentType,
        status: result.status,
        detail: result.detail,
        createdAt: now,
        updatedAt: now,
      });
      if (metadata.coiRequestId) {
        await handleCoiScan({
          requestId: metadata.coiRequestId,
          status: result.status,
          now,
        });
      }
    } catch (caught: unknown) {
      const message =
        caught instanceof Error ? caught.message : "SCAN_FAILED";
      await file.setMetadata({
        metadata: { ...metadata, scanStatus: "scan_failed" },
      });
      await scanReference.set({
        id: scanId,
        bucket: object.bucket,
        objectName,
        generation,
        contentType,
        status: "scan_failed",
        detail: message,
        createdAt: now,
        updatedAt: now,
      });
      if (metadata.coiRequestId) {
        await getFirestore()
          .doc(`insuranceRequests/${metadata.coiRequestId}`)
          .update({
            scanStatus: "scan_failed",
            status: "failed",
            updatedAt: now,
            updatedBy: "file-safety",
          });
      }
    }
  },
);
